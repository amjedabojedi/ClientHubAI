import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, Languages } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface AssessmentVoiceRecorderProps {
  questionId: number;
  onTranscriptionComplete: (text: string) => void;
  onCancel?: () => void;
}

export function AssessmentVoiceRecorder({ 
  questionId, 
  onTranscriptionComplete,
  onCancel 
}: AssessmentVoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [translateToEnglish, setTranslateToEnglish] = useState(false);
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
        
        // Upload and transcribe
        await uploadAndTranscribe(audioBlob);
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
      
      // Start timer
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      toast({
        title: "Recording started",
        description: "Speak clearly into your microphone",
      });
    } catch (error: any) {
      console.error('Failed to start recording:', error);
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
      // Create form data
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('questionId', String(questionId));
      formData.append('translateToEnglish', String(translateToEnglish));

      // Upload to backend (apiRequest automatically handles FormData)
      const response = await apiRequest('/api/assessments/transcribe', 'POST', formData);
      const result = await response.json();

      toast({
        title: "Transcription complete",
        description: translateToEnglish 
          ? "Audio transcribed and translated to English"
          : "Audio transcribed successfully",
      });

      // Pass transcribed text back to parent
      onTranscriptionComplete(result.transcription);

    } catch (error: any) {
      console.error('Transcription failed:', error);
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
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-slate-50 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-slate-900 dark:text-slate-100">Voice Recording</h4>
        {onCancel && !isRecording && !isProcessing && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {/* Translation Toggle */}
      <div className="flex items-center space-x-2">
        <Switch
          id="translate-toggle"
          checked={translateToEnglish}
          onCheckedChange={setTranslateToEnglish}
          disabled={isRecording || isProcessing}
        />
        <Label 
          htmlFor="translate-toggle" 
          className="flex items-center space-x-2 cursor-pointer"
        >
          <Languages className="w-4 h-4" />
          <span>Translate to English</span>
        </Label>
      </div>

      {/* Recording Status */}
      {isRecording && (
        <div className="flex items-center space-x-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <div className="flex-shrink-0">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900 dark:text-red-100">Recording...</p>
            <p className="text-xs text-red-600 dark:text-red-300">{formatTime(recordingTime)}</p>
          </div>
        </div>
      )}

      {/* Processing Status */}
      {isProcessing && (
        <div className="flex items-center space-x-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
          <p className="text-sm text-blue-900 dark:text-blue-100">
            {translateToEnglish ? "Transcribing and translating..." : "Transcribing audio..."}
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex space-x-2">
        {!isRecording && !isProcessing && (
          <Button
            onClick={startRecording}
            className="flex-1"
            data-testid="button-start-recording"
          >
            <Mic className="w-4 h-4 mr-2" />
            Start Recording
          </Button>
        )}

        {isRecording && (
          <Button
            onClick={stopRecording}
            variant="destructive"
            className="flex-1"
            data-testid="button-stop-recording"
          >
            <Square className="w-4 h-4 mr-2" />
            Stop Recording
          </Button>
        )}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {translateToEnglish 
          ? "Record in any language, and it will be transcribed and translated to English."
          : "Record in any language, and it will be transcribed as-is."}
      </p>
    </div>
  );
}
