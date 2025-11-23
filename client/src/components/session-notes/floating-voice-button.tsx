import { useState } from "react";
import { Mic, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VoiceRecorder } from "@/components/voice-recorder";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

interface FloatingVoiceButtonProps {
  sessionNoteId?: number | null;
  clientName: string;
  sessionDate: string;
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

export function FloatingVoiceButton({
  sessionNoteId,
  clientName,
  sessionDate,
  onTranscriptionComplete,
}: FloatingVoiceButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  // Check if client is selected (not using default fallback)
  const isClientSelected = clientName !== 'Client';

  const handleOpenRecorder = () => {
    if (!isClientSelected) {
      toast({
        title: "Client Required",
        description: "Please select a client before using voice recording. This ensures proper consent validation.",
        variant: "destructive",
      });
      return;
    }
    setIsOpen(true);
  };

  return (
    <>
      {/* Floating Microphone Button */}
      <Button
        data-testid="button-floating-voice-recorder"
        onClick={handleOpenRecorder}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg bg-blue-600 hover:bg-blue-700 z-50 disabled:opacity-50 disabled:cursor-not-allowed"
        title={isClientSelected ? "Voice Recording" : "Please select a client first"}
        disabled={!isClientSelected}
      >
        <Mic className="h-6 w-6 text-white" />
      </Button>

      {/* Recording Panel Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[500px]" data-testid="dialog-voice-recording-panel">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-blue-600" />
              Voice Recording
            </DialogTitle>
            <DialogDescription>
              Record your session notes and AI will structure them automatically
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* GDPR Consent Warning - Only show if client not selected */}
            {!isClientSelected && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Please select a client before using voice recording. This is required for GDPR consent validation.
                </AlertDescription>
              </Alert>
            )}

            {/* Client & Session Context */}
            <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200">
              <CardContent className="pt-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Client:</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{clientName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Session:</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{sessionDate}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Voice Recorder Interface */}
            {isClientSelected ? (
              <div className="border rounded-lg p-4">
                <VoiceRecorder
                  sessionNoteId={sessionNoteId}
                  onTranscriptionComplete={(data) => {
                    onTranscriptionComplete(data);
                    setIsOpen(false); // Close panel after recording completes
                  }}
                />
              </div>
            ) : (
              <div className="border rounded-lg p-4 bg-gray-50 text-center">
                <p className="text-sm text-gray-600">Voice recording disabled until client is selected</p>
              </div>
            )}

            <p className="text-xs text-gray-500 text-center">
              Click Start Recording and speak naturally. AI will organize your notes into the appropriate fields.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
