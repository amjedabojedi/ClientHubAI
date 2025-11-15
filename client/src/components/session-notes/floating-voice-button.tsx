import { useState } from "react";
import { Mic, X } from "lucide-react";
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

  return (
    <>
      {/* Floating Microphone Button */}
      <Button
        data-testid="button-floating-voice-recorder"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg bg-blue-600 hover:bg-blue-700 z-50"
        title="Voice Recording"
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
            <div className="border rounded-lg p-4">
              <VoiceRecorder
                sessionNoteId={sessionNoteId}
                onTranscriptionComplete={(data) => {
                  onTranscriptionComplete(data);
                  setIsOpen(false); // Close panel after recording completes
                }}
              />
            </div>

            <p className="text-xs text-gray-500 text-center">
              Click Start Recording and speak naturally. AI will organize your notes into the appropriate fields.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
