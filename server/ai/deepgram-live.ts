// Deepgram live-streaming WebSocket proxy.
//
// Why a server-side proxy: the Deepgram API key must NEVER leave the server
// (HIPAA + cost). The browser opens a WebSocket to OUR server using its
// existing cookie session; we then open a SECOND WebSocket out to Deepgram
// using the secret API key, and pipe binary audio frames in one direction
// and JSON transcript results in the other.
//
// Path: /ws/transcribe-live?uploadId=srv-...&language=en
//
// Auth model: same cookie session token (`sessionToken`) as the rest of the
// API. The uploadId must already exist in the DB and belong to the calling
// user — meaning POST /transcribe-start was called first. This prevents
// any logged-in user from spinning up arbitrary Deepgram streams on
// somebody else's session.

import { WebSocketServer, WebSocket as WsClient } from "ws";
import type { Server as HttpServer, IncomingMessage } from "http";
import type { Duplex } from "stream";
import { parse as parseUrl } from "url";
import { verifySessionToken } from "../auth-middleware";
import { storage } from "../storage";

const WS_PATH = "/ws/transcribe-live";

// In-memory buffer of Deepgram is_final transcripts per active uploadId.
// Source of truth for the saved transcript when the language supports live
// streaming — replaces the chunked Whisper upload pipeline.
//
// Lifecycle:
//   • POST /transcribe-start creates the DB row (status='recording')
//   • Browser opens /ws/transcribe-live → entry added here on WS open
//   • Each is_final transcript appended to the entry's `parts` array
//   • Deepgram WS close → persistLiveTranscript(uploadId) writes content
//     to the DB row (status stays 'recording'; finalize endpoint flips it
//     to 'ready' so the client can react to a single state transition).
//   • POST /transcribe-finalize awaits the in-flight persist (if any) so
//     the response always reflects the freshest text.
// One contiguous run of speech from a single speaker, as identified by
// Deepgram's diarization. Multiple segments per is_final message are
// possible when speakers interrupt each other — Deepgram emits a single
// utterance but the per-word `speaker` field changes mid-utterance.
type Segment = { speaker: number; text: string };
type LiveBuffer = {
  segments: Segment[];
  startedAt: number;
  // Promise that resolves when the persist on close completes — finalize
  // awaits this to avoid racing the WS-close handler.
  persistPromise: Promise<void> | null;
  // T1: how many client WebSocket connections are currently attached to
  // this buffer. Reconnects increment this on attach and decrement on
  // detach. The buffer is only finalised (persisted + deleted) when the
  // count drops to 0 AND nobody has reconnected within a short grace
  // window — so a brief network blip doesn't flush the buffer
  // prematurely.
  attachedClients: number;
  // T1: timer that schedules a final persist after the last client
  // detaches. Cancelled if a reconnect attaches before it fires.
  finalPersistTimer: NodeJS.Timeout | null;
  // T2: serialise flushes so a periodic flush running concurrently with
  // a final flush can't double-write or interleave their DB updates.
  flushChain: Promise<void>;
  // T1 (architect-fix): once finalising starts, no new attaches are
  // allowed so the buffer can't be re-used after deletion. Segment
  // appends still happen during finalising so trailing Deepgram is_final
  // results emitted after CloseStream are not lost.
  finalizing: boolean;
  // T1 (architect-fix): deferred that resolves when the *current* dgWs
  // closes. Set by bindToDeepgram on each (re)attach so finalisation
  // can drain Deepgram's trailing transcripts before flushing.
  dgClosed: Promise<void> | null;
};
const liveBuffers = new Map<string, LiveBuffer>();

// T1: how long to wait after the last client detaches before
// finalising. Gives the browser time to reopen its WebSocket after a
// network blip without losing the in-progress text.
const RECONNECT_GRACE_MS = 8000;
// T2: how often to flush the in-memory transcript to the DB while the
// recording is still in progress. A server crash now loses at most this
// many seconds of text instead of the entire session.
const PERIODIC_FLUSH_MS = 15_000;

