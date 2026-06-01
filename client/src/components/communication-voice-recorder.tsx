import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, Languages } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface CommunicationVoiceRecorderProps {
  clientId: number;
  onTranscriptionComplete: (text: string) => void;
}

export function CommunicationVoiceRecorder({
  clientId,
  onTranscriptionComplete,
}: CommunicationVoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [translateToEnglish, setTranslateToEnglish] = useState(false);
  const { toast } = useToast();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm");

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        await uploadAndTranscribe(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);

      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      toast({
        title: "Recording started",
        description: "Speak clearly into your microphone",
      });
    } catch (error: any) {
      console.error("Failed to start recording:", error);
      toast({
        title: "Recording failed",
        description: error.message || "Could not access microphone",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const uploadAndTranscribe = async (audioBlob: Blob) => {
    setIsProcessing(true);

    try {
      const fileExtension = mimeTypeRef.current.includes("mp4") ? "mp4" : "webm";
      const formData = new FormData();
      formData.append("audio", audioBlob, `recording.${fileExtension}`);
      formData.append("clientId", String(clientId));
      formData.append("translateToEnglish", String(translateToEnglish));

      const response = await apiRequest("/api/communications/transcribe", "POST", formData);
      const result = await response.json();

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
    } catch (error: any) {
      console.error("Transcription failed:", error);
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
        <div className="flex items-center space-x-3 p-2 bg-red-50 rounded-lg">
          <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
          <div className="flex-1">
            <p className="text-xs font-medium text-red-900">Recording...</p>
            <p className="text-xs text-red-600 font-mono">{formatTime(recordingTime)}</p>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg">
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
          <p className="text-xs text-blue-900">
            {translateToEnglish ? "Transcribing and translating..." : "Transcribing audio..."}
          </p>
        </div>
      )}

      <div className="flex">
        {!isRecording && !isProcessing && (
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
      </div>

      <p className="text-xs text-slate-500">
        The transcribed text will be added to the Details below. Existing text is kept.
      </p>
    </div>
  );
}
