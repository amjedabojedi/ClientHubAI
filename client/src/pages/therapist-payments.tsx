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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DollarSign, Percent, Users, Receipt, History, Loader2, AlertTriangle,
  ChevronDown, ChevronRight, Ban, Check, ChevronsUpDown,
  FileText, CalendarRange, Download, Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  category: string | null;
  clientName: string;
  totalAmount: number;
  collectedAmount: number;
  payType: PayType | null;
  payValue: number | null;
  ruleSource: "service" | "default" | "none";
  amountEarned: number;
  amountAllocated: number;
  amountRemaining: number;
}
interface OwedResponse {
  therapistId: number;
  items: OwedItem[];
  total: number;
  unresolvedCount: number;
}
interface StatementEntry {
  date: string;
  type: "earning" | "payment" | "adjustment";
  description: string;
  reference: string | null;
  earned: number;
  paid: number;
  runningBalance: number;
  payoutId?: number;
  sessionId?: number;
}
interface StatementResponse {
  therapistId: number;
  therapistName: string;
  entries: StatementEntry[];
  totalEarned: number;
  totalPaid: number;
  currentOwed: number;
  creditBalance: number;
  unresolvedCount: number;
}
interface MonthlySessionRow {
  sessionId: number;
  sessionBillingId: number | null;
  sessionDate: string | null;
  clientName: string;
  clientType: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  status: string | null;
  billed: boolean;
  expected: number;
  collected: number;
  uncollected: number;
  earned: number;
  hasRule: boolean;
}
interface MonthlyStatementResponse {
  therapistId: number;
  therapistName: string;
  month: string;
  openingBalance: number;
  earnedInMonth: number;
  paidInMonth: number;
  closingBalance: number;
  sessions: MonthlySessionRow[];
  totalExpected: number;
  totalCollected: number;
  totalUncollected: number;
  unbilledCount: number;
  unbilledCompletedCount: number;
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
  amountAllocated: number;
}
interface PayoutDetail extends PayoutSummary {
  items: PayoutItemDetail[];
}

const money = (n: number | string) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Pull the literal calendar date "YYYY-MM-DD" out of a date string WITHOUT
// reinterpreting it through a timezone. sessionDate is a date-only value, so
// `new Date(d)` would shift it across day/month boundaries in non-UTC zones —
// that would let a row display in one month but filter into another.
const ymd = (d: string | null) => (d || "").slice(0, 10);

const fmtDate = (d: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  if (!m) return "—";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Format a "YYYY-MM" key as e.g. "June 2026".
const fmtMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: "numeric", month: "long" });
};

const describeRule = (type: PayType | string | null, value: number | string | null) => {
  if (!type || value == null) return "No rule";
  return type === "percentage" ? `${Number(value)}% of collected` : `${money(value)} flat`;
};

// Build a CSV string from a header row + data rows, quoting every field so
// commas, quotes and newlines inside values can't break the columns.
const toCsv = (header: string[], rows: (string | number)[][]) => {
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
};

