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
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryClient as qc, getCsrfToken } from "@/lib/queryClient";

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

const SLICE_SECONDS = 60;
// Max-duration cap: warn at 1h45m, auto-pause at 2h. Therapist may extend.
const WARN_AT_SECONDS = 105 * 60;
const MAX_AT_SECONDS = 120 * 60;
// Below this peak RMS, a 60s segment is considered silent and skipped to save Whisper cost.
// 0.005 ≈ -46 dBFS; quiet room noise is usually higher, intentional silence (mute, away) is lower.
const SILENCE_RMS_THRESHOLD = 0.005;

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
  const [audioLevel, setAudioLevel] = useState(0); // 0..1, smoothed RMS for the meter
  const [silentSkipped, setSilentSkipped] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentBuffersRef = useRef<Blob[]>([]);
  const segmentStartRef = useRef<number>(0);
  const sliceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (sliceTimerRef.current) clearTimeout(sliceTimerRef.current);
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    sliceTimerRef.current = null;
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
    segmentBuffersRef.current = [];
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

  function startSegmentRecorder() {
    const stream = streamRef.current;
    if (!stream) return;

    const supportedMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
    mimeTypeRef.current = supportedMime;

    const recorder = new MediaRecorder(stream, { mimeType: supportedMime });
    segmentBuffersRef.current = [];
    segmentStartRef.current = Date.now();

    // Promise that resolves once this recorder's onstop has fully executed
    // (so handleStop / handlePause can await the final chunk being enqueued).
    let resolveStopped: () => void = () => {};
    stopFlushedRef.current = new Promise<void>((r) => {
      resolveStopped = r;
    });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        segmentBuffersRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const segmentBlob = new Blob(segmentBuffersRef.current, { type: supportedMime });
      const segmentDurationSec = (Date.now() - segmentStartRef.current) / 1000;
      segmentBuffersRef.current = [];

      // Phase 2: skip silent segments client-side to save Whisper cost.
      // We use the peak RMS observed during this segment (live AnalyserNode).
      const segmentPeakRms = segmentMaxRmsRef.current;
      segmentMaxRmsRef.current = 0;
      const wasSilent = segmentPeakRms < SILENCE_RMS_THRESHOLD;

      if (segmentBlob.size > 0) {
        if (wasSilent) {
          // Drop the audio, don't bump chunkIndex — the next non-silent
          // segment uses the next index. expectedChunks math (computed at
          // finalize from chunksSent) stays consistent because we also
          // don't increment chunksSent here.
          setSilentSkipped((c) => c + 1);
        } else {
          const idx = chunkIndexRef.current++;
          setChunksSent((c) => c + 1);
          // Queue upload sequentially so order is predictable.
          // We capture the audio Blob in case the upload eventually fails — the
          // user can then retry the exact chunk via the Retry buttons.
          uploadQueueRef.current = uploadQueueRef.current.then(() =>
            uploadChunk(segmentBlob, idx, segmentDurationSec, supportedMime),
          );
        }
      }

      // If this stop was a slice rotation (not a pause and not a final stop),
      // immediately start a new segment so audio capture is uninterrupted.
      if (!stoppingRef.current && !isPausedRef.current) {
        startSegmentRecorder();
        scheduleSliceRotation();
      }
      resolveStopped();
    };

    recorder.start();
    recorderRef.current = recorder;
  }

  function scheduleSliceRotation() {
    if (sliceTimerRef.current) clearTimeout(sliceTimerRef.current);
    sliceTimerRef.current = setTimeout(() => {
      // Trigger segment cut: stop the current recorder. onstop will queue upload + start a new one.
      if (recorderRef.current && recorderRef.current.state === "recording") {
        recorderRef.current.stop();
      }
    }, SLICE_SECONDS * 1000);
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
        setChunksUploaded((c) => c + 1);
        if (data.chunkText) {
          setPreviewText((prev) => (prev ? prev + " " : "") + data.chunkText);
        }
        return;
      } catch (err: any) {
        console.error(`Chunk ${index} attempt ${attempt} failed:`, err);
        if (attempt === maxAttempts) {
          // Keep the audio Blob so the user can retry this exact chunk.
          failedChunksRef.current.set(index, { blob, durationSec, mime });
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
          sampleRate: 44100,
        },
      });
      streamRef.current = stream;
      uploadIdRef.current = `upload-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      chunkIndexRef.current = 0;
      stoppingRef.current = false;
      isPausedRef.current = false;
      failedChunksRef.current = new Map();
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
      scheduleSliceRotation();
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
    if (sliceTimerRef.current) clearTimeout(sliceTimerRef.current);
    sliceTimerRef.current = null;
    stopTick();
    // Set sync flag BEFORE calling stop() so onstop sees the new state.
    isPausedRef.current = true;
    setStatus("paused");
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
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
    // segment, not whatever ambient noise accumulated during the pause.
    segmentMaxRmsRef.current = 0;
    setStatus("recording");
    startSegmentRecorder();
    scheduleSliceRotation();
    startTick();
  }, [status]);

  const handleStop = useCallback(async () => {
    if (status === "idle") return;
    stoppingRef.current = true;
    if (sliceTimerRef.current) clearTimeout(sliceTimerRef.current);
    sliceTimerRef.current = null;
    stopTick();

    setStatus("finalizing");

    // Stop current segment if it's running and wait for its onstop to enqueue
    // the final upload BEFORE we await the upload queue. This prevents the
    // "last chunk dropped" race the architect flagged.
    if (recorderRef.current && recorderRef.current.state === "recording") {
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
  const uploadProgress = chunksSent > 0 ? Math.round((chunksUploaded / chunksSent) * 100) : 0;

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
                {silentSkipped > 0 && (
                  <span
                    className="flex items-center gap-1 text-amber-600 dark:text-amber-400"
                    data-testid="text-silent-skipped"
                  >
                    <VolumeX className="h-3 w-3" />
                    {silentSkipped} silent chunk{silentSkipped === 1 ? "" : "s"} skipped
                  </span>
                )}
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

            {chunksSent > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    Chunks transcribed: {chunksUploaded} / {chunksSent}
                  </span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
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

            {previewText && (
              <div className="rounded-md border bg-muted/40 p-3 max-h-32 overflow-y-auto text-sm">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    Live transcription preview
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
                <div data-testid="text-preview">{previewText}</div>
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
