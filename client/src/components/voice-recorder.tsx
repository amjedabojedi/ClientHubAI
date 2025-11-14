import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface VoiceRecorderProps {
  sessionNoteId: number;
  onTranscriptionComplete: (data: {
    rawTranscription: string;
    mappedFields: {
      sessionFocus?: string;
      symptoms?: string;
      shortTermGoals?: string;
      intervention?: string;
      progress?: string;
      remarks?: string;
      recommendations?: string;
    };
  }) => void;
}

export function VoiceRecorder({ sessionNoteId, onTranscriptionComplete }: VoiceRecorderProps) {
  const [isRecording, isSetRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const { toast } = useToast();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
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
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : 'audio/mp4';
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Collect audio data
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle recording stop
      mediaRecorder.onstop = async () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        // Create audio blob
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        // Send to backend for transcription
        await transcribeAudio(audioBlob);
      };

      // Start recording
      mediaRecorder.start();
      isSetRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      toast({
        title: "Recording started",
        description: "Speak clearly into your microphone"
      });
    } catch (error: any) {
      console.error('Error starting recording:', error);
      toast({
        title: "Recording failed",
        description: error.message || "Could not access microphone",
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      isSetRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      toast({
        title: "Recording stopped",
        description: "Processing your audio..."
      });
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('audio', audioBlob, `recording-${Date.now()}.webm`);

      // Send to backend
      const result = await apiRequest(
        `/api/session-notes/${sessionNoteId}/transcribe`,
        {
          method: 'POST',
          body: formData
        }
      );

      toast({
        title: "Transcription complete!",
        description: "Session note fields have been auto-filled"
      });

      // Pass results to parent component
      onTranscriptionComplete(result);
    } catch (error: any) {
      console.error('Transcription error:', error);
      toast({
        title: "Transcription failed",
        description: error.message || "Could not transcribe audio",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setRecordingTime(0);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3">
      {!isRecording && !isProcessing && (
        <Button
          type="button"
          onClick={startRecording}
          variant="outline"
          className="gap-2"
          data-testid="button-start-recording"
        >
          <Mic className="h-4 w-4" />
          Start Voice Recording
        </Button>
      )}

      {isRecording && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={stopRecording}
            variant="destructive"
            className="gap-2"
            data-testid="button-stop-recording"
          >
            <Square className="h-4 w-4" />
            Stop Recording
          </Button>
          <div className="flex items-center gap-2 text-sm" data-testid="text-recording-time">
            <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono">{formatTime(recordingTime)}</span>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Transcribing audio...</span>
        </div>
      )}
    </div>
  );
}