export function hasLiveBuffer(uploadId: string): boolean {
  return liveBuffers.has(uploadId);
}

// Awaited by /transcribe-finalize before reading the DB row, so the saved
// transcript reflects every final word Deepgram sent — even if finalize
// races the WS close handler.
//
// Two races to handle:
//   (a) finalize arrives after the WS already closed — entry is gone, no-op.
//   (b) finalize arrives BEFORE dgWs.on('close') fires — entry exists but
//       persistPromise is still null. We poll briefly for the persist to
//       start, then await it. If it never starts (Deepgram never closed)
//       we give up after ~8s and fall through; the DB row is still empty
//       and the finalize endpoint will return its "no content" error.
export async function awaitLivePersist(uploadId: string): Promise<void> {
  const entry = liveBuffers.get(uploadId);
  if (!entry) return; // already persisted and detached
  // T1 (architect-fix): finalize means the user clicked Stop. Cancel
  // any pending reconnect-grace timer, mark the buffer finalising so
  // no late reconnect can attach to a buffer that's about to be
  // deleted, then wait briefly for Deepgram to drain its trailing
  // is_final messages before flushing — otherwise the last few
  // sentences captured between CloseStream and dgWs.close get dropped.
  if (entry.finalPersistTimer) {
    clearTimeout(entry.finalPersistTimer);
    entry.finalPersistTimer = null;
  }
  entry.finalizing = true;
  if (!entry.persistPromise) {
    entry.persistPromise = (async () => {
      // Wait up to ~3s for the most recent dgWs to close (closeBoth
      // already sent CloseStream which makes Deepgram flush + close
      // typically within a few hundred ms). If it never closes (no
      // dgWs ever attached, or Deepgram hung) we fall through and
      // flush whatever we have.
      if (entry.dgClosed) {
        await Promise.race([
          entry.dgClosed,
          new Promise<void>((r) => setTimeout(r, 3000)),
        ]).catch(() => {});
      }
      await flushLiveTranscript(uploadId, { final: true });
    })();
  }
  try { await entry.persistPromise; } catch {}
}

// T2: shared write that turns the in-memory segments into the DB row's
// canonical labelled transcript. `final=true` is the close-time flush
// (deletes the buffer afterwards); `final=false` is the periodic
// in-progress flush (keeps the buffer so further segments can append).
// The two share serialisation via entry.flushChain so concurrent calls
// can't interleave their updateSessionTranscript writes.
async function flushLiveTranscript(
  uploadId: string,
  opts: { final: boolean },
): Promise<void> {
  const entry = liveBuffers.get(uploadId);
  if (!entry) return;
  // Chain after any in-flight flush to serialise DB writes.
  const next = entry.flushChain.then(() => doFlush(uploadId, opts));
  entry.flushChain = next.catch(() => {}); // never let a rejection break the chain
  return next;
}

