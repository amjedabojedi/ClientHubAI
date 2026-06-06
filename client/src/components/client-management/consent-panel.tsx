import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, ShieldCheck, AlertTriangle, Loader2, MessageSquare } from "lucide-react";
import { format } from "date-fns";

interface ConsentRecord {
  id: number;
  clientId: number;
  consentType: string;
  consentVersion: string;
  granted: boolean;
  grantedAt: string;
  withdrawnAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface Props {
  clientId: number;
}

const AI_TYPE = "ai_processing";
const SMS_TYPE = "sms_notifications";

export function ConsentPanel({ clientId }: Props) {
  const { data: consents = [], isLoading } = useQuery<ConsentRecord[]>({
    queryKey: ["/api/clients", String(clientId), "consents"],
    enabled: !!clientId,
  });

  return (
    <div className="space-y-8" data-testid="panel-consent">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Privacy &amp; Consent</h3>
        <p className="text-sm text-slate-600 mt-1">
          Record consent on behalf of the client when they sign the in-clinic consent form.
        </p>
      </div>

      <ConsentSection
        clientId={clientId}
        consentType={AI_TYPE}
        consents={consents}
        isLoading={isLoading}
        statusLabel="Current AI processing consent"
        notRecordedLabel="Not recorded — AI blocked"
        checkboxId="ai-consent-checkbox"
        checkboxTestId="checkbox-ai-consent"
        notesTestId="input-consent-notes"
        saveTestId="button-save-consent"
        toggleLabel="AI processing consent (recorded from signed consent form)"
        toggleHelp="Tick this only after the client has signed the consent form that explicitly authorizes AI-assisted clinical documentation. Untick to withdraw consent."
        notesPlaceholder="e.g., Signed consent form on 2026-04-22 at intake appointment"
        grantedToast={{
          title: "AI consent recorded",
          description: "The client can now have AI-assisted features used on their data.",
        }}
        withdrawnToast={{
          title: "AI consent withdrawn",
          description: "AI features are now blocked for this client.",
        }}
        icon={<ShieldCheck className="h-6 w-6 text-slate-400 shrink-0" />}
      />

      <ConsentSection
        clientId={clientId}
        consentType={SMS_TYPE}
        consents={consents}
        isLoading={isLoading}
        statusLabel="Current SMS notification consent"
        notRecordedLabel="Not recorded — no texts sent"
        checkboxId="sms-consent-checkbox"
        checkboxTestId="checkbox-sms-consent"
        notesTestId="input-sms-consent-notes"
        saveTestId="button-save-sms-consent"
        toggleLabel="SMS appointment notifications (client approved by phone/in person)"
        toggleHelp="Tick this only after the client has explicitly approved receiving appointment text messages (booking confirmations and reminders) to their mobile number. SMS is off by default. Untick to stop all texts."
        notesPlaceholder="e.g., Client verbally approved SMS reminders at intake on 2026-04-22"
        grantedToast={{
          title: "SMS consent recorded",
          description: "Appointment confirmations and reminders can now be texted to this client.",
        }}
        withdrawnToast={{
          title: "SMS consent withdrawn",
          description: "No further text messages will be sent to this client.",
        }}
        icon={<MessageSquare className="h-6 w-6 text-slate-400 shrink-0" />}
      />
    </div>
  );
}

interface ToastContent {
  title: string;
  description: string;
}

interface ConsentSectionProps {
  clientId: number;
  consentType: string;
  consents: ConsentRecord[];
  isLoading: boolean;
  statusLabel: string;
  notRecordedLabel: string;
  checkboxId: string;
  checkboxTestId: string;
  notesTestId: string;
  saveTestId: string;
  toggleLabel: string;
  toggleHelp: string;
  notesPlaceholder: string;
  grantedToast: ToastContent;
  withdrawnToast: ToastContent;
  icon: React.ReactNode;
}

function ConsentSection({
  clientId,
  consentType,
  consents,
  isLoading,
  statusLabel,
  notRecordedLabel,
  checkboxId,
  checkboxTestId,
  notesTestId,
  saveTestId,
  toggleLabel,
  toggleHelp,
  notesPlaceholder,
  grantedToast,
  withdrawnToast,
  icon,
}: ConsentSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const typeConsents = useMemo(
    () =>
      [...consents]
        .filter((c) => c.consentType === consentType)
        .sort(
          (a, b) =>
            new Date(b.grantedAt || b.createdAt).getTime() -
            new Date(a.grantedAt || a.createdAt).getTime(),
        ),
    [consents, consentType],
  );
  const latest = typeConsents[0];
  const isCurrentlyGranted = !!latest && latest.granted && !latest.withdrawnAt;

  const [granted, setGranted] = useState<boolean>(isCurrentlyGranted);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    setGranted(isCurrentlyGranted);
    setNotes("");
  }, [isCurrentlyGranted, clientId]);

  const dirty = granted !== isCurrentlyGranted || notes.trim().length > 0;

  const mutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/clients/${clientId}/consents`, "POST", {
        consentType,
        granted,
        consentVersion: "1.0.0",
        source: "signed_consent_form",
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "consents"] });
      toast(granted ? grantedToast : withdrawnToast);
      setNotes("");
    },
    onError: (error: any) => {
      toast({
        title: "Failed to record consent",
        description: error?.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4" data-testid={`consent-section-${consentType}`}>
      {/* Current status */}
      <div className="rounded-lg border bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-700">{statusLabel}</div>
            <div className="mt-1 flex items-center gap-2">
              {isLoading ? (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </Badge>
              ) : isCurrentlyGranted ? (
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100 gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Granted
                </Badge>
              ) : latest ? (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" /> Withdrawn
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> {notRecordedLabel}
                </Badge>
              )}
              {latest && (
                <span className="text-xs text-slate-500">
                  Last update: {format(new Date(latest.grantedAt || latest.createdAt), "PP p")}
                </span>
              )}
            </div>
            {latest?.notes && (
              <p className="mt-2 text-xs text-slate-600 italic">"{latest.notes}"</p>
            )}
          </div>
          {icon}
        </div>
      </div>

      {/* Toggle */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id={checkboxId}
            checked={granted}
            onCheckedChange={(v) => setGranted(v === true)}
            data-testid={checkboxTestId}
          />
          <div className="space-y-1">
            <Label htmlFor={checkboxId} className="text-sm font-medium cursor-pointer">
              {toggleLabel}
            </Label>
            <p className="text-xs text-slate-500">{toggleHelp}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${checkboxId}-notes`} className="text-sm">
            Notes (optional)
          </Label>
          <Textarea
            id={`${checkboxId}-notes`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={notesPlaceholder}
            className="min-h-[70px]"
            data-testid={notesTestId}
          />
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!dirty || mutation.isPending}
            data-testid={saveTestId}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {granted ? "Record Consent" : "Withdraw Consent"}
          </Button>
        </div>
      </div>

      {/* History */}
      {typeConsents.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-700 mb-2">History</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {typeConsents.map((c) => (
              <div key={c.id} className="rounded border p-2 text-xs flex items-start justify-between gap-2 bg-white">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    {c.granted && !c.withdrawnAt ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Granted</Badge>
                    ) : (
                      <Badge variant="destructive">Withdrawn</Badge>
                    )}
                    <span className="text-slate-600">v{c.consentVersion}</span>
                  </div>
                  {c.notes && <div className="text-slate-600 italic">"{c.notes}"</div>}
                </div>
                <div className="text-slate-500 shrink-0">
                  {format(new Date(c.grantedAt || c.createdAt), "PP p")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
