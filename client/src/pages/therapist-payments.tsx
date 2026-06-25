import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DollarSign, Percent, Users, Receipt, History, Loader2, AlertTriangle,
  ChevronDown, ChevronRight, Ban,
} from "lucide-react";

type PayType = "percentage" | "fixed";

interface TherapistOption { id: number; fullName: string; role: string; }
interface ServiceOption { id: number; serviceCode: string; serviceName: string; baseRate: string; }
interface PayRule {
  id: number;
  therapistId: number;
  serviceId: number | null;
  payType: PayType;
  payValue: string;
}
interface OwedItem {
  sessionBillingId: number;
  sessionId: number;
  sessionDate: string;
  serviceId: number | null;
  serviceCode: string | null;
  serviceName: string | null;
  clientName: string;
  totalAmount: number;
  collectedAmount: number;
  payType: PayType | null;
  payValue: number | null;
  ruleSource: "service" | "default" | "none";
  amountEarned: number;
}
interface OwedResponse {
  therapistId: number;
  items: OwedItem[];
  total: number;
  unresolvedCount: number;
}
interface PayoutSummary {
  id: number;
  therapistId: number;
  therapistName: string;
  totalAmount: string;
  paymentDate: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  notes: string | null;
  status: string;
  itemCount: number;
  voidReason?: string | null;
}
interface PayoutItemDetail {
  id: number;
  sessionBillingId: number;
  sessionId: number;
  sessionDate: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  clientName: string;
  basisAmount: number;
  payType: string;
  payValue: number;
  amountEarned: number;
}
interface PayoutDetail extends PayoutSummary {
  items: PayoutItemDetail[];
}

const money = (n: number | string) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

const describeRule = (type: PayType | string | null, value: number | string | null) => {
  if (!type || value == null) return "No rule";
  return type === "percentage" ? `${Number(value)}% of collected` : `${money(value)} flat`;
};