async function doFlush(
  uploadId: string,
  opts: { final: boolean },
): Promise<void> {
  const entry = liveBuffers.get(uploadId);
  if (!entry) return;
  try {
    const cleanedSegments = entry.segments
      .map((s) => ({ speaker: s.speaker, text: s.text.replace(/\s+/g, " ").trim() }))
      .filter((s) => s.text.length > 0);
    if (cleanedSegments.length === 0) {
      // Nothing to save yet. On a final flush, drop the empty buffer so
      // it doesn't leak; on periodic, just keep waiting for words.
      if (opts.final) liveBuffers.delete(uploadId);
      return;
    }
    // Raw transcript: utterances joined by spaces, no speaker labels.
    const rawText = cleanedSegments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();

    // Speaker labels: Deepgram returns numeric speaker IDs (0, 1, 2…)
    // assigned by voice clustering — they don't tell us who is who. By
    // convention in a therapy session the therapist (operating the mic)
    // usually speaks first, so we map the first-appearing speaker to
    // "Therapist", second to "Client", and any further speakers to
    // "Speaker 3", "Speaker 4"… (group sessions). The therapist can
    // edit labels in the saved transcript afterwards.
    //
    // Adjacent segments by the same speaker are merged so the labeled
    // output reads as one continuous turn instead of one line per
    // utterance.
    const speakerOrder: number[] = [];
    for (const s of cleanedSegments) {
      if (!speakerOrder.includes(s.speaker)) speakerOrder.push(s.speaker);
    }
    const labelFor = (speaker: number): string => {
      const idx = speakerOrder.indexOf(speaker);
      if (idx === 0) return "Therapist";
      if (idx === 1) return "Client";
      return `Speaker ${idx + 1}`;
    };
    const merged: Segment[] = [];
    for (const s of cleanedSegments) {
      const last = merged[merged.length - 1];
      if (last && last.speaker === s.speaker) {
        last.text = `${last.text} ${s.text}`.replace(/\s+/g, " ").trim();
      } else {
        merged.push({ speaker: s.speaker, text: s.text });
      }
    }
    const labeledText = merged
      .map((s) => `${labelFor(s.speaker)}: ${s.text}`)
      .join("\n\n");
    const row = await storage.getSessionTranscriptByUploadId(uploadId);
    if (!row) return;
    if (row.status === "ready") return; // already finalized — don't overwrite
    const wordCount = rawText.split(/\s+/).filter(Boolean).length;
    const durationSeconds = Math.max(
      row.durationSeconds || 0,
      Math.round((Date.now() - entry.startedAt) / 1000),
    );
    await storage.updateSessionTranscript(row.id, {
      content: labeledText,
      rawContent: rawText,
      wordCount,
      durationSeconds,
      // Mark as 'processing' so the client knows finalize will be a quick
      // metadata flip, not a long Whisper job. Stays 'recording' otherwise
      // so the recovery banner still works if the user never clicks Stop.
      status: "processing",
    });
    console.log(`[deepgram-live] ${opts.final ? 'final' : 'periodic'} flush uploadId=${uploadId} segments=${cleanedSegments.length} words=${wordCount} chars=${labeledText.length}`);
  } catch (err) {
    console.error("[deepgram-live] flush failed:", err);
  } finally {
    // Only the final flush detaches the buffer. Periodic flushes keep
    // the entry so further is_final segments can append. Detach AFTER
    // the DB write completes so awaitLivePersist sees the freshest
    // state via persistPromise instead of racing past a deleted entry.
    if (opts.final) liveBuffers.delete(uploadId);
  }
}