// Trigger a browser download of text content as a file.
const downloadFile = (filename: string, content: string, mime = "text/csv;charset=utf-8") => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Open a print-friendly window with the given title + HTML body and trigger the
// browser print dialog (which can "Save as PDF"). Returns false if blocked.
const printHtml = (title: string, bodyHtml: string): boolean => {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; color: #111; padding: 24px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      h2 { font-size: 14px; font-weight: 600; margin: 16px 0 8px; }
      .muted { color: #666; font-size: 12px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
      th { background: #f3f4f6; }
      td.num, th.num { text-align: right; }
      .cards { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; min-width: 140px; }
      .card .label { font-size: 11px; color: #666; }
      .card .value { font-size: 18px; font-weight: 700; }
      .flag { color: #b45309; font-weight: 600; }
    </style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  w.focus();
  // Give the new window a tick to render before printing.
  setTimeout(() => { w.print(); }, 300);
  return true;
};

// Record an export in the audit log. This MUST succeed before the report is
// produced — every export is required to leave an audit trail, so callers await
// this and abort the download/print if it throws (rather than silently exporting
// un-audited data).
const auditExport = async (body: { therapistId: number; reportType: "statement" | "monthly"; format: "csv" | "pdf"; month?: string }): Promise<void> => {
  await apiRequest("/api/therapist-pay/export-audit", "POST", body);
};

export default function TherapistPaymentsPage() {
  const { toast } = useToast();
  const [therapistId, setTherapistId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: therapists = [], isLoading: loadingTherapists } = useQuery<TherapistOption[]>({
    queryKey: ["/api/therapist-pay/therapists"],
  });

  const selectedTherapist = therapists.find((t) => t.id === therapistId) || null;

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
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                disabled={loadingTherapists}
                className="w-full max-w-md justify-between font-normal"
                data-testid="select-therapist"
              >
                <span className={cn(!selectedTherapist && "text-muted-foreground")}>
                  {selectedTherapist
                    ? `${selectedTherapist.fullName} (${selectedTherapist.role})`
                    : loadingTherapists ? "Loading…" : "Choose a therapist"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command
                filter={(value, search) =>
                  value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
                }
              >
                <CommandInput placeholder="Search therapists…" data-testid="input-therapist-search" />
                <CommandList>
                  <CommandEmpty>No therapist found.</CommandEmpty>
                  <CommandGroup>
                    {therapists.map((t) => (
                      <CommandItem
                        key={t.id}
                        value={`${t.fullName} ${t.role}`}
                        onSelect={() => {
                          setTherapistId(t.id);
                          setPickerOpen(false);
                        }}
                        data-testid={`option-therapist-${t.id}`}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            therapistId === t.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {t.fullName} <span className="ml-1 text-xs text-muted-foreground">({t.role})</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
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
            <TabsTrigger value="statement" data-testid="tab-statement">
              <FileText className="mr-2 h-4 w-4" /> Statement
            </TabsTrigger>
            <TabsTrigger value="monthly" data-testid="tab-monthly">
              <CalendarRange className="mr-2 h-4 w-4" /> Monthly Report
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <History className="mr-2 h-4 w-4" /> Payout History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="mt-4">
            <PayProfileTab therapistId={therapistId} toast={toast} />
          </TabsContent>
          <TabsContent value="owed" className="mt-4">
            <OwedTab key={therapistId} therapistId={therapistId} toast={toast} />
          </TabsContent>
          <TabsContent value="statement" className="mt-4">
            <StatementTab key={`stmt-${therapistId}`} therapistId={therapistId} therapistName={selectedTherapist?.fullName || ""} toast={toast} />
          </TabsContent>
          <TabsContent value="monthly" className="mt-4">
            <MonthlyReportTab key={`month-${therapistId}`} therapistId={therapistId} therapistName={selectedTherapist?.fullName || ""} toast={toast} />
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
  const { data: servicesRaw = [], isLoading: loadingServices } = useQuery<ServiceOption[]>({
    queryKey: ["/api/therapist-pay/services"],
  });
  // Service ids arrive from the API as strings (serial ids over the Neon
  // driver). Normalize to numbers so they match each rule's numeric serviceId
  // for override lookups, and so saving sends a numeric id.
  const services = servicesRaw.map((s) => ({ ...s, id: Number(s.id) }));

  const upsert = useMutation({
    mutationFn: (body: { serviceId: number | null; payType: PayType; payValue: string }) =>
      apiRequest("/api/therapist-pay/rules", "POST", { therapistId, ...body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/rules", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/owed", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/statement", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/monthly-statement", therapistId] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/statement", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/monthly-statement", therapistId] });
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
  const [month, setMonth] = useState<string>("all");

  const allItems = data?.items || [];

  // Months (YYYY-MM) that actually have owed sessions, newest first.
  // Use the literal calendar month (same basis as fmtDate) so the filter never
  // disagrees with the date shown in each row.
  const monthOptions = Array.from(
    new Set(allItems.map((i) => ymd(i.sessionDate).slice(0, 7)).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));

  const items =
    month === "all"
      ? allItems
      : allItems.filter((i) => ymd(i.sessionDate).slice(0, 7) === month);

  const payable = items.filter((i) => i.ruleSource !== "none");
  const selectedItems = payable.filter((i) => selected.has(i.sessionBillingId));
  // Pay what is still OWED on each session (earned minus anything already paid
  // via an earlier partial/lump payment).
  const selectedTotal = selectedItems.reduce((sum, i) => sum + i.amountRemaining, 0);

  // Total still owed in the current view (respects the month filter).
  const viewTotal = payable.reduce((sum, i) => sum + i.amountRemaining, 0);

  // Sum owed + collected per main service category for the current view.
  const categorySummary = (() => {
    const map = new Map<string, { earned: number; collected: number; count: number }>();
    for (const i of payable) {
      const key = i.category?.trim() || "Uncategorized";
      const cur = map.get(key) || { earned: 0, collected: 0, count: 0 };
      cur.earned += i.amountRemaining;
      cur.collected += i.collectedAmount;
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.earned - a.earned);
  })();

  // Changing the month clears the selection so a hidden session can't be paid by accident.
  const changeMonth = (m: string) => {
    setMonth(m);
    setSelected(new Set());
  };

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-sm text-gray-500">
              {month === "all" ? "Total currently owed (all payable sessions)" : `Owed in ${fmtMonth(month)}`}
            </p>
            <p className="text-2xl font-bold" data-testid="text-total-owed">
              {money(month === "all" ? (data?.total || 0) : viewTotal)}
            </p>
          </div>
          <div className="w-52">
            <Label className="mb-1 block text-xs">Filter by month</Label>
            <Select value={month} onValueChange={changeMonth}>
              <SelectTrigger data-testid="select-owed-month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All months</SelectItem>
                {monthOptions.map((m) => (
                  <SelectItem key={m} value={m}>{fmtMonth(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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

      {categorySummary.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Earnings by category{month === "all" ? "" : ` · ${fmtMonth(month)}`}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categorySummary.map((c) => (
              <Card key={c.category} data-testid={`category-summary-${c.category}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.category}</span>
                    <Badge variant="secondary">{c.count} session{c.count === 1 ? "" : "s"}</Badge>
                  </div>
                  <p className="mt-1 text-xl font-bold" data-testid={`category-earned-${c.category}`}>
                    {money(c.earned)}
                  </p>
                  <p className="text-xs text-gray-500">earned · {money(c.collected)} collected</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

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
                  <TableHead className="text-right">Owed</TableHead>
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
                        {i.serviceName || i.serviceCode || "—"}
                        {i.serviceCode && i.serviceCode !== i.serviceName ? <span className="ml-1 text-xs text-gray-500">{i.serviceCode}</span> : null}
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
                      <TableCell className="text-right font-medium">
                        {noRule ? "—" : (
                          <span data-testid={`text-owed-amount-${i.sessionBillingId}`}>
                            {money(i.amountRemaining)}
                          </span>
                        )}
                        {!noRule && i.amountAllocated > 0 && (
                          <span className="ml-1 block text-xs font-normal text-gray-500">
                            partial · {money(i.amountAllocated)} paid of {money(i.amountEarned)}
                          </span>
                        )}
                      </TableCell>
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
            <TableHead className="text-right">Paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((it) => (
            <TableRow key={it.id} data-testid={`payout-item-${it.id}`}>
              <TableCell>{fmtDate(it.sessionDate)}</TableCell>
              <TableCell>{it.clientName}</TableCell>
              <TableCell>
                {it.serviceName || it.serviceCode || "—"}
                {it.serviceCode && it.serviceCode !== it.serviceName ? <span className="ml-1 text-xs text-gray-500">{it.serviceCode}</span> : null}
              </TableCell>
              <TableCell className="text-right">{money(it.basisAmount)}</TableCell>
              <TableCell className="text-xs">{describeRule(it.payType, it.payValue)}</TableCell>
              <TableCell className="text-right font-medium">
                {money(it.amountAllocated)}
                {it.amountAllocated < it.amountEarned && (
                  <span className="ml-1 block text-xs font-normal text-gray-500">of {money(it.amountEarned)} earned</span>
                )}
                {it.amountAllocated > it.amountEarned && (
                  <span className="ml-1 block text-xs font-normal text-amber-600">{money(it.amountAllocated - it.amountEarned)} over (earned {money(it.amountEarned)})</span>
                )}
              </TableCell>
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

/* ----------------------------- Statement ----------------------------- */

function StatementTab({
  therapistId, therapistName, toast,
}: {
  therapistId: number;
  therapistName: string;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const { data, isLoading } = useQuery<StatementResponse>({
    queryKey: ["/api/therapist-pay/statement", therapistId],
    queryFn: async () => {
      const res = await apiRequest(`/api/therapist-pay/statement/${therapistId}`, "GET");
      return res.json();
    },
  });
  const [lumpOpen, setLumpOpen] = useState(false);

  if (isLoading) {
    return <div className="flex items-center gap-2 py-10 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading statement…</div>;
  }
  if (!data) return null;

  const name = data.therapistName || therapistName;
  const entries = data.entries;

  const exportCsv = async () => {
    const rows = entries.map((e) => [
      e.date,
      e.type === "earning" ? "Earning" : e.type === "adjustment" ? "Adjustment" : "Payment",
      e.description,
      e.reference || "",
      e.earned ? e.earned.toFixed(2) : "",
      e.paid ? e.paid.toFixed(2) : "",
      e.runningBalance.toFixed(2),
    ]);
    rows.push(["", "", "Totals", "", data.totalEarned.toFixed(2), data.totalPaid.toFixed(2), ""]);
    const csv = toCsv(
      ["Date", "Type", "Description", "Reference", "Earned", "Paid", "Running Balance"],
      rows,
    );
    try {
      await auditExport({ therapistId, reportType: "statement", format: "csv" });
    } catch {
      toast({ title: "Export blocked", description: "Couldn't record this export in the audit log. Please try again.", variant: "destructive" });
      return;
    }
    downloadFile(`statement-${name.replace(/\s+/g, "_")}.csv`, csv);
    toast({ title: "Statement exported", description: "CSV downloaded." });
  };

  const exportPrint = async () => {
    const rowsHtml = entries.map((e) => `
      <tr>
        <td>${fmtDate(e.date)}</td>
        <td>${e.type === "earning" ? "Earning" : e.type === "adjustment" ? "Adjustment" : "Payment"}</td>
        <td>${escapeHtml(e.description)}</td>
        <td class="num">${e.earned ? money(e.earned) : ""}</td>
        <td class="num">${e.paid ? money(e.paid) : ""}</td>
        <td class="num">${money(e.runningBalance)}</td>
      </tr>`).join("");
    const body = `
      <h1>Running Statement — ${escapeHtml(name)}</h1>
      <div class="muted">Generated ${new Date().toLocaleString()}</div>
      <div class="cards">
        <div class="card"><div class="label">Total earned</div><div class="value">${money(data.totalEarned)}</div></div>
        <div class="card"><div class="label">Total paid</div><div class="value">${money(data.totalPaid)}</div></div>
        <div class="card"><div class="label">${data.creditBalance > 0 ? "Credit balance" : "Currently owed"}</div><div class="value">${money(data.creditBalance > 0 ? data.creditBalance : data.currentOwed)}</div></div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">Earned</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    try {
      await auditExport({ therapistId, reportType: "statement", format: "pdf" });
    } catch {
      toast({ title: "Export blocked", description: "Couldn't record this export in the audit log. Please try again.", variant: "destructive" });
      return;
    }
    const ok = printHtml(`Statement — ${name}`, body);
    if (!ok) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print or save as PDF.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">Total earned</p>
            <p className="text-xl font-bold" data-testid="text-statement-earned">{money(data.totalEarned)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Total paid</p>
            <p className="text-xl font-bold" data-testid="text-statement-paid">{money(data.totalPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{data.creditBalance > 0 ? "Credit balance" : "Currently owed"}</p>
            <p className="text-xl font-bold" data-testid="text-statement-balance">
              {money(data.creditBalance > 0 ? data.creditBalance : data.currentOwed)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setLumpOpen(true)} data-testid="button-lump-payment">
            <DollarSign className="mr-2 h-4 w-4" /> Make a lump payment
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={entries.length === 0} data-testid="button-statement-csv">
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={exportPrint} disabled={entries.length === 0} data-testid="button-statement-print">
            <Printer className="mr-2 h-4 w-4" /> Print / PDF
          </Button>
        </div>
      </div>

      {data.creditBalance > 0 && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30">
          This therapist has been paid {money(data.creditBalance)} ahead of their earnings. The credit will be used up
          automatically as new sessions are collected.
        </div>
      )}

      {data.unresolvedCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {data.unresolvedCount} collected session{data.unresolvedCount === 1 ? "" : "s"} have no pay rule and are not
            included above. Add a rule in the Pay Profile tab so they can be counted.
          </span>
        </div>
      )}

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <FileText className="mx-auto mb-3 h-10 w-10 opacity-40" />
            No earnings or payments recorded for this therapist yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, idx) => (
                  <TableRow key={idx} data-testid={`statement-row-${idx}`}>
                    <TableCell>{fmtDate(e.date)}</TableCell>
                    <TableCell>
                      {e.type === "earning"
                        ? <Badge variant="outline">Earning</Badge>
                        : e.type === "adjustment"
                        ? <Badge variant="destructive">Adjustment</Badge>
                        : <Badge variant="secondary">Payment</Badge>}
                    </TableCell>
                    <TableCell>{e.description}</TableCell>
                    <TableCell className="text-right">{e.earned ? money(e.earned) : "—"}</TableCell>
                    <TableCell className="text-right">{e.paid ? money(e.paid) : "—"}</TableCell>
                    <TableCell className="text-right font-medium">{money(e.runningBalance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <LumpPaymentDialog
        open={lumpOpen}
        onOpenChange={setLumpOpen}
        therapistId={therapistId}
        currentOwed={data.currentOwed}
        toast={toast}
      />
    </div>
  );
}

function LumpPaymentDialog({
  open, onOpenChange, therapistId, currentOwed, toast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  therapistId: number;
  currentOwed: number;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setAmount(""); setPaymentDate(today); setPaymentMethod(""); setReferenceNumber(""); setNotes("");
  };

  const amt = Number(amount);
  const validAmount = amount.trim() !== "" && isFinite(amt) && amt > 0;

  const create = useMutation({
    mutationFn: () =>
      apiRequest("/api/therapist-pay/lump-payment", "POST", {
        therapistId,
        amount: amt,
        paymentDate,
        paymentMethod: paymentMethod || null,
        referenceNumber: referenceNumber || null,
        notes: notes || null,
      }),
    onSuccess: async (res) => {
      const payout = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/statement", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/owed", therapistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/therapist-pay/payouts"] });
      const applied = Number(payout.appliedAmount || 0);
      const unapplied = Number(payout.unappliedAmount || 0);
      toast({
        title: "Lump payment recorded",
        description: unapplied > 0
          ? `${money(applied)} applied to ${payout.allocationCount} session(s); ${money(unapplied)} kept as credit.`
          : `${money(applied)} applied to ${payout.allocationCount} session(s).`,
      });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) =>
      toast({ title: "Could not record payment", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make a lump payment</DialogTitle>
          <DialogDescription>
            Enter one payment amount. It is applied automatically to the oldest outstanding sessions first. Anything
            beyond what is owed ({money(currentOwed)}) is kept as a credit against future earnings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="lumpAmount">Amount ($)</Label>
            <Input id="lumpAmount" type="number" min="0" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500.00" data-testid="input-lump-amount" />
          </div>
          <div>
            <Label htmlFor="lumpDate">Payment date</Label>
            <Input id="lumpDate" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} data-testid="input-lump-date" />
          </div>
          <div>
            <Label htmlFor="lumpMethod">Method (optional)</Label>
            <Input id="lumpMethod" placeholder="e.g. Bank transfer, Check" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} data-testid="input-lump-method" />
          </div>
          <div>
            <Label htmlFor="lumpRef">Reference number (optional)</Label>
            <Input id="lumpRef" placeholder="e.g. Check #1234" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} data-testid="input-lump-reference" />
          </div>
          <div>
            <Label htmlFor="lumpNotes">Notes (optional)</Label>
            <Textarea id="lumpNotes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-lump-notes" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={create.isPending}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !validAmount || !paymentDate} data-testid="button-confirm-lump">
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Monthly Report --------------------------- */

function MonthlyReportTab({
  therapistId, therapistName, toast,
}: {
  therapistId: number;
  therapistName: string;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  // Default to the current calendar month, but any date range can be picked.
  const defaultRange = (() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { start: toYmd(first), end: toYmd(last) };
  })();
  const [startDate, setStartDate] = useState<string>(defaultRange.start);
  const [endDate, setEndDate] = useState<string>(defaultRange.end);
  const [collFilter, setCollFilter] = useState<"all" | "collected" | "uncollected" | "unbilled">("all");
  const [nameQuery, setNameQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const validRange =
    /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
    startDate <= endDate;

  const { data, isLoading, isError } = useQuery<MonthlyStatementResponse>({
    queryKey: ["/api/therapist-pay/monthly-statement", therapistId, startDate, endDate],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/therapist-pay/monthly-statement/${therapistId}?startDate=${startDate}&endDate=${endDate}`,
        "GET",
      );
      return res.json();
    },
    enabled: validRange,
  });

  const name = data?.therapistName || therapistName;
  const periodLabel = `${fmtDate(startDate)} – ${fmtDate(endDate)}`;
  const periodKey = `${startDate}_to_${endDate}`;

  // Collected / Uncollected / Not-billed view filter. The table AND the exports
  // follow it, so "what you see is what you download" — but the summary totals
  // above stay period-wide (they describe the whole range, not the filter).
  const matchesFilter = (s: MonthlySessionRow) => {
    const q = nameQuery.trim().toLowerCase();
    if (q && !s.clientName.toLowerCase().includes(q)) return false;
    if (typeFilter !== "all" && (s.clientType || "") !== typeFilter) return false;
    if (collFilter === "all") return true;
    if (collFilter === "unbilled") return !s.billed;
    if (collFilter === "collected") return s.billed && s.uncollected <= 0;
    if (collFilter === "uncollected") return s.billed && s.uncollected > 0;
    return true;
  };
  // Type options come from whatever client types actually appear in this period.
  const availableTypes = Array.from(
    new Set((data?.sessions ?? []).map((s) => s.clientType).filter((t): t is string => !!t)),
  ).sort();
  const filterLabel: Record<typeof collFilter, string> = {
    all: "All sessions",
    collected: "Collected only",
    uncollected: "Uncollected only",
    unbilled: "Not billed only",
  };
  // Human-readable description of EVERY active filter, so exports/empty-state
  // reflect the name search + type dropdown, not just the collected-status button.
  const activeFilterLabel = [
    filterLabel[collFilter],
    nameQuery.trim() ? `Name contains "${nameQuery.trim()}"` : null,
    typeFilter !== "all" ? `Type: ${typeFilter}` : null,
  ].filter(Boolean).join(" · ");
  const visibleSessions = (data?.sessions ?? []).filter(matchesFilter);

  const exportCsv = async () => {
    if (!data) return;
    const rows = visibleSessions.map((s) => [
      ymd(s.sessionDate),
      s.clientName,
      s.clientType || "",
      s.serviceName || s.serviceCode || "",
      s.billed ? "Billed" : "Not billed",
      s.status || "",
      s.billed ? s.expected.toFixed(2) : "",
      s.billed ? s.collected.toFixed(2) : "",
      s.billed ? s.uncollected.toFixed(2) : "",
      !s.billed ? "" : s.hasRule ? s.earned.toFixed(2) : "no rule",
    ]);
    const csv = toCsv(
      ["Date", "Client", "Type", "Service", "Billing", "Status", "Expected", "Collected", "Uncollected", "Earned"],
      rows,
    );
    const header =
      `Report,${name},${periodLabel}\r\n` +
      `Filter,${activeFilterLabel}\r\n` +
      `Opening balance,${data.openingBalance.toFixed(2)}\r\n` +
      `Earned in period,${data.earnedInMonth.toFixed(2)}\r\n` +
      `Paid in period,${data.paidInMonth.toFixed(2)}\r\n` +
      `Closing balance,${data.closingBalance.toFixed(2)}\r\n` +
      `Total expected,${data.totalExpected.toFixed(2)}\r\n` +
      `Total collected,${data.totalCollected.toFixed(2)}\r\n` +
      `Total uncollected,${data.totalUncollected.toFixed(2)}\r\n` +
      `Not billed (sessions),${data.unbilledCount}\r\n` +
      `Not billed but completed,${data.unbilledCompletedCount}\r\n\r\n`;
    try {
      await auditExport({ therapistId, reportType: "monthly", format: "csv", month: periodKey });
    } catch {
      toast({ title: "Export blocked", description: "Couldn't record this export in the audit log. Please try again.", variant: "destructive" });
      return;
    }
    downloadFile(`statement-${name.replace(/\s+/g, "_")}-${periodKey}.csv`, header + csv);
    toast({ title: "Report exported", description: "CSV downloaded." });
  };

  const exportPrint = async () => {
    if (!data) return;
    const rowsHtml = visibleSessions.map((s) => `
      <tr>
        <td>${fmtDate(s.sessionDate)}</td>
        <td>${escapeHtml(s.clientName)}</td>
        <td>${escapeHtml(s.clientType || "—")}</td>
        <td>${escapeHtml(s.serviceName || s.serviceCode || "—")}</td>
        <td class="${s.billed ? "" : "flag"}">${s.billed ? "Billed" : "Not billed"}${s.status ? ` (${escapeHtml(s.status)})` : ""}</td>
        <td class="num">${s.billed ? money(s.expected) : "—"}</td>
        <td class="num">${s.billed ? money(s.collected) : "—"}</td>
        <td class="num ${s.billed && s.uncollected > 0 ? "flag" : ""}">${s.billed ? money(s.uncollected) : "—"}</td>
        <td class="num">${!s.billed ? "—" : s.hasRule ? money(s.earned) : "no rule"}</td>
      </tr>`).join("");
    const body = `
      <h1>Statement — ${escapeHtml(name)}</h1>
      <div class="muted">${escapeHtml(periodLabel)} · ${escapeHtml(activeFilterLabel)} · generated ${new Date().toLocaleString()}</div>
      <div class="cards">
        <div class="card"><div class="label">Opening balance</div><div class="value">${money(data.openingBalance)}</div></div>
        <div class="card"><div class="label">Earned in period</div><div class="value">${money(data.earnedInMonth)}</div></div>
        <div class="card"><div class="label">Paid in period</div><div class="value">${money(data.paidInMonth)}</div></div>
        <div class="card"><div class="label">Closing balance</div><div class="value">${money(data.closingBalance)}</div></div>
      </div>
      <div class="cards">
        <div class="card"><div class="label">Total expected</div><div class="value">${money(data.totalExpected)}</div></div>
        <div class="card"><div class="label">Total collected</div><div class="value">${money(data.totalCollected)}</div></div>
        <div class="card"><div class="label">Total uncollected</div><div class="value">${money(data.totalUncollected)}</div></div>
      </div>
      <div class="cards">
        <div class="card"><div class="label">Not billed (sessions)</div><div class="value">${data.unbilledCount}</div></div>
        <div class="card"><div class="label">Not billed but completed</div><div class="value">${data.unbilledCompletedCount}</div></div>
      </div>
      <h2>Sessions</h2>
      <table>
        <thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Service</th><th>Billing</th><th class="num">Expected</th><th class="num">Collected</th><th class="num">Uncollected</th><th class="num">Earned</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    try {
      await auditExport({ therapistId, reportType: "monthly", format: "pdf", month: periodKey });
    } catch {
      toast({ title: "Export blocked", description: "Couldn't record this export in the audit log. Please try again.", variant: "destructive" });
      return;
    }
    const ok = printHtml(`Statement — ${name} — ${periodLabel}`, body);
    if (!ok) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print or save as PDF.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label htmlFor="reportFrom" className="mb-1 block text-xs">From</Label>
            <Input id="reportFrom" type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-report-from" />
          </div>
          <div className="w-40">
            <Label htmlFor="reportTo" className="mb-1 block text-xs">To</Label>
            <Input id="reportTo" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} data-testid="input-report-to" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!data} data-testid="button-monthly-csv">
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={exportPrint} disabled={!data} data-testid="button-monthly-print">
            <Printer className="mr-2 h-4 w-4" /> Print / PDF
          </Button>
        </div>
      </div>

      {!validRange && (
        <Card><CardContent className="py-3 text-center text-sm text-amber-600">Please choose a “From” date on or before the “To” date.</CardContent></Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading report…</div>
      ) : isError || !data ? (
        <Card><CardContent className="py-12 text-center text-gray-500">Could not load the report for this date range.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="Opening balance" value={money(data.openingBalance)} testId="text-opening" />
            <SummaryCard label="Earned in period" value={money(data.earnedInMonth)} testId="text-earned-month" />
            <SummaryCard label="Paid in period" value={money(data.paidInMonth)} testId="text-paid-month" />
            <SummaryCard label="Closing balance" value={money(data.closingBalance)} testId="text-closing" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryCard label="Total expected" value={money(data.totalExpected)} testId="text-total-expected" />
            <SummaryCard label="Total collected" value={money(data.totalCollected)} testId="text-total-collected" />
            <SummaryCard label="Total uncollected" value={money(data.totalUncollected)} testId="text-total-uncollected" highlight={data.totalUncollected > 0} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SummaryCard label="Not billed (sessions)" value={String(data.unbilledCount)} testId="text-unbilled-count" highlight={data.unbilledCount > 0} />
            <SummaryCard label="Not billed but completed" value={String(data.unbilledCompletedCount)} testId="text-unbilled-completed" highlight={data.unbilledCompletedCount > 0} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">Show:</span>
            {([
              ["all", "All"],
              ["collected", "Collected"],
              ["uncollected", "Uncollected"],
              ["unbilled", "Not billed"],
            ] as const).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={collFilter === key ? "default" : "outline"}
                onClick={() => setCollFilter(key)}
                data-testid={`button-filter-${key}`}
              >
                {label}
              </Button>
            ))}
            <Input
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder="Search client name…"
              className="h-8 w-48"
              data-testid="input-search-name"
            />
            {availableTypes.length > 0 && (
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-40" data-testid="select-filter-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {availableTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="ml-auto text-xs text-gray-500" data-testid="text-filter-count">
              {visibleSessions.length} of {data.sessions.length} sessions
            </span>
          </div>

          {data.sessions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <CalendarRange className="mx-auto mb-3 h-10 w-10 opacity-40" />
                No sessions for {periodLabel}.
              </CardContent>
            </Card>
          ) : visibleSessions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <CalendarRange className="mx-auto mb-3 h-10 w-10 opacity-40" />
                No sessions match the current filters for {periodLabel}.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Billing</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead className="text-right">Collected</TableHead>
                      <TableHead className="text-right">Uncollected</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleSessions.map((s) => (
                      <TableRow
                        key={`${s.billed ? "b" : "u"}-${s.sessionId}`}
                        data-testid={`monthly-row-${s.sessionId}`}
                        className={cn(!s.billed && s.status === "completed" && "bg-amber-50")}
                      >
                        <TableCell>{fmtDate(s.sessionDate)}</TableCell>
                        <TableCell>{s.clientName}</TableCell>
                        <TableCell>{s.clientType || "—"}</TableCell>
                        <TableCell>
                          {s.serviceName || s.serviceCode || "—"}
                          {s.serviceCode && s.serviceCode !== s.serviceName ? <span className="ml-1 text-xs text-gray-500">{s.serviceCode}</span> : null}
                        </TableCell>
                        <TableCell>
                          {s.billed ? (
                            <Badge variant="outline">Billed</Badge>
                          ) : (
                            <Badge variant={s.status === "completed" ? "destructive" : "secondary"}>
                              Not billed{s.status ? ` · ${s.status}` : ""}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{s.billed ? money(s.expected) : "—"}</TableCell>
                        <TableCell className="text-right">{s.billed ? money(s.collected) : "—"}</TableCell>
                        <TableCell className={cn("text-right", s.billed && s.uncollected > 0 && "font-medium text-amber-600")}>
                          {s.billed ? money(s.uncollected) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {!s.billed ? "—" : s.hasRule ? money(s.earned) : <Badge variant="destructive">No rule</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, testId, highlight }: { label: string; value: string; testId?: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={cn("text-xl font-bold", highlight && "text-amber-600")} data-testid={testId}>{value}</p>
      </CardContent>
    </Card>
  );
}

// Minimal HTML escaping for values injected into the print window.
function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
