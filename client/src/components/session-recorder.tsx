import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
}

const SLICE_SECONDS = 60;

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function SessionRecorder({ sessionId, language, onRequestSmartFill }: SessionRecorderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<"idle" | "recording" | "paused" | "finalizing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [chunksSent, setChunksSent] = useState(0);
  const [chunksUploaded, setChunksUploaded] = useState(0);
  const [previewText, setPreviewText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
  // Track failed chunk indexes so we can refuse to finalize a partial recording
  const failedChunksRef = useRef<Set<number>>(new Set());
  // Resolved when the most-recently-stopped recorder's onstop has run.
  // Lets handleStop() guarantee the final segment's upload is enqueued
  // before we await the upload queue.
  const stopFlushedRef = useRef<Promise<void>>(Promise.resolve());

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
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      if (segmentBlob.size > 0) {
        const idx = chunkIndexRef.current++;
        setChunksSent((c) => c + 1);
        // Queue upload sequentially so order is predictable
        uploadQueueRef.current = uploadQueueRef.current.then(() =>
          uploadChunk(segmentBlob, idx, segmentDurationSec, supportedMime),
        );
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
        setChunksUploaded((c) => c + 1);
        if (data.chunkText) {
          setPreviewText((prev) => (prev ? prev + " " : "") + data.chunkText);
        }
        return;
      } catch (err: any) {
        console.error(`Chunk ${index} attempt ${attempt} failed:`, err);
        if (attempt === maxAttempts) {
          failedChunksRef.current.add(index);
          setErrorMsg(
            `Chunk ${index} failed to transcribe. Stop & Save will be blocked until all chunks succeed.`,
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

  const handleStart = useCallback(async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
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
      failedChunksRef.current = new Set();
      uploadQueueRef.current = Promise.resolve();
      setChunksSent(0);
      setChunksUploaded(0);
      setPreviewText("");
      setElapsed(0);
      setStatus("recording");
      startSegmentRecorder();
      scheduleSliceRotation();
      startTick();
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
  }, [sessionId]);

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
    if (status !== "paused") return;
    isPausedRef.current = false;
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

    // Wait for all queued chunk uploads to finish (success or final failure)
    try {
      await uploadQueueRef.current;
    } catch (err) {
      console.error("Some chunks failed:", err);
    }

    // Block finalize if any chunk permanently failed — therapist must retry/cancel
    if (failedChunksRef.current.size > 0) {
      const failedList = Array.from(failedChunksRef.current).sort((a, b) => a - b);
      setErrorMsg(
        `Cannot save transcript — chunk(s) ${failedList.join(", ")} failed to transcribe. ` +
          `Please use Resume to keep recording and try again, or contact support.`,
      );
      toast({
        title: "Cannot save: missing chunks",
        description: `${failedList.length} recording chunk(s) failed. Resume recording to retry, or stop without saving.`,
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
          {existingTranscript && (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              Saved
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recording controls */}
        {!existingTranscript && status === "idle" && (
          <div className="flex flex-col items-center gap-3 py-2">
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

            {previewText && (
              <div className="rounded-md border bg-muted/40 p-3 max-h-32 overflow-y-auto text-sm">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Live transcription preview
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

        {/* Existing transcript display */}
        {existingTranscript && status === "idle" && (
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
              {existingTranscript.content}
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
