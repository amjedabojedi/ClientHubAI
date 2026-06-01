import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, Languages, RotateCw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getCsrfToken } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";

interface CommunicationVoiceRecorderProps {
  clientId: number;
  onTranscriptionComplete: (text: string) => void;
}

// MediaRecorder timeslice. 20-second slices keep each upload small (well under
// the 25 MB Whisper limit) and let transcription happen continuously while the
// user is still talking, so a multi-minute dictation isn't stuck uploading one
// huge blob at the end.
const SLICE_SECONDS = 20;

// Locate the first WebM Cluster element (EBML ID 0x1F43B675) in a buffer.
// Everything before it is the WebM init segment (EBML header + Segment info +
// Tracks). With a single continuous MediaRecorder + timeslice, only the FIRST
// dataavailable carries the init segment; later slices are raw Cluster data and
// aren't independently decodable. We cache the init bytes once and prepend them
// to subsequent slices so every chunk is a complete, decodable file.
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

export function CommunicationVoiceRecorder({
  clientId,
  onTranscriptionComplete,
}: CommunicationVoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [translateToEnglish, setTranslateToEnglish] = useState(false);
  const [chunksSent, setChunksSent] = useState(0);
  const [chunksUploaded, setChunksUploaded] = useState(0);
  const [failedChunks, setFailedChunks] = useState<number[]>([]);
  const [retryingChunks, setRetryingChunks] = useState<Set<number>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Per-chunk transcribed text, keyed by chunk index, shown as a running live
  // preview while recording. This is only a preview — the final saved text comes
  // from the finalize step (single source of truth).
  const [chunkTexts, setChunkTexts] = useState<Record<number, string>>({});
  const { toast } = useToast();

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm");
  const uploadIdRef = useRef<string>("");
  const chunkIndexRef = useRef<number>(0);
  const webmInitRef = useRef<Uint8Array | null>(null);
  const segmentStartRef = useRef<number>(0);
  // Serialises chunk extraction + upload so chunks reach the server in order
  // and the init segment is cached before chunk 1 is sent.
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Resolves once the final dataavailable (queued on stop) has been enqueued.
  const stopFlushedRef = useRef<Promise<void>>(Promise.resolve());
  // Keeps the audio blob for any permanently-failed chunk so the user can retry
  // that exact chunk before saving.
  const failedChunksRef = useRef<
    Map<number, { blob: Blob; durationSec: number; mime: string }>
  >(new Map());

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const resetState = () => {
    setChunksSent(0);
    setChunksUploaded(0);
    setFailedChunks([]);
    setRetryingChunks(new Set());
    setErrorMsg(null);
    setChunkTexts({});
    chunkIndexRef.current = 0;
    webmInitRef.current = null;
    uploadIdRef.current = "";
    uploadQueueRef.current = Promise.resolve();
    stopFlushedRef.current = Promise.resolve();
    failedChunksRef.current = new Map();
  };

  const startRecording = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Server mints the uploadId. We never trust a client-generated one — the
      // chunk endpoint rejects any id not produced by /transcribe-start.
      let startBody: { uploadId?: string };
      try {
        const startRes = await apiRequest(
          "/api/communications/transcribe-start",
          "POST",
          { clientId, translateToEnglish },
        );
        startBody = await startRes.json();
      } catch (err: any) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        throw new Error(err?.message || "Failed to start recording session");
      }
      uploadIdRef.current = String(startBody.uploadId || "");
      if (!uploadIdRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        throw new Error("Server did not return an uploadId");
      }

      resetState();
      // resetState clears uploadIdRef — set it again after.
      uploadIdRef.current = String(startBody.uploadId || "");

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128_000,
      });
      mediaRecorderRef.current = mediaRecorder;
      segmentStartRef.current = Date.now();

      let resolveStopped: () => void = () => {};
      stopFlushedRef.current = new Promise<void>((r) => {
        resolveStopped = r;
      });

      mediaRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;

        const segmentDurationSec = (Date.now() - segmentStartRef.current) / 1000;
        segmentStartRef.current = Date.now();

        const idx = chunkIndexRef.current++;
        const eventData = event.data;
        const mime = mimeTypeRef.current;
        setChunksSent((c) => c + 1);

        uploadQueueRef.current = uploadQueueRef.current.then(async () => {
          let blobToSend: Blob = eventData;
          if (!webmInitRef.current && mime.includes("webm")) {
            try {
              const arr = new Uint8Array(await eventData.arrayBuffer());
              const clusterStart = findClusterStart(arr);
              if (clusterStart > 0) {
                webmInitRef.current = arr.slice(0, clusterStart);
              }
            } catch (err) {
              console.warn("[comm-recorder] init-segment extract failed:", err);
            }
          } else if (webmInitRef.current && mime.includes("webm")) {
            blobToSend = new Blob([webmInitRef.current, eventData], { type: mime });
          }
          return uploadChunk(blobToSend, idx, segmentDurationSec, mime);
        });
      };

      mediaRecorder.onstop = () => {
        resolveStopped();
      };

      mediaRecorder.start(SLICE_SECONDS * 1000);
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      toast({
        title: "Recording started",
        description: "Speak clearly. Your dictation uploads as you go.",
      });
    } catch (error: any) {
      console.error("Failed to start recording:", error);
      setErrorMsg(error.message || "Could not access microphone");
      toast({
        title: "Recording failed",
        description: error.message || "Could not access microphone",
        variant: "destructive",
      });
    }
  };

  async function uploadChunk(blob: Blob, index: number, durationSec: number, mime: string) {
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const fd = new FormData();
        fd.append("audio", blob, `chunk-${index}.${ext}`);
        fd.append("uploadId", uploadIdRef.current);
        fd.append("chunkIndex", String(index));
        fd.append("chunkDurationSeconds", String(durationSec));

        const csrfToken = getCsrfToken();
        const res = await fetch("/api/communications/transcribe-chunk", {
          method: "POST",
          body: fd,
          credentials: "include",
          headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText.slice(0, 300));
        }
        const body = await res.json();
        const text = typeof body?.chunkText === "string" ? body.chunkText : "";
        setChunkTexts((prev) => ({ ...prev, [index]: text }));
        failedChunksRef.current.delete(index);
        setFailedChunks((prev) => prev.filter((i) => i !== index));
        setChunksUploaded((c) => c + 1);
        return;
      } catch (err: any) {
        console.error(`Chunk ${index} attempt ${attempt} failed:`, err);
        if (attempt === maxAttempts) {
          failedChunksRef.current.set(index, { blob, durationSec, mime });
          setFailedChunks((prev) =>
            prev.includes(index) ? prev : [...prev, index].sort((a, b) => a - b),
          );
          setErrorMsg(
            `A recording chunk failed to upload. Use the Retry button below before saving.`,
          );
          return;
        }
        // Backoff: 1s, 2s.
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  const retryChunk = async (index: number) => {
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
        if (failedChunksRef.current.size === 0) setErrorMsg(null);
        toast({
          title: `Chunk retried`,
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
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }
    setIsRecording(false);
    setIsProcessing(true);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop the recorder; the final dataavailable fires (queuing the trailing
    // slice) THEN onstop, so awaiting stopFlushedRef guarantees the last chunk
    // is in the upload queue before we await it.
    const flushed = stopFlushedRef.current;
    try {
      mediaRecorderRef.current.stop();
      await flushed;
    } catch {}

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Wait for all queued chunk uploads to finish (success or final failure).
    try {
      await uploadQueueRef.current;
    } catch (err) {
      console.error("Some chunks failed:", err);
    }

    await finalize();
  };

  const finalize = async () => {
    // Block finalize if any chunk permanently failed — user must retry first.
    if (failedChunksRef.current.size > 0) {
      const failedList = Array.from(failedChunksRef.current.keys()).sort((a, b) => a - b);
      setIsProcessing(false);
      setErrorMsg(
        `Cannot save — chunk(s) ${failedList.join(", ")} failed to upload. ` +
          `Use the Retry button(s) below, then click Save Transcription.`,
      );
      toast({
        title: "Cannot save: missing chunks",
        description: `${failedList.length} recording chunk(s) failed. Retry them to continue.`,
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const res = await apiRequest(
        "/api/communications/transcribe-finalize",
        "POST",
        {
          uploadId: uploadIdRef.current,
          expectedChunks: chunkIndexRef.current,
        },
      );
      const result = await res.json();
      const text = (result?.transcription || "").trim();
      if (!text) {
        toast({
          title: "Nothing transcribed",
          description: "No speech was detected. Please try recording again.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Transcription complete",
        description: translateToEnglish
          ? "Audio transcribed and translated to English"
          : "Audio transcribed successfully",
      });
      onTranscriptionComplete(text);
      resetState();
    } catch (error: any) {
      console.error("Finalize failed:", error);
      setErrorMsg(error.message || "Could not save the transcription");
      toast({
        title: "Transcription failed",
        description: error.message || "Could not process audio",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const uploadProgress = chunksSent > 0 ? Math.round((chunksUploaded / chunksSent) * 100) : 0;
  const hasFailedChunks = failedChunks.length > 0;
  // Stitch each chunk's text together in index order for the running preview.
  const livePreview = Object.keys(chunkTexts)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => chunkTexts[i])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div className="space-y-3 p-3 border rounded-lg bg-slate-50">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Dictate with voice</span>
        <div className="flex items-center space-x-2">
          <Switch
            id="comm-translate-toggle"
            checked={translateToEnglish}
            onCheckedChange={setTranslateToEnglish}
            disabled={isRecording || isProcessing}
          />
          <Label
            htmlFor="comm-translate-toggle"
            className="flex items-center space-x-1 cursor-pointer text-xs"
          >
            <Languages className="w-3.5 h-3.5" />
            <span>Translate to English</span>
          </Label>
        </div>
      </div>

      {isRecording && (
        <div className="space-y-2 p-2 bg-red-50 rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            <div className="flex-1">
              <p className="text-xs font-medium text-red-900">Recording...</p>
              <p className="text-xs text-red-600 font-mono">{formatTime(recordingTime)}</p>
            </div>
            <p className="text-xs text-red-700" data-testid="text-comm-upload-progress">
              {chunksUploaded}/{chunksSent} chunks uploaded
            </p>
          </div>
          {chunksSent > 0 && (
            <Progress value={uploadProgress} className="h-1.5" />
          )}
        </div>
      )}

      {(isRecording || isProcessing) && livePreview && (
        <div
          className="space-y-1 p-2 bg-white border rounded-lg"
          data-testid="comm-live-preview"
        >
          <p className="text-xs font-medium text-slate-500">Live preview</p>
          <p className="text-sm text-slate-800 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
            {livePreview}
          </p>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg">
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
          <div className="flex-1">
            <p className="text-xs text-blue-900">
              {translateToEnglish ? "Transcribing and translating..." : "Transcribing audio..."}
            </p>
            <p className="text-xs text-blue-700" data-testid="text-comm-finalize-progress">
              {chunksUploaded}/{chunksSent} chunks uploaded
            </p>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-start space-x-2 p-2 bg-amber-50 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-900">{errorMsg}</p>
        </div>
      )}

      {hasFailedChunks && (
        <div className="space-y-1">
          {failedChunks.map((idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2 bg-red-50 rounded-lg"
            >
              <span className="text-xs text-red-900">Chunk {idx} failed to upload</span>
              <Button
                type="button"
                onClick={() => retryChunk(idx)}
                variant="outline"
                size="sm"
                className="gap-1.5 h-7"
                disabled={retryingChunks.has(idx)}
                data-testid={`button-retry-comm-chunk-${idx}`}
              >
                {retryingChunks.has(idx) ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCw className="w-3.5 h-3.5" />
                )}
                Retry
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {!isRecording && !isProcessing && !hasFailedChunks && (
          <Button
            type="button"
            onClick={startRecording}
            variant="outline"
            size="sm"
            className="gap-2"
            data-testid="button-start-comm-recording"
          >
            <Mic className="w-4 h-4" />
            Start Recording
          </Button>
        )}

        {isRecording && (
          <Button
            type="button"
            onClick={stopRecording}
            variant="destructive"
            size="sm"
            className="gap-2"
            data-testid="button-stop-comm-recording"
          >
            <Square className="w-4 h-4" />
            Stop Recording
          </Button>
        )}

        {!isRecording && !isProcessing && hasFailedChunks && (
          <Button
            type="button"
            onClick={finalize}
            variant="default"
            size="sm"
            className="gap-2"
            data-testid="button-save-comm-transcription"
          >
            Save Transcription
          </Button>
        )}
      </div>

      <p className="text-xs text-slate-500">
        The transcribed text will be added to the Details below. Existing text is kept.
      </p>
    </div>
  );
}