export default function TherapistPaymentsPage() {
  const { toast } = useToast();
  const [therapistId, setTherapistId] = useState<number | null>(null);

  const { data: therapists = [], isLoading: loadingTherapists } = useQuery<TherapistOption[]>({
    queryKey: ["/api/therapist-pay/therapists"],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="h-7 w-7 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Therapist Payments</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Set pay rules, see what each therapist has earned from collected sessions, and record payouts.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Label className="mb-2 block">Select a therapist</Label>
          <Select
            value={therapistId != null ? String(therapistId) : ""}
            onValueChange={(v) => setTherapistId(Number(v))}
          >
            <SelectTrigger className="w-full max-w-md" data-testid="select-therapist">
              <SelectValue placeholder={loadingTherapists ? "Loading…" : "Choose a therapist"} />
            </SelectTrigger>
            <SelectContent>
              {therapists.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.fullName} ({t.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {therapistId == null ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <Users className="mx-auto mb-3 h-10 w-10 opacity-40" />
            Pick a therapist above to manage their pay rules and payouts.
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="rules" className="w-full">
          <TabsList>
            <TabsTrigger value="rules" data-testid="tab-rules">
              <Percent className="mr-2 h-4 w-4" /> Pay Profile
            </TabsTrigger>
            <TabsTrigger value="owed" data-testid="tab-owed">
              <Receipt className="mr-2 h-4 w-4" /> Owed / Record Payout
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <History className="mr-2 h-4 w-4" /> Payout History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="mt-4">
            <PayProfileTab therapistId={therapistId} toast={toast} />
          </TabsContent>
          <TabsContent value="owed" className="mt-4">
            <OwedTab therapistId={therapistId} toast={toast} />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <HistoryTab therapistId={therapistId} toast={toast} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/* ----------------------------- Pay Profile ----------------------------- */

function PayProfileTab({ therapistId, toast }: { therapistId: number; toast: ReturnType<typeof useToast>["toast"] }) {
  const { data: rules = [], isLoading: loadingRules } = useQuery<PayRule[]>({
    queryKey: ["/api/therapist-pay/rules", therapistId],
    queryFn: async () => {
      const res = await apiRequest(`/api/therapist-pay/rules/${therapistId}`, "GET");
      return res.json();
    },
  });
  const { data: services = [], isLoading: loadingServices } = useQuery<ServiceOption[]>({
    queryKey: ["/api/therapist-pay/services"],
  });

  const upsert = useMutation({
    mutationFn: (body: { serviceId: number | null; payType: PayType; payValue: string }) =>
      apiRequest("/api/therapist-pay/rules", "POST", { therapistId, ...body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/rules", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/owed", therapistId] });
      toast({ title: "Pay rule saved" });
    },
    onError: async (err: any) => {
      toast({ title: "Could not save", description: err?.message || "Please try again.", variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/therapist-pay/rules/${id}?therapistId=${therapistId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/rules", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/owed", therapistId] });
      toast({ title: "Override removed" });
    },
    onError: (err: any) =>
      toast({ title: "Could not remove", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  const defaultRule = rules.find((r) => r.serviceId == null) || null;
  const ruleByService = new Map<number, PayRule>();
  rules.forEach((r) => { if (r.serviceId != null) ruleByService.set(r.serviceId, r); });

  if (loadingRules || loadingServices) {
    return <div className="flex items-center gap-2 py-10 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading pay profile…</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Default rule</CardTitle>
          <CardDescription>
            Applied to any session whose service does not have its own override below. The percentage is taken from
            the amount actually collected (client + insurance payments).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuleEditor
            label="Default"
            initial={defaultRule}
            onSave={(payType, payValue) => upsert.mutate({ serviceId: null, payType, payValue })}
            onDelete={defaultRule ? () => remove.mutate(defaultRule.id) : undefined}
            saving={upsert.isPending}
            testIdPrefix="default"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Per-service overrides</CardTitle>
          <CardDescription>Set a specific rule for individual services. Leave blank to use the default.</CardDescription>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <p className="text-sm text-gray-500">No active services found.</p>
          ) : (
            <div className="space-y-3">
              {services.map((svc) => (
                <div key={svc.id} className="rounded-lg border p-3" data-testid={`service-rule-${svc.id}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <span className="font-medium">{svc.serviceName}</span>
                      <span className="ml-2 text-xs text-gray-500">{svc.serviceCode} · base {money(svc.baseRate)}</span>
                    </div>
                    {ruleByService.has(svc.id) && <Badge variant="secondary">Override set</Badge>}
                  </div>
                  <RuleEditor
                    label={svc.serviceName}
                    initial={ruleByService.get(svc.id) || null}
                    onSave={(payType, payValue) => upsert.mutate({ serviceId: svc.id, payType, payValue })}
                    onDelete={ruleByService.has(svc.id) ? () => remove.mutate(ruleByService.get(svc.id)!.id) : undefined}
                    saving={upsert.isPending}
                    testIdPrefix={`service-${svc.id}`}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RuleEditor({
  initial, onSave, onDelete, saving, testIdPrefix,
}: {
  label: string;
  initial: PayRule | null;
  onSave: (payType: PayType, payValue: string) => void;
  onDelete?: () => void;
  saving: boolean;
  testIdPrefix: string;
}) {
  const [payType, setPayType] = useState<PayType>(initial?.payType || "percentage");
  const [payValue, setPayValue] = useState<string>(initial?.payValue ?? "");

  const valid = payValue.trim() !== "" && isFinite(Number(payValue)) && Number(payValue) >= 0 &&
    !(payType === "percentage" && Number(payValue) > 100);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <Label className="text-xs">Type</Label>
        <Select value={payType} onValueChange={(v) => setPayType(v as PayType)}>
          <SelectTrigger data-testid={`select-paytype-${testIdPrefix}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="percentage">Percentage of collected</SelectItem>
            <SelectItem value="fixed">Fixed amount</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="w-36">
        <Label className="text-xs">{payType === "percentage" ? "Percent (%)" : "Amount ($)"}</Label>
        <Input
          type="number"
          min="0"
          step={payType === "percentage" ? "1" : "0.01"}
          value={payValue}
          onChange={(e) => setPayValue(e.target.value)}
          placeholder={payType === "percentage" ? "e.g. 60" : "e.g. 75.00"}
          data-testid={`input-payvalue-${testIdPrefix}`}
        />
      </div>
      <Button
        onClick={() => onSave(payType, payValue)}
        disabled={!valid || saving}
        data-testid={`button-save-${testIdPrefix}`}
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {initial ? "Update" : "Set rule"}
      </Button>
      {onDelete && (
        <Button variant="outline" onClick={onDelete} disabled={saving} data-testid={`button-delete-${testIdPrefix}`}>
          Remove
        </Button>
      )}
    </div>
  );
}

/* ------------------------------- Owed ------------------------------- */

function OwedTab({ therapistId, toast }: { therapistId: number; toast: ReturnType<typeof useToast>["toast"] }) {
  const { data, isLoading } = useQuery<OwedResponse>({
    queryKey: ["/api/therapist-pay/owed", therapistId],
    queryFn: async () => {
      const res = await apiRequest(`/api/therapist-pay/owed/${therapistId}`, "GET");
      return res.json();
    },
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  const items = data?.items || [];
  const payable = items.filter((i) => i.ruleSource !== "none");
  const selectedItems = payable.filter((i) => selected.has(i.sessionBillingId));
  const selectedTotal = selectedItems.reduce((sum, i) => sum + i.amountEarned, 0);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === payable.length ? new Set() : new Set(payable.map((i) => i.sessionBillingId)),
    );

  if (isLoading) {
    return <div className="flex items-center gap-2 py-10 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading owed sessions…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">Total currently owed (all payable sessions)</p>
          <p className="text-2xl font-bold" data-testid="text-total-owed">{money(data?.total || 0)}</p>
        </div>
        <Button
          disabled={selectedItems.length === 0}
          onClick={() => setDialogOpen(true)}
          data-testid="button-record-payout"
        >
          <DollarSign className="mr-2 h-4 w-4" />
          Record payout ({selectedItems.length}) · {money(selectedTotal)}
        </Button>
      </div>

      {data && data.unresolvedCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {data.unresolvedCount} collected session{data.unresolvedCount === 1 ? "" : "s"} have no matching pay rule and
            can&apos;t be paid out yet. Add a default rule or a per-service override in the Pay Profile tab.
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <Receipt className="mx-auto mb-3 h-10 w-10 opacity-40" />
            No collected, unpaid sessions for this therapist right now.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={payable.length > 0 && selected.size === payable.length}
                      onCheckedChange={toggleAll}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => {
                  const noRule = i.ruleSource === "none";
                  return (
                    <TableRow key={i.sessionBillingId} className={noRule ? "opacity-60" : ""} data-testid={`row-owed-${i.sessionBillingId}`}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(i.sessionBillingId)}
                          disabled={noRule}
                          onCheckedChange={() => toggle(i.sessionBillingId)}
                          data-testid={`checkbox-owed-${i.sessionBillingId}`}
                        />
                      </TableCell>
                      <TableCell>{fmtDate(i.sessionDate)}</TableCell>
                      <TableCell>{i.clientName}</TableCell>
                      <TableCell>
                        {i.serviceName || "—"}
                        {i.serviceCode ? <span className="ml-1 text-xs text-gray-500">{i.serviceCode}</span> : null}
                      </TableCell>
                      <TableCell className="text-right">{money(i.collectedAmount)}</TableCell>
                      <TableCell>
                        {noRule ? (
                          <Badge variant="destructive">No rule</Badge>
                        ) : (
                          <span className="text-xs">
                            {describeRule(i.payType, i.payValue)}
                            {i.ruleSource === "default" && <Badge variant="outline" className="ml-1">default</Badge>}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{noRule ? "—" : money(i.amountEarned)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <RecordPayoutDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        therapistId={therapistId}
        items={selectedItems}
        total={selectedTotal}
        toast={toast}
        onDone={() => { setSelected(new Set()); setDialogOpen(false); }}
      />
    </div>
  );
}

function RecordPayoutDialog({
  open, onOpenChange, therapistId, items, total, toast, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  therapistId: number;
  items: OwedItem[];
  total: number;
  toast: ReturnType<typeof useToast>["toast"];
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () =>
      apiRequest("/api/therapist-pay/payouts", "POST", {
        therapistId,
        paymentDate,
        paymentMethod: paymentMethod || null,
        referenceNumber: referenceNumber || null,
        notes: notes || null,
        sessionBillingIds: items.map((i) => i.sessionBillingId),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/owed", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/payouts"] });
      toast({ title: "Payout recorded", description: `${items.length} session(s) marked paid.` });
      onDone();
    },
    onError: (err: any) =>
      toast({ title: "Could not record payout", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payout</DialogTitle>
          <DialogDescription>
            Paying {items.length} session{items.length === 1 ? "" : "s"} totaling{" "}
            <span className="font-semibold">{money(total)}</span>. These sessions will be marked paid and removed from the owed list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="paymentDate">Payment date</Label>
            <Input id="paymentDate" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} data-testid="input-payment-date" />
          </div>
          <div>
            <Label htmlFor="paymentMethod">Method (optional)</Label>
            <Input id="paymentMethod" placeholder="e.g. Bank transfer, Check" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} data-testid="input-payment-method" />
          </div>
          <div>
            <Label htmlFor="referenceNumber">Reference number (optional)</Label>
            <Input id="referenceNumber" placeholder="e.g. Check #1234" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} data-testid="input-reference" />
          </div>
          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-notes" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !paymentDate || items.length === 0} data-testid="button-confirm-payout">
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirm payout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ History ------------------------------ */

function HistoryTab({ therapistId, toast }: { therapistId: number; toast: ReturnType<typeof useToast>["toast"] }) {
  const { data: payouts = [], isLoading } = useQuery<PayoutSummary[]>({
    queryKey: ["/api/therapist-pay/payouts", { therapistId }],
    queryFn: async () => {
      const res = await apiRequest(`/api/therapist-pay/payouts?therapistId=${therapistId}`, "GET");
      return res.json();
    },
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [voidTarget, setVoidTarget] = useState<PayoutSummary | null>(null);

  if (isLoading) {
    return <div className="flex items-center gap-2 py-10 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading payout history…</div>;
  }

  if (payouts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          <History className="mx-auto mb-3 h-10 w-10 opacity-40" />
          No payouts recorded for this therapist yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {payouts.map((p) => (
        <Card key={p.id} data-testid={`payout-${p.id}`}>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                className="flex items-center gap-2 text-left"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                data-testid={`button-expand-${p.id}`}
              >
                {expanded === p.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{money(p.totalAmount)}</span>
                    {p.status === "voided" ? (
                      <Badge variant="destructive">Voided</Badge>
                    ) : (
                      <Badge variant="secondary">Paid</Badge>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {fmtDate(p.paymentDate)} · {p.itemCount} session{p.itemCount === 1 ? "" : "s"}
                    {p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
                    {p.referenceNumber ? ` · ${p.referenceNumber}` : ""}
                  </div>
                </div>
              </button>
              {p.status !== "voided" && (
                <Button variant="outline" size="sm" onClick={() => setVoidTarget(p)} data-testid={`button-void-${p.id}`}>
                  <Ban className="mr-2 h-4 w-4" /> Void
                </Button>
              )}
            </div>

            {p.notes && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{p.notes}</p>}
            {p.status === "voided" && p.voidReason && (
              <p className="mt-2 text-sm text-red-600">Void reason: {p.voidReason}</p>
            )}

            {expanded === p.id && <PayoutItems payoutId={p.id} />}
          </CardContent>
        </Card>
      ))}

      <VoidPayoutDialog payout={voidTarget} onClose={() => setVoidTarget(null)} therapistId={therapistId} toast={toast} />
    </div>
  );
}

function PayoutItems({ payoutId }: { payoutId: number }) {
  const { data, isLoading } = useQuery<PayoutDetail>({
    queryKey: ["/api/therapist-pay/payouts", payoutId],
    queryFn: async () => {
      const res = await apiRequest(`/api/therapist-pay/payouts/${payoutId}`, "GET");
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="mt-3 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…</div>;
  }
  if (!data) return null;

  return (
    <div className="mt-3 rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Service</TableHead>
            <TableHead className="text-right">Basis</TableHead>
            <TableHead>Rule</TableHead>
            <TableHead className="text-right">Earned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((it) => (
            <TableRow key={it.id} data-testid={`payout-item-${it.id}`}>
              <TableCell>{fmtDate(it.sessionDate)}</TableCell>
              <TableCell>{it.clientName}</TableCell>
              <TableCell>
                {it.serviceName || "—"}
                {it.serviceCode ? <span className="ml-1 text-xs text-gray-500">{it.serviceCode}</span> : null}
              </TableCell>
              <TableCell className="text-right">{money(it.basisAmount)}</TableCell>
              <TableCell className="text-xs">{describeRule(it.payType, it.payValue)}</TableCell>
              <TableCell className="text-right font-medium">{money(it.amountEarned)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function VoidPayoutDialog({
  payout, onClose, therapistId, toast,
}: {
  payout: PayoutSummary | null;
  onClose: () => void;
  therapistId: number;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [reason, setReason] = useState("");

  const voidMut = useMutation({
    mutationFn: () =>
      apiRequest(`/api/therapist-pay/payouts/${payout!.id}/void`, "POST", { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/owed", therapistId] });
      toast({ title: "Payout voided", description: "Its sessions are back in the owed list." });
      setReason("");
      onClose();
    },
    onError: (err: any) =>
      toast({ title: "Could not void", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  return (
    <Dialog open={payout != null} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void payout</DialogTitle>
          <DialogDescription>
            This reverses the payout of {payout ? money(payout.totalAmount) : ""} and returns its sessions to the owed
            list so they can be paid again. This action is audit-logged.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="voidReason">Reason</Label>
          <Textarea id="voidReason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this payout being voided?" data-testid="input-void-reason" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setReason(""); onClose(); }} disabled={voidMut.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={() => voidMut.mutate()} disabled={voidMut.isPending || !reason.trim()} data-testid="button-confirm-void">
            {voidMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Void payout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
