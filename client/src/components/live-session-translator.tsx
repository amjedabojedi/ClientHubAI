import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mic,
  Square,
  Loader2,
  AlertCircle,
  Languages,
  Radio,
  MessageSquare,
  MonitorSmartphone,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getCsrfToken } from "@/lib/queryClient";

interface TranslationMessage {
  id: number;
  originalText: string;
  translatedText: string;
  seqNumber: number;
  captionPushed: boolean;
}

interface LiveSessionTranslatorProps {
  sessionId: number;
}

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "hi", label: "Hindi" },
  { value: "ru", label: "Russian" },
  { value: "tr", label: "Turkish" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "fa", label: "Farsi/Persian" },
  { value: "ur", label: "Urdu" },
];

const CHUNK_INTERVAL_MS = 5000;

export function LiveSessionTranslator({ sessionId }: LiveSessionTranslatorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [therapistLang, setTherapistLang] = useState("en");
  const [clientLang, setClientLang] = useState("ar");
  const [zoomMeetingId, setZoomMeetingId] = useState("");
  const [sessionStatus, setSessionStatus] = useState<"setup" | "active" | "ending">("setup");
  const [hasZoomCaptions, setHasZoomCaptions] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const translationSessionIdRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkBufferRef = useRef<Blob[]>([]);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      stopMicCapture();
    };
  }, []);

  function stopMicCapture() {
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunkBufferRef.current = [];
  }

  const handleStartSession = useCallback(async () => {
    setErrorMsg(null);
    try {
      const csrfToken = getCsrfToken();
      const res = await fetch(`/api/sessions/${sessionId}/translation/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          therapistLanguage: therapistLang,
          clientLanguage: clientLang,
          zoomMeetingId: zoomMeetingId || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Failed to start" }));
        throw new Error(data.message);
      }
      const data = await res.json();
      translationSessionIdRef.current = data.id;
      setHasZoomCaptions(data.hasZoomCaptions);
      setSessionStatus("active");
      toast({ title: "Translation session started" });
    } catch (err: any) {
      setErrorMsg(err.message);
      toast({ title: "Failed to start", description: err.message, variant: "destructive" });
    }
  }, [sessionId, therapistLang, clientLang, zoomMeetingId, toast]);

  function enqueueChunk(blob: Blob) {
    if (blob.size < 100) return;
    uploadQueueRef.current = uploadQueueRef.current.then(() => sendChunkInternal(blob));
  }

  async function sendChunkInternal(blob: Blob) {
    setIsSending(true);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "chunk.webm");
      const csrfToken = getCsrfToken();
      const res = await fetch(`/api/sessions/${sessionId}/translation/speak`, {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Speak failed" }));
        throw new Error(data.message);
      }
      const data = await res.json();
      if (data.originalText) {
        setMessages((prev) => [...prev, data as TranslationMessage]);
      }
    } catch (err: any) {
      console.error("[TRANSLATOR] Send chunk error:", err);
    } finally {
      setIsSending(false);
    }
  }

  const handleStartRecording = useCallback(async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunkBufferRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunkBufferRef.current.push(e.data);
      };

      recorder.start(500);
      recorderRef.current = recorder;
      setIsRecording(true);

      chunkTimerRef.current = setInterval(() => {
        if (!recorderRef.current || recorderRef.current.state !== "recording") return;
        const oldRecorder = recorderRef.current;
        const newRecorder = new MediaRecorder(stream, { mimeType });
        newRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunkBufferRef.current.push(e.data);
        };
        newRecorder.start(500);
        recorderRef.current = newRecorder;
        const prevBuffers = chunkBufferRef.current;
        chunkBufferRef.current = [];
        oldRecorder.onstop = () => {
          const blob = new Blob(prevBuffers, { type: mimeType });
          enqueueChunk(blob);
        };
        oldRecorder.stop();
      }, CHUNK_INTERVAL_MS);
    } catch (err: any) {
      toast({ title: "Microphone error", description: err.message, variant: "destructive" });
    }
  }, [sessionId, toast]);

  const flushRecorder = useCallback((): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (chunkTimerRef.current) {
        clearInterval(chunkTimerRef.current);
        chunkTimerRef.current = null;
      }
      if (recorderRef.current && recorderRef.current.state === "recording") {
        const rec = recorderRef.current;
        const buffers = chunkBufferRef.current;
        chunkBufferRef.current = [];
        rec.onstop = () => {
          const blob = new Blob(buffers, { type: rec.mimeType });
          enqueueChunk(blob);
          resolve();
        };
        rec.stop();
      } else {
        resolve();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setIsRecording(false);
    });
  }, []);

  const handleStopRecording = useCallback(() => {
    flushRecorder();
  }, [flushRecorder]);

  const handleEndSession = useCallback(async () => {
    await flushRecorder();
    await uploadQueueRef.current;
    setSessionStatus("ending");
    try {
      const csrfToken = getCsrfToken();
      const res = await fetch(`/api/sessions/${sessionId}/translation/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "End failed" }));
        throw new Error(data.message);
      }
      const data = await res.json();
      toast({
        title: "Translation session ended",
        description: data.transcriptSaved
          ? `${data.messagesCount} messages saved to transcript.`
          : "Session ended (no messages to save).",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "transcript"] });
      setSessionStatus("setup");
      setMessages([]);
      translationSessionIdRef.current = null;
    } catch (err: any) {
      setErrorMsg(err.message);
      toast({ title: "End failed", description: err.message, variant: "destructive" });
      setSessionStatus("active");
    }
  }, [sessionId, handleStopRecording, queryClient, toast]);

  const langLabel = (code: string) => LANGUAGES.find((l) => l.value === code)?.label || code;

  if (sessionStatus === "setup") {
    return (
      <Card className="border-2 border-blue-200 dark:border-blue-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-5 w-5 text-blue-600" />
            Live Session Translator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Speak during your Zoom session — SmartHub will transcribe, translate, and push
            subtitles as Zoom closed captions in real time. The client just joins Zoom normally.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">You speak</Label>
              <Select value={therapistLang} onValueChange={setTherapistLang}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Client reads</Label>
              <Select value={clientLang} onValueChange={setClientLang}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Zoom Meeting ID (optional)</Label>
            <Input
              placeholder="e.g. 12345678901"
              value={zoomMeetingId}
              onChange={(e) => setZoomMeetingId(e.target.value)}
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              If provided, translated text will appear as closed captions in Zoom automatically.
              Leave blank to translate without Zoom captions.
            </p>
          </div>
          {errorMsg && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            onClick={handleStartSession}
            className="w-full gap-2 bg-blue-600 hover:bg-blue-700"
            disabled={therapistLang === clientLang}
          >
            <Languages className="h-4 w-4" />
            Start Translation Session
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (sessionStatus === "ending") {
    return (
      <Card className="border-2 border-blue-200 dark:border-blue-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-5 w-5 text-blue-600" />
            Live Session Translator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Ending session and saving transcript...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-blue-200 dark:border-blue-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Languages className="h-5 w-5 text-blue-600" />
            Live Translator
          </span>
          <div className="flex items-center gap-2">
            {hasZoomCaptions && (
              <Badge variant="outline" className="gap-1 text-green-700 border-green-300 dark:text-green-400 dark:border-green-700">
                <MonitorSmartphone className="h-3 w-3" />
                Zoom CC
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {langLabel(therapistLang)} → {langLabel(clientLang)}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {!isRecording ? (
            <Button
              type="button"
              onClick={handleStartRecording}
              size="sm"
              className="gap-2 bg-red-600 hover:bg-red-700 flex-1"
            >
              <Mic className="h-4 w-4" />
              Hold to Speak
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleStopRecording}
              size="sm"
              variant="destructive"
              className="gap-2 flex-1"
            >
              <Square className="h-4 w-4" />
              {isSending ? "Sending..." : "Stop Speaking"}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleEndSession}
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={isRecording}
          >
            End Session
          </Button>
        </div>

        {isRecording && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Radio className="h-3 w-3 text-red-500 animate-pulse" />
            Recording — speak naturally, chunks are sent every 5 seconds
          </div>
        )}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Transcribing and translating...
          </div>
        )}

        {errorMsg && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {messages.length > 0 && (
          <ScrollArea className="h-64 rounded-md border bg-muted/20 p-3">
            <div className="space-y-3">
              {messages.map((msg) => (
                <div key={msg.seqNumber} className="space-y-1">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="text-sm">
                      <span className="font-medium text-foreground">{msg.originalText}</span>
                    </div>
                  </div>
                  <div className="ml-5.5 pl-[22px] text-sm text-blue-700 dark:text-blue-300 italic">
                    → {msg.translatedText}
                    {msg.captionPushed && (
                      <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 text-green-600 border-green-300">
                        CC
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        )}

        {messages.length === 0 && (
          <div className="text-center py-4 text-xs text-muted-foreground">
            No messages yet — press "Hold to Speak" and start talking.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
