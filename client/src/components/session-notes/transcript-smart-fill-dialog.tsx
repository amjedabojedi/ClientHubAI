import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type SmartFillSuggestion = {
  sessionFocus: string;
  symptoms: string;
  shortTermGoals: string;
  intervention: string;
  progress: string;
  remarks: string;
  recommendations: string;
};

type FieldKey = keyof SmartFillSuggestion;

const FIELDS: { key: FieldKey; label: string; description: string }[] = [
  { key: "sessionFocus", label: "Session Focus", description: "Central topic(s) of this session" },
  { key: "symptoms", label: "Symptoms", description: "Presenting symptoms or distress" },
  { key: "shortTermGoals", label: "Short-Term Goals", description: "Goals discussed for the coming weeks" },
  { key: "intervention", label: "Intervention", description: "Techniques the therapist used" },
  { key: "progress", label: "Progress", description: "Movement toward prior goals or new insights" },
  { key: "remarks", label: "Remarks", description: "Affect, engagement, risk indicators" },
  { key: "recommendations", label: "Recommendations", description: "Homework, referrals, next-session focus" },
];

interface TranscriptSmartFillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: number | null;
  /** Current values in the form, used to show what would be overwritten */
  currentValues: Partial<SmartFillSuggestion>;
  /** Called when therapist clicks Apply Selected */
  onApply: (values: Partial<SmartFillSuggestion>) => void;
}

export function TranscriptSmartFillDialog({
  open,
  onOpenChange,
  sessionId,
  currentValues,
  onApply,
}: TranscriptSmartFillDialogProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SmartFillSuggestion | null>(null);
  const [edited, setEdited] = useState<SmartFillSuggestion | null>(null);
  const [selected, setSelected] = useState<Record<FieldKey, boolean>>({
    sessionFocus: true,
    symptoms: true,
    shortTermGoals: true,
    intervention: true,
    progress: true,
    remarks: true,
    recommendations: true,
  });

  // Reset state and fetch suggestions whenever dialog opens with a session id
  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    const run = async () => {
      setIsLoading(true);
      setError(null);
      setSuggestions(null);
      setEdited(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/transcript/smart-fill`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          let msg = `Request failed (${res.status})`;
          try {
            const body = await res.json();
            if (body?.message) msg = body.message;
          } catch {}
          throw new Error(msg);
        }
        const data = await res.json();
        if (cancelled) return;
        const sug: SmartFillSuggestion = data.suggestions || {};
        setSuggestions(sug);
        setEdited({ ...sug });
        // Auto-deselect fields the AI returned empty so therapist doesn't overwrite with nothing
        setSelected({
          sessionFocus: !!sug.sessionFocus?.trim(),
          symptoms: !!sug.symptoms?.trim(),
          shortTermGoals: !!sug.shortTermGoals?.trim(),
          intervention: !!sug.intervention?.trim(),
          progress: !!sug.progress?.trim(),
          remarks: !!sug.remarks?.trim(),
          recommendations: !!sug.recommendations?.trim(),
        });
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to generate suggestions");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const handleApply = () => {
    if (!edited) return;
    const toApply: Partial<SmartFillSuggestion> = {};
    let appliedCount = 0;
    (Object.keys(selected) as FieldKey[]).forEach((k) => {
      if (selected[k] && edited[k] && edited[k].trim().length > 0) {
        toApply[k] = edited[k];
        appliedCount++;
      }
    });
    if (appliedCount === 0) {
      toast({
        title: "Nothing to apply",
        description: "Select at least one non-empty field.",
        variant: "destructive",
      });
      return;
    }
    onApply(toApply);
    toast({
      title: "Note fields updated",
      description: `${appliedCount} field${appliedCount === 1 ? "" : "s"} populated from transcript.`,
    });
    onOpenChange(false);
  };

  const allSelected = (Object.keys(selected) as FieldKey[]).every((k) => selected[k]);
  const anyAvailable =
    !!edited &&
    (Object.keys(edited) as FieldKey[]).some((k) => edited[k] && edited[k].trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            Smart Fill Note Fields from Transcript
          </DialogTitle>
          <DialogDescription>
            AI extracted structured note fields from the session transcript. Review each suggestion,
            edit if needed, then choose which fields to apply. Nothing is changed until you click
            <strong> Apply Selected</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
              <div className="text-sm">
                Reading transcript and structuring clinical fields…
                <br />
                <span className="text-xs">This usually takes 15–45 seconds.</span>
              </div>
            </div>
          )}

          {!isLoading && error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!isLoading && !error && edited && (
            <>
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>
                    {Object.values(selected).filter(Boolean).length} of {FIELDS.length} fields
                    selected
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-toggle-all-smartfill"
                    onClick={() => {
                      const next = !allSelected;
                      const all: Record<FieldKey, boolean> = { ...selected };
                      (Object.keys(all) as FieldKey[]).forEach((k) => {
                        all[k] = next && !!edited[k]?.trim();
                      });
                      setSelected(all);
                    }}
                  >
                    {allSelected ? "Deselect all" : "Select all (with content)"}
                  </Button>
                </div>
              </div>

              {!anyAvailable && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    The AI didn't find clear content for any of the structured fields in this
                    transcript. You can still edit any field below to add content manually before
                    applying.
                  </AlertDescription>
                </Alert>
              )}

              {FIELDS.map(({ key, label, description }) => {
                const suggested = edited[key] || "";
                const current = (currentValues[key] || "").trim();
                const hasSuggestion = suggested.trim().length > 0;
                const willOverwrite = current.length > 0 && selected[key];
                return (
                  <div
                    key={key}
                    className="rounded-md border p-3 space-y-2"
                    data-testid={`smartfill-field-${key}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-2 cursor-pointer flex-1">
                        <Checkbox
                          checked={selected[key]}
                          disabled={!hasSuggestion}
                          onCheckedChange={(v) =>
                            setSelected((s) => ({ ...s, [key]: !!v }))
                          }
                          data-testid={`checkbox-smartfill-${key}`}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{label}</span>
                            {!hasSuggestion && (
                              <Badge variant="outline" className="text-xs">
                                No suggestion
                              </Badge>
                            )}
                            {willOverwrite && (
                              <Badge variant="destructive" className="text-xs">
                                Will overwrite existing
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {description}
                          </div>
                        </div>
                      </label>
                    </div>

                    <Textarea
                      value={suggested}
                      onChange={(e) =>
                        setEdited((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))
                      }
                      placeholder={hasSuggestion ? "" : "AI returned no suggestion — edit to add content."}
                      rows={Math.min(8, Math.max(2, Math.ceil(suggested.length / 80)))}
                      className="text-sm"
                      data-testid={`textarea-smartfill-${key}`}
                    />

                    {current.length > 0 && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer hover:text-foreground">
                          Show current value in form ({current.length} chars)
                        </summary>
                        <div className="mt-2 rounded bg-muted/40 p-2 whitespace-pre-wrap font-mono text-xs max-h-32 overflow-y-auto">
                          {current}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-smartfill"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={isLoading || !edited || !!error}
            className="bg-purple-600 hover:bg-purple-700"
            data-testid="button-apply-smartfill"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Apply Selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