// Allowlist of Deepgram Nova-2 streaming language codes we expose in the UI.
// If the dropdown ever ships a code not in this list the upgrade is rejected
// — defence-in-depth so a tampered client can't pass arbitrary query params
// straight into the Deepgram URL.
const ALLOWED_LANGUAGES = new Set([
  "en",
  "en-US",
  "en-GB",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "ru",
  "hi",
  "zh",
  "ja",
  "ko",
  "tr",
  "pl",
  "ar",
  "multi",
]);

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function reject(socket: Duplex, code: number, message: string): void {
  socket.write(`HTTP/1.1 ${code} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachDeepgramLive(httpServer: HttpServer): void {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.warn(
      "[deepgram-live] DEEPGRAM_API_KEY not set — live transcription is disabled.",
    );
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    let pathname: string | null = null;
    let query: Record<string, string | string[] | undefined> = {};
    try {
      const u = parseUrl(req.url || "", true);
      pathname = u.pathname;
      query = u.query;
    } catch {
      return; // malformed url — let other handlers / vite see it
    }

    // IMPORTANT: only handle our path — Vite HMR uses its own WebSocket on a
    // different path and must continue to work unmolested.
    if (pathname !== WS_PATH) return;

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.sessionToken;
    if (!token) return reject(socket, 401, "Unauthorized");
    const user = verifySessionToken(token);
    if (!user) return reject(socket, 401, "Unauthorized");

    const uploadId = String(query.uploadId || "");
    const language = String(query.language || "en").toLowerCase();
    if (!uploadId.startsWith("srv-") || uploadId.length > 64) {
      return reject(socket, 400, "Bad Request");
    }
    if (!ALLOWED_LANGUAGES.has(language)) {
      return reject(socket, 400, "Bad Request");
    }

    // Verify the uploadId belongs to this user and is still recording.
    // Async — we hold the raw socket until the DB lookup completes.
    storage
      .getSessionTranscriptByUploadId(uploadId)
      .then((upload) => {
        if (!upload) return reject(socket, 404, "Not Found");
        if (upload.therapistId !== user.id) {
          return reject(socket, 403, "Forbidden");
        }
        if (upload.status !== "recording") {
          return reject(socket, 409, "Conflict");
        }

        wss.handleUpgrade(req, socket, head, (clientWs) => {
          bindToDeepgram(clientWs, language, apiKey, uploadId);
        });
      })
      .catch((err) => {
        console.error("[deepgram-live] upload lookup failed:", err);
        reject(socket, 500, "Internal Server Error");
      });
  });

  console.log(`[deepgram-live] WebSocket endpoint mounted at ${WS_PATH}`);
}

function bindToDeepgram(
  clientWs: WsClient,
  language: string,
  apiKey: string,
  uploadId: string,
): void {
  // T1: reuse the existing buffer on reconnect so transcript so far is
  // preserved. The first connection creates the entry; every subsequent
  // reconnect attaches to it, cancels any pending finalisation timer,
  // and bumps the attached-clients counter.
  let entry = liveBuffers.get(uploadId);
  const isReconnect = !!entry;
  if (entry?.finalizing) {
    // T1 (architect-fix): the buffer is being persisted and about to be
    // deleted. A new attach now would re-bump attachedClients on a
    // doomed buffer and the next is_final messages would arrive after
    // delete and be lost. Reject this attach with a clear server msg
    // so the client gives up and shows the recovery banner instead.
    console.warn(`[deepgram-live] reject attach: uploadId=${uploadId} is finalising`);
    try {
      clientWs.send(JSON.stringify({ type: "error", message: "Recording is being finalised" }));
    } catch {}
    try { clientWs.close(); } catch {}
    return;
  }
  if (!entry) {
    entry = {
      segments: [],
      startedAt: Date.now(),
      persistPromise: null,
      attachedClients: 0,
      finalPersistTimer: null,
      flushChain: Promise.resolve(),
      finalizing: false,
      dgClosed: null,
    };
    liveBuffers.set(uploadId, entry);
  } else if (entry.finalPersistTimer) {
    // A previous client just disconnected and we were about to flush;
    // the user came back in time, cancel the final flush.
    clearTimeout(entry.finalPersistTimer);
    entry.finalPersistTimer = null;
  }
  entry.attachedClients++;
  console.log(`[deepgram-live] WS opened uploadId=${uploadId} lang=${language}${isReconnect ? ` (reconnect, segmentsSoFar=${entry.segments.length}, attached=${entry.attachedClients})` : ''}`);
  let audioFramesReceived = 0;
  let dgMessagesReceived = 0;
  let dgFinalSegmentsCaptured = 0;
  let dgInterimWithText = 0;
  let dgMetadataSeen = false;
  let firstAudioBytes = 0;
  // Deepgram Nova-2 streaming. We let Deepgram auto-detect the audio
  // container (WebM Opus) — the browser's MediaRecorder stream is sent
  // verbatim. interim_results gives us the "live word-by-word" feel;
  // smart_format adds punctuation/capitalisation; diarize tags each word
  // with a speaker number so the saved transcript can label turns.
  const params = new URLSearchParams({
    model: "nova-2",
    language,
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    endpointing: "300", // ms of silence before declaring an utterance final
  });
  const dgUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

  const dgWs = new WsClient(dgUrl, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  // T1 (architect-fix): expose a deferred that resolves when *this*
  // dgWs closes. Finalisation waits on it so trailing is_final messages
  // emitted between CloseStream and dgWs.close are captured. Stored on
  // the buffer entry so awaitLivePersist / grace timer can find it
  // without a reference to this scope.
  let resolveDgClosed: (() => void) | null = null;
  entry.dgClosed = new Promise<void>((res) => { resolveDgClosed = res; });

  let dgReady = false;
  let closed = false;
  const audioBacklog: Buffer[] = [];

  const closeBoth = () => {
    if (closed) return;
    closed = true;
    // T2: stop periodic flushes — they're scoped to this socket pair.
    try { clearInterval(periodicFlushTimer); } catch {}
    try {
      if (dgWs.readyState === WsClient.OPEN) {
        // Politely tell Deepgram we're done so it flushes any final words.
        // T1 (architect-fix): do NOT call dgWs.close() here — that
        // tears the TCP connection down before Deepgram has a chance
        // to send its trailing is_final messages. Deepgram will close
        // the socket itself a few hundred ms after CloseStream, which
        // fires our dgWs.on('close') handler, resolves entry.dgClosed,
        // and lets the finaliser flush a complete transcript.
        dgWs.send(JSON.stringify({ type: "CloseStream" }));
      } else {
        // dgWs never opened or already closed — close it now so we
        // don't leak the socket. dgWs.on('close') still resolves
        // entry.dgClosed.
        try { dgWs.close(); } catch {}
      }
    } catch {}
    try {
      clientWs.close();
    } catch {}
    // T1: detach this client from the buffer. If anybody else is still
    // attached (multi-tab), do nothing further. If we were the last one,
    // schedule a final flush after the reconnect grace window — a fast
    // re-attach (network blip, page navigation) will cancel it.
    const e = liveBuffers.get(uploadId);
    if (!e) return;
    if (e.attachedClients > 0) e.attachedClients--;
    if (e.attachedClients === 0 && !e.finalPersistTimer && !e.persistPromise && !e.finalizing) {
      e.finalPersistTimer = setTimeout(() => {
        const cur = liveBuffers.get(uploadId);
        if (!cur) return;
        cur.finalPersistTimer = null;
        if (cur.attachedClients > 0) return; // somebody reconnected
        if (cur.persistPromise) return; // finalize HTTP already started one
        // T1 (architect-fix): mark finalising so any late reconnect is
        // rejected, then drain Deepgram trailing finals (≤3s) before
        // flushing — same shape as awaitLivePersist.
        cur.finalizing = true;
        cur.persistPromise = (async () => {
          if (cur.dgClosed) {
            await Promise.race([
              cur.dgClosed,
              new Promise<void>((r) => setTimeout(r, 3000)),
            ]).catch(() => {});
          }
          await flushLiveTranscript(uploadId, { final: true });
        })();
      }, RECONNECT_GRACE_MS);
    }
  };

  dgWs.on("open", () => {
    dgReady = true;
    // Flush anything we received from the browser before Deepgram was ready.
    while (audioBacklog.length > 0) {
      const buf = audioBacklog.shift()!;
      try {
        dgWs.send(buf);
      } catch {
        break;
      }
    }
  });

  dgWs.on("message", (raw) => {
    if (clientWs.readyState !== WsClient.OPEN) return;
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // not JSON, ignore (Deepgram occasionally sends pings)
    }
    dgMessagesReceived++;
    if (dgMessagesReceived <= 2) {
      console.log(`[deepgram-live] DG msg #${dgMessagesReceived} uploadId=${uploadId}:`, JSON.stringify(msg).slice(0, 500));
    }
    if (msg.type === "Results") {
      const alt = msg.channel?.alternatives?.[0];
      const text = (alt?.transcript || "").trim();
      const isFinal = !!msg.is_final;
      // Buffer final segments grouped by speaker so we can persist them
      // on close as the canonical saved transcript with proper labels.
      // Deepgram returns one alt.words[] array per utterance; each word
      // carries a `speaker` integer. We collapse runs of consecutive
      // same-speaker words into one Segment. If diarization data is
      // missing (older model / no speakers detected) fall back to the
      // plain transcript text under speaker 0.
      if (text && !isFinal) dgInterimWithText++;
      if (isFinal && text) {
        dgFinalSegmentsCaptured++;
        const entry = liveBuffers.get(uploadId);
        if (entry) {
          const words: Array<{ punctuated_word?: string; word?: string; speaker?: number }> =
            Array.isArray(alt?.words) ? alt.words : [];
          if (words.length === 0 || words.every((w) => typeof w.speaker !== "number")) {
            entry.segments.push({ speaker: 0, text });
          } else {
            let currentSpeaker = -1;
            let currentBuf: string[] = [];
            const flush = () => {
              if (currentBuf.length === 0) return;
              entry.segments.push({
                speaker: currentSpeaker,
                text: currentBuf.join(" ").replace(/\s+([.,!?;:])/g, "$1").trim(),
              });
              currentBuf = [];
            };
            for (const w of words) {
              const sp = typeof w.speaker === "number" ? w.speaker : 0;
              const tok = w.punctuated_word || w.word || "";
              if (!tok) continue;
              if (sp !== currentSpeaker) {
                flush();
                currentSpeaker = sp;
              }
              currentBuf.push(tok);
            }
            flush();
          }
        }
      }
      // Even empty interim updates we skip — only forward when there's
      // actual content (or a final marker) to keep the client cheap.
      if (text || isFinal) {
        try {
          clientWs.send(
            JSON.stringify({ type: "transcript", text, isFinal }),
          );
        } catch {}
      }
    } else if (msg.type === "Metadata") {
      if (!dgMetadataSeen) {
        dgMetadataSeen = true;
        console.log(`[deepgram-live] DG Metadata uploadId=${uploadId}:`, JSON.stringify(msg).slice(0, 400));
      }
    } else if (msg.type === "SpeechStarted") {
      // No-op for now.
    }
  });

  dgWs.on("error", (err) => {
    console.error(`[deepgram-live] Deepgram ws error uploadId=${uploadId}:`, err);
    if (clientWs.readyState === WsClient.OPEN) {
      try {
        clientWs.send(
          JSON.stringify({
            type: "error",
            message: "Live transcription provider error",
          }),
        );
      } catch {}
    }
    closeBoth();
  });

  dgWs.on("close", (code, reason) => {
    console.log(
      `[deepgram-live] dgWs closed uploadId=${uploadId} code=${code} reason=${reason?.toString() || ''} ` +
      `audioFrames=${audioFramesReceived} firstChunkBytes=${firstAudioBytes} dgMessages=${dgMessagesReceived} ` +
      `interimWithText=${dgInterimWithText} finalSegments=${dgFinalSegmentsCaptured} metadataSeen=${dgMetadataSeen}`,
    );
    // T1 (architect-fix): unblock anyone awaiting Deepgram drain.
    if (resolveDgClosed) { resolveDgClosed(); resolveDgClosed = null; }
    closeBoth();
  });

  // T2: periodic in-progress flush. Writes the current segments to the
  // DB every PERIODIC_FLUSH_MS so a server crash mid-recording loses at
  // most that many seconds of text instead of the whole session.
  // Cleared on detach so it doesn't outlive its WebSocket.
  const periodicFlushTimer = setInterval(() => {
    flushLiveTranscript(uploadId, { final: false }).catch((err) => {
      console.error("[deepgram-live] periodic flush failed:", err);
    });
  }, PERIODIC_FLUSH_MS);

  clientWs.on("message", (data, isBinary) => {
    if (!isBinary) return; // text frames from client are ignored
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer);
    audioFramesReceived++;
    if (audioFramesReceived === 1) {
      firstAudioBytes = buf.length;
      console.log(`[deepgram-live] first audio chunk uploadId=${uploadId} bytes=${buf.length}`);
    }
    if (dgReady && dgWs.readyState === WsClient.OPEN) {
      try {
        dgWs.send(buf);
      } catch (err) {
        console.error("[deepgram-live] forward to DG failed:", err);
      }
    } else {
      // Cap the backlog so a slow Deepgram open can't blow up memory.
      if (audioBacklog.length < 100) audioBacklog.push(buf);
    }
  });

  clientWs.on("close", () => closeBoth());
  clientWs.on("error", (err) => {
    console.error("[deepgram-live] client ws error:", err);
    closeBoth();
  });
}
