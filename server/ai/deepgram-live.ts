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
type LiveBuffer = {
  parts: string[];
  startedAt: number;
  // Promise that resolves when the persist on close completes — finalize
  // awaits this to avoid racing the WS-close handler.
  persistPromise: Promise<void> | null;
};
const liveBuffers = new Map<string, LiveBuffer>();

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
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const entry = liveBuffers.get(uploadId);
    if (!entry) return; // already persisted and detached
    if (entry.persistPromise) {
      try { await entry.persistPromise; } catch {}
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function persistLiveTranscript(uploadId: string): Promise<void> {
  const entry = liveBuffers.get(uploadId);
  if (!entry) return;
  // Detach immediately so a duplicate close event can't double-persist.
  liveBuffers.delete(uploadId);
  try {
    const cleanedParts = entry.parts
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 0);
    if (cleanedParts.length === 0) return; // nothing to save (no speech detected)
    // Raw transcript: utterances joined by spaces, no speaker labels.
    const rawText = cleanedParts.join(" ").replace(/\s+/g, " ").trim();
    // Labeled transcript: SmartHub recorder is always operated by a
    // therapist on their own device, so every utterance is the therapist
    // by definition. Prefix each Deepgram final segment with "Therapist:"
    // on its own line — matches the chunked-Whisper path's labeling so
    // downstream consumers (note generator, smart-fill) see the same
    // shape regardless of which transcription engine produced it.
    const SOLO_LABEL = "Therapist:";
    const labeledText = cleanedParts.map((p) => `${SOLO_LABEL} ${p}`).join("\n\n");
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
  } catch (err) {
    console.error("[deepgram-live] persist failed:", err);
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
  // Register an in-memory buffer for this recording. Every is_final
  // transcript Deepgram sends is appended; on close we persist the full
  // text to the DB row so the saved transcript reflects what Deepgram
  // produced — no chunked Whisper uploads needed.
  liveBuffers.set(uploadId, {
    parts: [],
    startedAt: Date.now(),
    persistPromise: null,
  });
  // Deepgram Nova-2 streaming. We let Deepgram auto-detect the audio
  // container (WebM Opus) — the browser's MediaRecorder stream is sent
  // verbatim. interim_results gives us the "live word-by-word" feel;
  // smart_format adds punctuation/capitalisation.
  const params = new URLSearchParams({
    model: "nova-2",
    language,
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    endpointing: "300", // ms of silence before declaring an utterance final
  });
  const dgUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

  const dgWs = new WsClient(dgUrl, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  let dgReady = false;
  let closed = false;
  const audioBacklog: Buffer[] = [];

  const closeBoth = () => {
    if (closed) return;
    closed = true;
    try {
      if (dgWs.readyState === WsClient.OPEN) {
        // Politely tell Deepgram we're done so it flushes any final words.
        dgWs.send(JSON.stringify({ type: "CloseStream" }));
      }
    } catch {}
    try {
      dgWs.close();
    } catch {}
    try {
      clientWs.close();
    } catch {}
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
    if (msg.type === "Results") {
      const alt = msg.channel?.alternatives?.[0];
      const text = (alt?.transcript || "").trim();
      const isFinal = !!msg.is_final;
      // Buffer final segments so we can persist them on close as the
      // canonical saved transcript.
      if (isFinal && text) {
        const entry = liveBuffers.get(uploadId);
        if (entry) entry.parts.push(text);
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
    } else if (msg.type === "Metadata" || msg.type === "SpeechStarted") {
      // No-op for now — could expose speaker/utterance start later.
    }
  });

  dgWs.on("error", (err) => {
    console.error("[deepgram-live] Deepgram ws error:", err);
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

  dgWs.on("close", () => {
    // Persist whatever we accumulated. Stash the promise on the buffer
    // entry so /transcribe-finalize can await it.
    const entry = liveBuffers.get(uploadId);
    if (entry && !entry.persistPromise) {
      entry.persistPromise = persistLiveTranscript(uploadId);
    }
    closeBoth();
  });

  clientWs.on("message", (data, isBinary) => {
    if (!isBinary) return; // text frames from client are ignored
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer);
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
