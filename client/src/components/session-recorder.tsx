import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mic,
  Square,
  Pause,
  Play,
  Loader2,
  CheckCircle2,
  Trash2,
  AlertCircle,
  Sparkles,
  RotateCw,
  Copy,
  Download,
  VolumeX,
  Tag,
  FileText,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryClient as qc, getCsrfToken } from "@/lib/queryClient";
import {
  putFailedChunk,
  deleteFailedChunk,
  listFailedChunksForUpload,
  clearFailedChunksForUpload,
} from "@/lib/recording-blob-store";

type SessionTranscript = {
  id: number;
  sessionId: number;
  content: string;
  rawContent: string | null;
  language: string | null;
  durationSeconds: number | null;
  chunkCount: number | null;
  wordCount: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

interface SessionRecorderProps {
  sessionId: number;
  language?: string;
  /** Optional callback invoked when therapist clicks "Smart Fill from Transcript" */
  onRequestSmartFill?: () => void;
  /**
   * Notifies the parent whenever the recorder enters/leaves an "active"
   * state (recording, paused, or finalizing). The parent uses this to
   * guard things like dialog close so the user can't accidentally lose
   * an in-progress recording.
   */
  onActiveStateChange?: (isActive: boolean) => void;
}

// 20-second slices give the live preview a fresh update roughly every
// ~22 seconds (slice + Whisper round-trip), which is responsive enough
// to feel "live" while keeping Whisper API cost at ~3x the old 60s
// behavior. Whisper accuracy is unaffected at this length — well above
// its practical 5s minimum — and chunk-boundary continuity is preserved
// because each chunk is sent with the previous chunk's text as context.
const SLICE_SECONDS = 20;
// Max-duration cap: warn at 1h45m, auto-pause at 2h. Therapist may extend.
const WARN_AT_SECONDS = 105 * 60;
const MAX_AT_SECONDS = 120 * 60;
// Below this peak RMS, a 60s segment is considered TRULY silent (mic muted /
// unplugged) and skipped to save Whisper cost AND to avoid Whisper hallucinating
// random phrases on pure silence. Threshold is intentionally very strict: we
// previously used 0.005 (~-46 dBFS) which dropped quiet-but-real conversation
// (soft-spoken clients, distant mic). 0.0008 (~-62 dBFS) only drops near-digital
// silence — anything a human ear could hear is preserved.
const SILENCE_RMS_THRESHOLD = 0.0008;

function recoveryStorageKey(sessionId: number): string {
  return `smarthub.session-recorder.recovery.v1.${sessionId}`;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function SessionRecorder({ sessionId, language, onRequestSmartFill, onActiveStateChange }: SessionRecorderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<"idle" | "recording" | "paused" | "finalizing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [chunksSent, setChunksSent] = useState(0);
  const [chunksUploaded, setChunksUploaded] = useState(0);
  const [previewText, setPreviewText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // List of chunk indexes that permanently failed and can be retried by the user
  const [failedChunks, setFailedChunks] = useState<number[]>([]);
  const [retryingChunks, setRetryingChunks] = useState<Set<number>>(new Set());

  // Phase 2 UX state
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [translateToEnglish, setTranslateToEnglish] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState(0); // 0..1, smoothed RMS for the meter
  const [silentSkipped, setSilentSkipped] = useState(0);
  // Network reliability state: surfaces a banner when the browser goes
  // offline OR when no chunk has uploaded successfully in > 90s while
  // recording (likely a slow / dropping connection).
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [uploadStalled, setUploadStalled] = useState(false);
  const lastUploadAtRef = useRef<number>(0);
  // Recovery state: if a previous recording for THIS session was started but
  // never finalized (page crash, tab close), we can offer to save what the
  // server already received instead of losing it.
  const [recoverableUploadId, setRecoverableUploadId] = useState<string | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  // Phase 3: Screen-share-safe preview. When on, the live previewText is
  // replaced by a generic message so a therapist screen-sharing SmartHub
  // during a session does not show the client their own transcribed words.
  // Transcription continues normally in the background.
  const [hidePreview, setHidePreview] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentStartRef = useRef<number>(0);
  // Continuous-capture mode: MediaRecorder is started ONCE with timeslice and
  // never rotated mid-recording, so there is no audio gap between chunks. The
  // first dataavailable contains the WebM init segment; subsequent chunks
  // contain only Cluster data, so we cache the init bytes here and prepend
  // them to chunks 1+ to keep each upload an independently decodable file.
  const webmInitRef = useRef<Uint8Array | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadIdRef = useRef<string>("");
  const chunkIndexRef = useRef<number>(0);
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mimeTypeRef = useRef<string>("audio/webm");
  const stoppingRef = useRef<boolean>(false);
  // Synchronous flags that don't suffer setState async lag
  const isPausedRef = useRef<boolean>(false);
  const [showRawInline, setShowRawInline] = useState(false);
  // Track failed chunk indexes so we can refuse to finalize a partial recording.
  // We also keep the original audio Blob so the user can retry that exact chunk.
  const failedChunksRef = useRef<
    Map<number, { blob: Blob; durationSec: number; mime: string }>
  >(new Map());
  // Indices of chunks that were skipped client-side because they were truly
  // silent (mic muted/unplugged). We send these to /transcribe-finalize so the
  // server can insert a `[silence ~Xs]` marker in the stitched transcript at
  // the right position — preventing the LLM from inventing content over gaps.
  const silentChunksRef = useRef<Map<number, number>>(new Map());
  // Resolved when the most-recently-stopped recorder's onstop has run.
  // Lets handleStop() guarantee the final segment's upload is enqueued
  // before we await the upload queue.
  const stopFlushedRef = useRef<Promise<void>>(Promise.resolve());

  // Phase 2 refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRafRef = useRef<number | null>(null);
  // Peak RMS observed during the current 60s segment — used to decide if it's silent.
  const segmentMaxRmsRef = useRef<number>(0);
  // Whether the therapist confirmed extending past the 2-hour cap.
  const extendedPast2hRef = useRef<boolean>(false);
  // Whether we've already shown the 1h45m warning toast for this recording.
  const warnedSoftCapRef = useRef<boolean>(false);

  const { data: existingTranscript, refetch: refetchTranscript } = useQuery<SessionTranscript>({
    queryKey: ["/api/sessions", sessionId, "transcript"],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/transcript`, {
        credentials: "include",
      });
      if (res.status === 404) return null as any;
      if (!res.ok) throw new Error("Failed to load transcript");
      return res.json();
    },
    // Refresh-safe finalize: if a saved transcript exists in 'processing'
    // state (e.g. the page was refreshed mid-finalize), poll until it's
    // ready or failed.
    refetchInterval: (query) => {
      const data = query.state.data as SessionTranscript | undefined;
      return data && data.status === "processing" ? 3000 : false;
    },
  });

  // Warn the user if they try to close/refresh the tab while a recording is
  // in progress (recording, paused, or finalizing). Without this, closing the
  // tab silently aborts the in-progress upload queue.
  const recordingInProgress =
    status === "recording" || status === "paused" || status === "finalizing";
  useEffect(() => {
    if (!recordingInProgress) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the custom string and show their own message,
      // but setting returnValue is still required for the prompt to appear.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [recordingInProgress]);

  // Notify the parent (e.g. the Session Note dialog) so it can intercept
  // its own close path while a recording is in progress.
  useEffect(() => {
    onActiveStateChange?.(recordingInProgress);
  }, [recordingInProgress, onActiveStateChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Network reliability: track browser online/offline so we can warn the
  // therapist immediately if uploads will start failing.
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => {
      setIsOnline(false);
      if (recordingInProgress) {
        toast({
          title: "Internet connection lost",
          description:
            "Recording continues, but chunks will fail to upload until you're back online. They will retry automatically.",
          variant: "destructive",
        });
      }
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingInProgress]);

  // Stalled-upload watchdog: while actively recording, if no chunk has
  // uploaded successfully in > 90s, surface a clear "uploads stalled" warning.
  // 90s = one missed slice + a full retry cycle. This catches dead-but-not-
  // offline networks (captive portals, bad VPN, transparent proxy issues).
  useEffect(() => {
    if (status !== "recording") {
      setUploadStalled(false);
      return;
    }
    const timer = setInterval(() => {
      const now = Date.now();
      if (
        chunkIndexRef.current > 0 &&
        lastUploadAtRef.current > 0 &&
        now - lastUploadAtRef.current > 90_000
      ) {
        setUploadStalled(true);
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [status]);

  // Recovery detection: on mount, if there's a stored uploadId for THIS
  // session that was never finalized, offer to recover what the server
  // already has. Only show if there's no current ready transcript.
  useEffect(() => {
    if (status !== "idle") return;
    if (existingTranscript && existingTranscript.status === "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(recoveryStorageKey(sessionId));
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const uploadId = parsed?.uploadId ? String(parsed.uploadId) : "";
        if (!uploadId) return;
        if (cancelled) return;
        setRecoverableUploadId(uploadId);
        // Rehydrate any failed-chunk audio from IndexedDB so the per-chunk
        // Retry buttons reappear after a refresh — the user can re-send the
        // actual audio before saving instead of losing those chunks.
        const stored = await listFailedChunksForUpload(uploadId);
        if (cancelled || stored.length === 0) return;
        uploadIdRef.current = uploadId;
        const map = failedChunksRef.current;
        for (const e of stored) {
          map.set(e.index, { blob: e.blob, durationSec: e.durationSec, mime: e.mime });
        }
        const indices = stored.map((e) => e.index).sort((a, b) => a - b);
        setFailedChunks(indices);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, status, existingTranscript]);

  const handleRecover = useCallback(async () => {
    if (!recoverableUploadId) return;
    setIsRecovering(true);
    try {
      const csrfToken = getCsrfToken();
      // Finalize without expectedChunks — server will save whatever it has.
      const res = await fetch(`/api/sessions/${sessionId}/transcribe-finalize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ uploadId: recoverableUploadId }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 300));
      }
      try { localStorage.removeItem(recoveryStorageKey(sessionId)); } catch {}
      void clearFailedChunksForUpload(recoverableUploadId);
      setRecoverableUploadId(null);
      failedChunksRef.current = new Map();
      setFailedChunks([]);
      toast({
        title: "Previous recording recovered",
        description: "Saved everything the server received before the interruption.",
      });
      qc.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "transcript"] });
      await refetchTranscript();
    } catch (err: any) {
      toast({
        title: "Recovery failed",
        description: err.message || "Could not recover the previous recording.",
        variant: "destructive",
      });
    } finally {
      setIsRecovering(false);
    }
  }, [recoverableUploadId, sessionId, refetchTranscript, toast]);

  const handleDiscardRecovery = useCallback(() => {
    try { localStorage.removeItem(recoveryStorageKey(sessionId)); } catch {}
    if (recoverableUploadId) {
      void clearFailedChunksForUpload(recoverableUploadId);
    }
    failedChunksRef.current = new Map();
    setFailedChunks([]);
    setRecoverableUploadId(null);
  }, [sessionId, recoverableUploadId]);

  // Enumerate audio input devices on mount and whenever the OS reports a
  // device change (e.g. plugging in a headset). Labels are usually empty
  // until the user grants mic permission once — we re-enumerate after
  // getUserMedia succeeds (see handleStart) so labels show after the first
  // recording.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const refresh = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devs) => {
          if (cancelled) return;
          setAudioDevices(devs.filter((d) => d.kind === "audioinput"));
        })
        .catch(() => {});
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  // Enforce the 2-hour soft cap. Warn at 1h45m, auto-pause at 2h with a
  // confirm to extend. Both are no-ops once the user agrees to extend.
  useEffect(() => {
    if (status !== "recording") return;
    if (elapsed >= WARN_AT_SECONDS && elapsed < MAX_AT_SECONDS && !warnedSoftCapRef.current) {
      warnedSoftCapRef.current = true;
      toast({
        title: "15 minutes left on this recording",
        description: "Recording will auto-pause at 2 hours. You can extend if needed.",
      });
    }
    if (elapsed >= MAX_AT_SECONDS && !extendedPast2hRef.current) {
      // Auto-pause now; ask the therapist if they want to keep going.
      handlePause();
      // Defer the confirm so the pause UI updates first.
      setTimeout(() => {
        const ok = window.confirm(
          "This recording has reached 2 hours. Continue recording past 2 hours?",
        );
        if (ok) {
          extendedPast2hRef.current = true;
          handleResume();
        }
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, status]);

  function cleanupRecording() {
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    tickTimerRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    webmInitRef.current = null;
    // Tear down level meter
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
    segmentMaxRmsRef.current = 0;
    warnedSoftCapRef.current = false;
    extendedPast2hRef.current = false;
  }

  function stopLevelMeter() {
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
    segmentMaxRmsRef.current = 0;
  }

  function startLevelMeter(stream: MediaStream) {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        // Track per-segment peak for the silence-skip decision
        if (rms > segmentMaxRmsRef.current) segmentMaxRmsRef.current = rms;
        // Boosted display value for the meter bar (visual only)
        setAudioLevel(Math.min(1, rms * 4));
        meterRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.warn("Level meter setup failed:", err);
    }
  }

  function startTick() {
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    tickTimerRef.current = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
  }

  function stopTick() {
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    tickTimerRef.current = null;
  }

  // Locate the first WebM Cluster element (EBML ID 0x1F43B675) in a buffer.
  // Everything before that is the WebM init segment (EBML header + Segment
  // info + Tracks). We cache those bytes once on the very first dataavailable
  // event and prepend them to subsequent chunks so each upload is a valid,
  // independently decodable file even though MediaRecorder only emits the
  // header in the first chunk.
  function findClusterStart(bytes: Uint8Array): number {
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (
        bytes[i] === 0x1f &&
        bytes[i + 1] === 0x43 &&
        bytes[i + 2] === 0xb6 &&
        bytes[i + 3] === 0x75
      ) {
        return i;
      }
    }
    return -1;
  }

  function startSegmentRecorder() {
    const stream = streamRef.current;
    if (!stream) return;

    const supportedMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
    mimeTypeRef.current = supportedMime;

    // 128 kbps Opus is "broadcast quality" for speech and well above the
    // bitrate Whisper actually needs — gives us headroom for soft talkers,
    // accents, and any background ambience.
    const recorder = new MediaRecorder(stream, {
      mimeType: supportedMime,
      audioBitsPerSecond: 128_000,
    });
    segmentStartRef.current = Date.now();
    webmInitRef.current = null;

    // Promise that resolves once this recorder's onstop has fully executed
    // (so handleStop / handlePause can await the final chunk being enqueued).
    let resolveStopped: () => void = () => {};
    stopFlushedRef.current = new Promise<void>((r) => {
      resolveStopped = r;
    });

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;

      // Measure THIS slice's duration from the previous boundary, then reset.
      const segmentDurationSec = (Date.now() - segmentStartRef.current) / 1000;
      segmentStartRef.current = Date.now();

      // Skip silent slices client-side to save Whisper cost. Peak RMS is
      // sampled by the live AnalyserNode and reset every slice.
      const segmentPeakRms = segmentMaxRmsRef.current;
      segmentMaxRmsRef.current = 0;
      const wasSilent = segmentPeakRms < SILENCE_RMS_THRESHOLD;

      // Assign idx synchronously here so chunk order is preserved even though
      // the upload work below is async.
      const idx = chunkIndexRef.current++;
      const eventData = event.data;
      const mime = mimeTypeRef.current;

      if (wasSilent) {
        // Truly-silent slice (mic muted / unplugged). Record duration so the
        // finalize step can insert `[silence ~Xs]` in the right position and
        // the LLM can't hallucinate across the gap.
        silentChunksRef.current.set(idx, segmentDurationSec);
        setSilentSkipped((c) => c + 1);
        return;
      }

      setChunksSent((c) => c + 1);
      // Queue extraction + upload sequentially so chunks reach the server in
      // order AND the init-segment is cached before chunk 1 starts uploading.
      uploadQueueRef.current = uploadQueueRef.current.then(async () => {
        let blobToSend: Blob = eventData;
        if (!webmInitRef.current && mime.includes("webm")) {
          // First slice — extract & cache the init segment, then upload as-is.
          try {
            const arr = new Uint8Array(await eventData.arrayBuffer());
            const clusterStart = findClusterStart(arr);
            if (clusterStart > 0) {
              webmInitRef.current = arr.slice(0, clusterStart);
            }
          } catch (err) {
            console.warn("[session-recorder] init-segment extract failed:", err);
          }
        } else if (webmInitRef.current && mime.includes("webm")) {
          // Subsequent slices contain only Cluster data — prepend cached init
          // bytes so this upload is a complete, decodable WebM file.
          blobToSend = new Blob([webmInitRef.current, eventData], { type: mime });
        }
        return uploadChunk(blobToSend, idx, segmentDurationSec, mime);
      });
    };

    recorder.onstop = () => {
      // Continuous-capture mode: there is no rotation. onstop only fires on
      // the user's final Stop (or pause via .pause() does not fire onstop).
      // The final dataavailable has already been queued above before this
      // event runs, so the upload queue contains the trailing chunk.
      resolveStopped();
    };

    // Timeslice mode: dataavailable fires every SLICE_SECONDS without ever
    // stopping the recorder, so capture is gap-free across the whole session.
    recorder.start(SLICE_SECONDS * 1000);
    recorderRef.current = recorder;
  }

  async function uploadChunk(blob: Blob, index: number, durationSec: number, mime: string) {
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    // Retry up to 2 times with backoff before giving up on this chunk
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const fd = new FormData();
        fd.append("audio", blob, `chunk-${index}.${ext}`);
        fd.append("uploadId", uploadIdRef.current);
        fd.append("chunkIndex", String(index));
        fd.append("chunkDurationSeconds", String(durationSec));
        if (language) fd.append("language", language);

        const csrfToken = getCsrfToken();
        const res = await fetch(`/api/sessions/${sessionId}/transcribe-chunk`, {
          method: "POST",
          body: fd,
          credentials: "include",
          headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText.slice(0, 300));
        }
        const data = await res.json();
        failedChunksRef.current.delete(index);
        setFailedChunks((prev) => prev.filter((i) => i !== index));
        // Drop the IDB-persisted backup too — chunk is safely on the server.
        if (uploadIdRef.current) {
          void deleteFailedChunk(uploadIdRef.current, index);
        }
        setChunksUploaded((c) => c + 1);
        // Reset the stall watchdog — uploads are flowing.
        lastUploadAtRef.current = Date.now();
        setUploadStalled(false);
        if (data.chunkText) {
          setPreviewText((prev) => (prev ? prev + " " : "") + data.chunkText);
        }
        return;
      } catch (err: any) {
        console.error(`Chunk ${index} attempt ${attempt} failed:`, err);
        if (attempt === maxAttempts) {
          // Keep the audio Blob so the user can retry this exact chunk.
          failedChunksRef.current.set(index, { blob, durationSec, mime });
          // Mirror to IndexedDB so a tab refresh doesn't lose the audio —
          // the user can rehydrate retry buttons via the recovery banner.
          if (uploadIdRef.current) {
            void putFailedChunk({
              uploadId: uploadIdRef.current,
              sessionId,
              index,
              durationSec,
              mime,
              blob,
            });
          }
          setFailedChunks((prev) =>
            prev.includes(index) ? prev : [...prev, index].sort((a, b) => a - b),
          );
          setErrorMsg(
            `Chunk ${index} failed to transcribe. Use the Retry button below before saving.`,
          );
          toast({
            title: `Chunk ${index} failed`,
            description: err.message || "A recording chunk could not be transcribed.",
            variant: "destructive",
          });
          return;
        }
        // Backoff: 1s, 2s
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  // User-triggered retry of a single failed chunk. Re-uses the original Blob
  // we kept in failedChunksRef. The retry is chained into `uploadQueueRef` so
  // that `handleStop` (which awaits the upload queue) cannot finalize while a
  // retry is still in-flight.
  const retryChunk = useCallback(
    async (index: number) => {
      const failed = failedChunksRef.current.get(index);
      if (!failed) return;
      setRetryingChunks((prev) => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });
      const retryPromise = uploadQueueRef.current
        .catch(() => undefined)
        .then(() => uploadChunk(failed.blob, index, failed.durationSec, failed.mime));
      uploadQueueRef.current = retryPromise.catch(() => undefined);
      try {
        await retryPromise;
        if (!failedChunksRef.current.has(index)) {
          if (failedChunksRef.current.size === 0) {
            setErrorMsg(null);
          }
          toast({
            title: `Chunk ${index} retried`,
            description: "The chunk was transcribed successfully.",
          });
        }
      } finally {
        setRetryingChunks((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, sessionId],
  );

  const handleStart = useCallback(async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Whisper internally resamples to 16 kHz mono, but we capture at
          // 48 kHz mono for the cleanest possible source — matches what most
          // professional audio formats use and is what Opus encodes natively.
          // Use `ideal` so Safari / older mobile browsers fall back to their
          // native rate instead of throwing OverconstrainedError.
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
        } as MediaTrackConstraints,
      });
      streamRef.current = stream;
      // Phase 3: server mints the uploadId. We never trust a client-generated
      // one — the chunk endpoint will reject any id not produced by
      // /transcribe-start. This prevents another user from guessing or
      // hijacking an in-progress upload.
      const csrfToken = getCsrfToken();
      const startRes = await fetch(`/api/sessions/${sessionId}/transcribe-start`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          language: language || "auto",
          translateToEnglish,
        }),
      });
      if (!startRes.ok) {
        const t = await startRes.text();
        // Stop the mic stream we just opened — start failed.
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        throw new Error(t.slice(0, 300) || "Failed to start recording session");
      }
      const startBody = await startRes.json();
      uploadIdRef.current = String(startBody.uploadId || "");
      if (!uploadIdRef.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        throw new Error("Server did not return an uploadId");
      }
      // Persist the uploadId so a tab crash / accidental refresh doesn't
      // orphan whatever the server already received. handleStop / delete
      // clear this; on mount we look it up and offer "Recover unsaved
      // recording" so therapists can save what's there instead of losing it.
      try {
        localStorage.setItem(
          recoveryStorageKey(sessionId),
          JSON.stringify({ uploadId: uploadIdRef.current, startedAt: Date.now() }),
        );
      } catch {}
      lastUploadAtRef.current = Date.now();
      setUploadStalled(false);
      setRecoverableUploadId(null);
      chunkIndexRef.current = 0;
      stoppingRef.current = false;
      isPausedRef.current = false;
      failedChunksRef.current = new Map();
      silentChunksRef.current = new Map();
      setSilentSkipped(0);
      setFailedChunks([]);
      setRetryingChunks(new Set());
      uploadQueueRef.current = Promise.resolve();
      setChunksSent(0);
      setChunksUploaded(0);
      setPreviewText("");
      setElapsed(0);
      setSilentSkipped(0);
      warnedSoftCapRef.current = false;
      extendedPast2hRef.current = false;
      segmentMaxRmsRef.current = 0;
      setStatus("recording");
      startLevelMeter(stream);
      startSegmentRecorder();
      startTick();
      // After the first successful getUserMedia, device labels become
      // populated — refresh the picker so names show instead of empty strings.
      navigator.mediaDevices
        ?.enumerateDevices?.()
        .then((d) => setAudioDevices(d.filter((x) => x.kind === "audioinput")))
        .catch(() => {});
    } catch (err: any) {
      console.error("Mic access error:", err);
      toast({
        title: "Microphone access denied",
        description: err.message || "Please allow microphone access to record.",
        variant: "destructive",
      });
      setStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selectedDeviceId]);

  const handlePause = useCallback(() => {
    if (status !== "recording") return;
    stopTick();
    // Native MediaRecorder.pause() pauses the timeslice timer too, so we
    // don't lose the cached WebM init segment or risk a rotation gap.
    isPausedRef.current = true;
    setStatus("paused");
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.pause();
    }
  }, [status]);

  const handleResume = useCallback(() => {
    // Gate on the synchronous ref instead of the captured `status`. The
    // 2-hour auto-pause path schedules handleResume() via setTimeout from
    // a render where status was still "recording", so a `status !==
    // "paused"` check would early-return on a stale closure and silently
    // refuse to resume after the user confirms the extension.
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    // Reset the silence-detection peak — we only want to measure the new
    // slice, not whatever ambient noise accumulated during the pause.
    segmentMaxRmsRef.current = 0;
    // Reset segmentStart so the next slice's duration measurement doesn't
    // include the pause interval.
    segmentStartRef.current = Date.now();
    setStatus("recording");
    if (recorderRef.current && recorderRef.current.state === "paused") {
      recorderRef.current.resume();
    }
    startTick();
  }, [status]);

  const handleStop = useCallback(async () => {
    if (status === "idle") return;
    stoppingRef.current = true;
    stopTick();

    setStatus("finalizing");

    // Stop the continuous recorder if it's still capturing. Final
    // dataavailable fires (queueing the trailing slice) THEN onstop, so
    // awaiting stopFlushedRef ensures the trailing chunk is in the upload
    // queue before we await it below — closes the "last chunk dropped" race.
    if (
      recorderRef.current &&
      (recorderRef.current.state === "recording" ||
        recorderRef.current.state === "paused")
    ) {
      const flushed = stopFlushedRef.current;
      recorderRef.current.stop();
      try {
        await flushed;
      } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // Tear down the live mic-level meter and its AudioContext immediately
    // when the stream stops. Without this, the requestAnimationFrame loop
    // and AudioContext from each recording would leak across repeated
    // start/stop cycles, accumulating CPU usage and audio resources.
    stopLevelMeter();

    // Wait for all queued chunk uploads to finish (success or final failure)
    try {
      await uploadQueueRef.current;
    } catch (err) {
      console.error("Some chunks failed:", err);
    }

    // Block finalize if any chunk permanently failed — therapist must retry first
    if (failedChunksRef.current.size > 0) {
      const failedList = Array.from(failedChunksRef.current.keys()).sort((a, b) => a - b);
      setErrorMsg(
        `Cannot save transcript — chunk(s) ${failedList.join(", ")} failed to transcribe. ` +
          `Use the Retry buttons below to re-send the failed chunk(s), then click Stop & Save again.`,
      );
      toast({
        title: "Cannot save: missing chunks",
        description: `${failedList.length} recording chunk(s) failed. Click Retry next to each failed chunk, then Stop & Save.`,
        variant: "destructive",
      });
      setStatus("paused");
      isPausedRef.current = true;
      stoppingRef.current = false;
      return;
    }

    // Finalize: server stitches + diarizes + saves. Send chunk count so server
    // can also enforce missing-chunk safety (defense in depth).
    try {
      const csrfToken = getCsrfToken();
      const res = await fetch(`/api/sessions/${sessionId}/transcribe-finalize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          uploadId: uploadIdRef.current,
          totalChunks: chunkIndexRef.current,
          expectedChunks: chunkIndexRef.current,
          // Tell the server which indices were truly silent so it can insert
          // `[silence ~Xs]` markers in the right position instead of silently
          // gluing chunks across the gap (which made the LLM hallucinate).
          silentChunks: Array.from(silentChunksRef.current.entries()).map(
            ([index, durationSeconds]) => ({ index, durationSeconds }),
          ),
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 300));
      }
      toast({
        title: "Transcript saved",
        description: "Speaker-labeled transcript is ready.",
      });
      try { localStorage.removeItem(recoveryStorageKey(sessionId)); } catch {}
      if (uploadIdRef.current) {
        void clearFailedChunksForUpload(uploadIdRef.current);
      }
      setRecoverableUploadId(null);
      setStatus("idle");
      setElapsed(0);
      setChunksSent(0);
      setChunksUploaded(0);
      setPreviewText("");
      qc.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "transcript"] });
      await refetchTranscript();
    } catch (err: any) {
      console.error("Finalize error:", err);
      setErrorMsg(err.message || "Failed to finalize transcript");
      toast({
        title: "Finalize failed",
        description: err.message || "Could not save the transcript.",
        variant: "destructive",
      });
      setStatus("idle");
    }
  }, [sessionId, status, refetchTranscript, toast]);

  const handleDeleteTranscript = useCallback(async () => {
    if (!confirm("Delete this session transcript? This cannot be undone.")) return;
    try {
      const csrfToken = getCsrfToken();
      const res = await fetch(`/api/sessions/${sessionId}/transcript`, {
        method: "DELETE",
        credentials: "include",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
      });
      if (!res.ok) throw new Error(await res.text());
      try { localStorage.removeItem(recoveryStorageKey(sessionId)); } catch {}
      if (uploadIdRef.current) {
        void clearFailedChunksForUpload(uploadIdRef.current);
      }
      setRecoverableUploadId(null);
      toast({ title: "Transcript deleted" });
      qc.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "transcript"] });
      await refetchTranscript();
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err.message || "Could not delete transcript.",
        variant: "destructive",
      });
    }
  }, [sessionId, refetchTranscript, toast]);

  const isActive = status === "recording" || status === "paused";
  // Denominator includes silent chunks so the bar reflects the true timeline:
  // a session with 3 uploaded + 2 silent chunks shows 5 total (not 3).
  const totalChunksCaptured = chunksSent + silentSkipped;
  const uploadProgress =
    totalChunksCaptured > 0
      ? Math.round(((chunksUploaded + silentSkipped) / totalChunksCaptured) * 100)
      : 0;

  return (
    <Card data-testid="session-recorder" className="border-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Session Transcript
          </span>
          {existingTranscript && existingTranscript.status === "ready" && (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              Saved
            </Badge>
          )}
          {existingTranscript && existingTranscript.status === "processing" && (
            <Badge variant="outline" className="gap-1">Processing…</Badge>
          )}
          {existingTranscript && existingTranscript.status === "failed" && (
            <Badge variant="destructive" className="gap-1">Failed</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Reliability banners — must surface BEFORE controls so therapist sees them */}
        {!isOnline && (
          <Alert variant="destructive" data-testid="alert-offline">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              You're offline. Recording will keep capturing audio but chunks
              cannot upload until your connection returns. Don't refresh the
              page — chunks will retry automatically.
            </AlertDescription>
          </Alert>
        )}
        {uploadStalled && isOnline && (
          <Alert variant="destructive" data-testid="alert-stalled">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Uploads have stalled for over 90 seconds. Your connection may be
              slow or blocked. Check the network — chunks will keep retrying.
            </AlertDescription>
          </Alert>
        )}
        {recoverableUploadId && status === "idle" && (
          <Alert data-testid="alert-recovery">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex flex-col gap-2">
              <span>
                A previous recording for this session was not saved. We can
                recover everything the server received before the interruption.
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  data-testid="button-recover-recording"
                  onClick={handleRecover}
                  disabled={isRecovering}
                >
                  {isRecovering ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RotateCw className="h-3 w-3 mr-1" />
                  )}
                  Recover & save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="button-discard-recovery"
                  onClick={handleDiscardRecovery}
                  disabled={isRecovering}
                >
                  Discard
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Recording controls */}
        {!existingTranscript && status === "idle" && (
          <div className="flex flex-col items-center gap-3 py-2">
            {audioDevices.length > 1 && (
              <div className="w-full max-w-md space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Microphone
                </label>
                <Select
                  value={selectedDeviceId || "default"}
                  onValueChange={(v) => setSelectedDeviceId(v === "default" ? "" : v)}
                >
                  <SelectTrigger data-testid="select-mic-device">
                    <SelectValue placeholder="Default microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default microphone</SelectItem>
                    {audioDevices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="w-full max-w-md flex items-start justify-between gap-4 rounded-md border bg-muted/30 px-3 py-2">
              <div className="space-y-0.5">
                <label
                  htmlFor="translate-to-english"
                  className="text-sm font-medium cursor-pointer"
                >
                  Translate to English
                </label>
                <p className="text-xs text-muted-foreground">
                  For multilingual sessions. Transcript and AI notes will be in
                  English regardless of the spoken language. Cannot be changed
                  mid-recording.
                </p>
              </div>
              <Switch
                id="translate-to-english"
                checked={translateToEnglish}
                onCheckedChange={setTranslateToEnglish}
                disabled={status !== "idle"}
                data-testid="switch-translate-to-english"
              />
            </div>
            <Button
              type="button"
              data-testid="button-start-recording"
              onClick={handleStart}
              size="lg"
              className="gap-2 bg-red-600 hover:bg-red-700"
            >
              <Mic className="h-5 w-5" />
              Start Recording
            </Button>
            <p className="text-xs text-muted-foreground text-center max-w-md">
              Records the session in 60-second chunks, transcribes each chunk in real time, then
              auto-labels speakers (Therapist / Client). Audio is discarded after transcription.
              Maximum recording length is 2 hours.
            </p>
          </div>
        )}

        {isActive && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    status === "recording" ? "bg-red-500 animate-pulse" : "bg-yellow-500"
                  }`}
                />
                <span className="font-mono text-2xl tabular-nums" data-testid="text-elapsed">
                  {formatDuration(elapsed)}
                </span>
                <Badge variant={status === "recording" ? "destructive" : "secondary"}>
                  {status === "recording" ? "Recording" : "Paused"}
                </Badge>
              </div>
              <div className="flex gap-2">
                {status === "recording" ? (
                  <Button
                    type="button"
                    data-testid="button-pause-recording"
                    variant="outline"
                    size="sm"
                    onClick={handlePause}
                  >
                    <Pause className="h-4 w-4 mr-1" /> Pause
                  </Button>
                ) : (
                  <Button
                    type="button"
                    data-testid="button-resume-recording"
                    variant="outline"
                    size="sm"
                    onClick={handleResume}
                  >
                    <Play className="h-4 w-4 mr-1" /> Resume
                  </Button>
                )}
                <Button
                  type="button"
                  data-testid="button-stop-recording"
                  variant="destructive"
                  size="sm"
                  onClick={handleStop}
                >
                  <Square className="h-4 w-4 mr-1" /> Stop & Save
                </Button>
              </div>
            </div>

            {/* Live mic level meter — shows the therapist that audio is reaching the browser */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Mic className="h-3 w-3" /> Mic level
                </span>
              </div>
              <div className="h-2 w-full rounded bg-muted overflow-hidden">
                <div
                  data-testid="meter-mic-level"
                  className={`h-full transition-[width] duration-75 ${
                    audioLevel < 0.05
                      ? "bg-muted-foreground/40"
                      : audioLevel < 0.7
                        ? "bg-green-500"
                        : "bg-red-500"
                  }`}
                  style={{ width: `${Math.round(audioLevel * 100)}%` }}
                />
              </div>
            </div>

            {(chunksSent > 0 || silentSkipped > 0) && (
              <div
                className={`rounded-md border p-2 space-y-1 ${
                  failedChunks.length > 0
                    ? "border-destructive bg-destructive/10"
                    : chunksUploaded < chunksSent /* uploads still in flight */
                      ? "border-amber-500/60 bg-amber-50 dark:bg-amber-950/30"
                      : "border-border bg-muted/30"
                }`}
                data-testid="recorder-capture-status"
              >
                <div className="flex justify-between text-xs">
                  <span
                    className={`font-medium ${
                      failedChunks.length > 0
                        ? "text-destructive"
                        : "text-foreground"
                    }`}
                  >
                    Captured: {chunksUploaded + silentSkipped} / {totalChunksCaptured} chunks
                  </span>
                  <span className="text-muted-foreground">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground pt-0.5">
                  {failedChunks.length > 0 && (
                    <span
                      className="text-destructive font-medium"
                      data-testid="text-failed-chunks"
                    >
                      <AlertCircle className="inline h-3 w-3 mr-0.5" />
                      {failedChunks.length} failed — retry below
                    </span>
                  )}
                  {silentSkipped > 0 && (
                    <span
                      className="flex items-center gap-1 text-amber-600 dark:text-amber-400"
                      data-testid="text-silent-skipped"
                    >
                      <VolumeX className="h-3 w-3" />
                      {silentSkipped} silent gap{silentSkipped === 1 ? "" : "s"} (mic muted)
                    </span>
                  )}
                </div>
              </div>
            )}

            {elapsed >= WARN_AT_SECONDS && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {elapsed >= MAX_AT_SECONDS
                    ? "Reached 2-hour cap — recording auto-paused."
                    : "Approaching the 2-hour cap. Recording will auto-pause at 2 hours."}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-end gap-2">
              <label
                htmlFor="hide-preview-toggle"
                className="text-xs text-muted-foreground select-none cursor-pointer"
              >
                Hide live preview (screen-share safe)
              </label>
              <input
                id="hide-preview-toggle"
                data-testid="switch-hide-preview"
                type="checkbox"
                checked={hidePreview}
                onChange={(e) => setHidePreview(e.target.checked)}
                className="h-4 w-4 cursor-pointer"
              />
            </div>

            {previewText && (
              <div className="rounded-md border bg-muted/40 p-3 max-h-32 overflow-y-auto text-sm">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {hidePreview ? "Recording…" : "Live transcription preview"}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      data-testid="button-copy-preview"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(previewText);
                          toast({ title: "Copied preview to clipboard" });
                        } catch {
                          toast({
                            title: "Copy failed",
                            description: "Browser blocked clipboard access.",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      data-testid="button-download-preview"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => {
                        const blob = new Blob([previewText], {
                          type: "text/plain;charset=utf-8",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `session-${sessionId}-preview.txt`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div data-testid="text-preview">
                  {hidePreview
                    ? "Live preview hidden for privacy. Transcription is still being captured in the background."
                    : previewText}
                </div>
              </div>
            )}
          </div>
        )}

        {status === "finalizing" && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Stitching chunks and labeling speakers… this can take a minute.
          </div>
        )}

        {errorMsg && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {/* Per-chunk retry: one button per failed chunk, re-uses the cached audio Blob */}
        {failedChunks.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
            <div className="text-xs font-medium text-destructive">
              {failedChunks.length} chunk(s) failed to transcribe — retry each one before saving:
            </div>
            <div className="flex flex-wrap gap-2">
              {failedChunks.map((idx) => {
                const isRetrying = retryingChunks.has(idx);
                return (
                  <Button
                    key={idx}
                    type="button"
                    data-testid={`button-retry-chunk-${idx}`}
                    variant="outline"
                    size="sm"
                    disabled={isRetrying}
                    onClick={() => retryChunk(idx)}
                  >
                    {isRetrying ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <RotateCw className="h-3 w-3 mr-1" />
                    )}
                    Retry chunk {idx}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Refresh-safe finalize: if a saved transcript is still 'processing'
            (e.g. user refreshed the page mid-finalize), show a waiting state
            and let the polling refetchInterval pick up 'ready' or 'failed'. */}
        {existingTranscript && existingTranscript.status === "processing" && status === "idle" && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Transcript is still being processed on the server… this page will refresh
            automatically when it's ready.
          </div>
        )}

        {existingTranscript && existingTranscript.status === "failed" && status === "idle" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Transcript processing failed
              {existingTranscript.errorMessage ? `: ${existingTranscript.errorMessage}` : "."}
              {" "}You can delete this and record again.
            </AlertDescription>
          </Alert>
        )}

        {/* Existing transcript display */}
        {existingTranscript && existingTranscript.status === "ready" && status === "idle" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <span>
                  Duration:{" "}
                  {existingTranscript.durationSeconds
                    ? formatDuration(existingTranscript.durationSeconds)
                    : "—"}
                </span>
                <span>Chunks: {existingTranscript.chunkCount ?? "—"}</span>
                <span>Words: {existingTranscript.wordCount ?? "—"}</span>
              </div>
              <div className="flex gap-1">
                {existingTranscript.rawContent && (
                  <Button
                    type="button"
                    data-testid="button-toggle-raw-inline"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRawInline((v) => !v)}
                    title={showRawInline ? "Show speaker-labeled" : "Show original (no labels)"}
                  >
                    {showRawInline ? (
                      <>
                        <Tag className="h-4 w-4 mr-1" />
                        Show labeled
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 mr-1" />
                        Show original
                      </>
                    )}
                  </Button>
                )}
                {onRequestSmartFill && (
                  <Button
                    type="button"
                    data-testid="button-smart-fill-from-transcript"
                    variant="outline"
                    size="sm"
                    onClick={onRequestSmartFill}
                    className="text-purple-700 border-purple-300 hover:bg-purple-50 hover:text-purple-800 dark:text-purple-300 dark:border-purple-700"
                  >
                    <Sparkles className="h-4 w-4 mr-1" />
                    Smart Fill Note Fields
                  </Button>
                )}
                <Button
                  type="button"
                  data-testid="button-delete-transcript"
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteTranscript}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
            <div
              data-testid="text-transcript"
              className="rounded-md border bg-muted/30 p-4 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm font-mono leading-relaxed"
            >
              {showRawInline && existingTranscript.rawContent
                ? existingTranscript.rawContent
                : existingTranscript.content}
            </div>
            <p className="text-xs text-muted-foreground">
              Transcript saved as a separate document. It is not auto-pasted into your session
              note — copy/paste any portions you want into Symptoms, Progress, etc.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
