import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  FileText, Upload, Loader2, ArrowLeft, CheckCircle2, Ban, AlertTriangle,
  Check, X, RefreshCw, Link2Off, Search, User as UserIcon, ListChecks, Trash2, Undo2,
  ChevronsUpDown,
} from "lucide-react";

type MatchStatus = "unmatched" | "suggested" | "confirmed" | "posted" | "skipped" | "reversed";
type StatementStatus = "draft" | "posted" | "voided";

interface StatementSummary {
  id: number;
  fileName: string;
  sourceType: "pdf" | "excel";
  payerName: string | null;
  checkNumber: string | null;
  statementDate: string | null;
  totalPaid: string | null;
  status: StatementStatus;
  therapistId: number | null;
  therapistName: string | null;
  uploadedByName: string | null;
  createdAt: string;
  lineCount: number;
  matchedCount: number;
  postedCount: number;
  postedTotal: number;
}

interface StatementLine {
  id: number;
  statementId: number;
  serviceDate: string | null;
  clientNameRaw: string | null;
  serviceCode: string | null;
  billedAmount: string | null;
  allowedAmount: string | null;
  insurancePaidAmount: string;
  patientResponsibility: string | null;
  remarkCode: string | null;
  matchedSessionBillingId: number | null;
  matchedSessionId: number | null;
  matchStatus: MatchStatus;
  matchConfidence: "high" | "medium" | "low" | "partial" | null;
  postedAmount: string | null;
  matchedClientName: string | null;
  matchedSessionDate: string | null;
  matchedServiceCode: string | null;
  matchedServiceName: string | null;
  matchedBilledTotal: number | null;
  matchedInsurancePaid: number | null;
}

interface StatementDetail {
  statement: StatementSummary;
  therapistName: string | null;
  lines: StatementLine[];
}

interface TherapistOption {
  id: number;
  fullName: string;
}

interface TransactionRow {
  lineId: number;
  statementId: number;
  statementFileName: string;
  statementStatus: StatementStatus;
  payerName: string | null;
  therapistName: string | null;
  serviceDate: string | null;
  clientName: string | null;
  serviceCode: string | null;
  insurancePaidAmount: string;
  matchStatus: MatchStatus;
  remarkCode: string | null;
}

const money = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
};

// A line is genuinely DENIED only when the insurer paid nothing AND attached a
// remark/denial code. A remark code on a PAID line is just an informational note
// (e.g. contractual adjustment), NOT a denial — so it must not be flagged.
const isDeniedLine = (
  paidAmount: string | number | null | undefined,
  remarkCode: string | null | undefined,
): boolean => {
  if (!remarkCode) return false;
  const n = typeof paidAmount === "number" ? paidAmount : Number(paidAmount);
  return Number.isFinite(n) && n <= 0;
};

// Render a literal YYYY-MM-DD without constructing a Date (avoids timezone shift).
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const ymd = String(d).slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[2]}/${m[3]}/${m[1]}`;
};

// A Select-style dropdown with a type-to-filter search box, used for the
// therapist pickers (assignment + Transactions filter) so long therapist
// lists are searchable.
function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  triggerClassName,
  disabled,
  testId,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  triggerClassName?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal", triggerClassName)}
          data-testid={testId}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onValueChange(o.value);
                    setOpen(false);
                  }}
                  data-testid={testId ? `${testId}-option-${o.value}` : undefined}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function statusBadge(status: StatementStatus) {
  if (status === "posted") return <Badge className="bg-green-600 hover:bg-green-600">Posted</Badge>;
  if (status === "voided") return <Badge variant="destructive">Voided</Badge>;
  return <Badge variant="secondary">Draft</Badge>;
}

function matchBadge(line: StatementLine) {
  switch (line.matchStatus) {
    case "posted":
      return <Badge className="bg-green-600 hover:bg-green-600">Posted</Badge>;
    case "confirmed":
      return <Badge className="bg-blue-600 hover:bg-blue-600">Confirmed</Badge>;
    case "suggested":
      if (line.matchConfidence === "partial") {
        return (
          <Badge variant="outline" className="border-orange-500 text-orange-700">
            Possible match · confirm
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="border-amber-500 text-amber-700">
          Suggested{line.matchConfidence ? ` · ${line.matchConfidence}` : ""}
        </Badge>
      );
    case "skipped":
      return <Badge variant="secondary">Skipped</Badge>;
    case "reversed":
      return (
        <Badge variant="outline" className="border-red-400 text-red-700">
          Reversed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-gray-400 text-gray-600">
          No match
        </Badge>
      );
  }
}

export default function InsuranceReconciliationPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (selectedId !== null) {
    return <StatementDetailView id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-insurance-reconciliation">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" /> Insurance Reconciliation
        </h1>
        <p className="text-muted-foreground mt-1">
          Upload an insurance payment statement (PDF or Excel/CSV). We read the
          paid lines, match them to sessions, and record the insurance payments.
        </p>
      </div>

      <Tabs defaultValue="statements">
        <TabsList>
          <TabsTrigger value="statements" data-testid="tab-statements">
            <FileText className="h-4 w-4 mr-2" /> Statements
          </TabsTrigger>
          <TabsTrigger value="transactions" data-testid="tab-transactions">
            <ListChecks className="h-4 w-4 mr-2" /> Transactions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="statements" className="mt-4">
          <StatementList onOpen={setSelectedId} />
        </TabsContent>
        <TabsContent value="transactions" className="mt-4">
          <TransactionsList onOpen={setSelectedId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List + upload
// ---------------------------------------------------------------------------
interface DuplicateInfo {
  id: number;
  status: StatementStatus;
  fileName: string;
  payerName: string | null;
  statementDate: string | null;
  totalPaid: string | null;
  createdAt: string;
  lineCount: number;
}

function StatementList({ onOpen }: { onOpen: (id: number) => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // When the server thinks the file is a re-upload, we hold the file here and
  // ask the user whether to upload it anyway.
  const [duplicate, setDuplicate] = useState<{ info: DuplicateInfo; file: File } | null>(null);
  // Optional: the one therapist this statement belongs to, chosen before upload.
  const [therapistId, setTherapistId] = useState<string>("");
  // The statement the user has asked to delete (drives the confirmation dialog).
  const [toDelete, setToDelete] = useState<StatementSummary | null>(null);

  const { data: statements, isLoading } = useQuery<StatementSummary[]>({
    queryKey: ["/api/insurance/statements"],
  });

  const { data: therapists } = useQuery<TherapistOption[]>({
    queryKey: ["/api/therapists"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, force }: { file: File; force?: boolean }) => {
      const formData = new FormData();
      formData.append("file", file);
      if (force) formData.append("force", "true");
      if (therapistId) formData.append("therapistId", therapistId);
      const res = await apiRequest("/api/insurance/statements", "POST", formData);
      let body: StatementDetail | { duplicate: DuplicateInfo };
      try {
        body = (await res.json()) as StatementDetail | { duplicate: DuplicateInfo };
      } catch {
        // An empty/cut-off response usually means the file was too large or took
        // too long to process. Show a clear message instead of a JSON error.
        throw new Error(
          "This file was too large or took too long to process. Try a smaller file, or split a long statement into separate uploads.",
        );
      }
      return { body, file };
    },
    onSuccess: ({ body, file }) => {
      if ("duplicate" in body) {
        // Don't navigate — surface the warning and let the user decide.
        setDuplicate({ info: body.duplicate, file });
        return;
      }
      setDuplicate(null);
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
      toast({
        title: "Statement uploaded",
        description: `Read ${body.lines.length} line(s). Review and confirm the matches.`,
      });
      onOpen(body.statement.id);
    },
    onError: (err: Error) => {
      toast({ title: "Could not upload", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) =>
      apiRequest(`/api/insurance/statements/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/transactions"] });
      setToDelete(null);
      toast({ title: "Statement deleted" });
    },
    onError: (err: Error) => {
      const mustVoid = /must be voided/i.test(err.message);
      toast({
        title: mustVoid ? "Void it first" : "Could not delete",
        description: mustVoid
          ? "This statement is posted. Open it and void it first (that reverses its payments), then you can delete it."
          : err.message,
        variant: "destructive",
      });
    },
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate({ file });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Therapist for this statement (optional)
          </Label>
          <SearchableSelect
            value={therapistId || "none"}
            onValueChange={(v) => setTherapistId(v === "none" ? "" : v)}
            options={[
              { value: "none", label: "No therapist" },
              ...(therapists ?? []).map((t) => ({
                value: String(t.id),
                label: t.fullName,
              })),
            ]}
            placeholder="No therapist"
            searchPlaceholder="Search therapist…"
            emptyText="No therapist found."
            triggerClassName="w-[260px]"
            testId="select-upload-therapist"
          />
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.txt,.docx"
            className="hidden"
            onChange={handleFile}
            data-testid="input-upload-statement"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            data-testid="button-upload-statement"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {uploadMutation.isPending ? "Reading file…" : "Upload Statement"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Statements</CardTitle>
          <CardDescription>Most recent uploads first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : !statements?.length ? (
            <div className="text-center py-10 text-muted-foreground">
              No statements yet. Upload one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Therapist</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Statement Date</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead className="text-right">Total Posted</TableHead>
                  <TableHead className="text-center">Lines</TableHead>
                  <TableHead className="text-center">Matched</TableHead>
                  <TableHead className="text-center">Posted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statements.map((s) => (
                  <TableRow key={s.id} data-testid={`row-statement-${s.id}`}>
                    <TableCell data-testid={`text-statement-therapist-${s.id}`}>
                      {s.therapistName || "—"}
                    </TableCell>
                    <TableCell>{s.payerName || "—"}</TableCell>
                    <TableCell>{fmtDate(s.statementDate)}</TableCell>
                    <TableCell className="text-right">{money(s.totalPaid)}</TableCell>
                    <TableCell className="text-right" data-testid={`text-statement-posted-total-${s.id}`}>
                      {money(s.postedTotal)}
                    </TableCell>
                    <TableCell className="text-center">{s.lineCount}</TableCell>
                    <TableCell className="text-center">{s.matchedCount}</TableCell>
                    <TableCell className="text-center">{s.postedCount}</TableCell>
                    <TableCell>{statusBadge(s.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpen(s.id)}
                          data-testid={`button-open-statement-${s.id}`}
                        >
                          Review
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setToDelete(s)}
                          title={
                            s.status === "posted"
                              ? "Void this statement first, then you can delete it"
                              : "Delete this statement"
                          }
                          data-testid={`button-delete-statement-${s.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <DialogContent data-testid="dialog-delete-statement">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" />
              Delete this statement?
            </DialogTitle>
            <DialogDescription>
              {toDelete && (
                toDelete.status === "posted" ? (
                  <>
                    <span className="font-semibold">{toDelete.fileName}</span> is
                    posted, so its insurance payments are recorded. To keep your
                    numbers correct, open it and <span className="font-semibold">void</span> it
                    first (that reverses the payments) — then you can delete it.
                  </>
                ) : (
                  <>
                    This permanently removes{" "}
                    <span className="font-semibold">{toDelete.fileName}</span> and
                    its {toDelete.lineCount} line(s). This can't be undone.
                    {toDelete.status === "voided"
                      ? " Its payments were already reversed when it was voided, so your balances won't change."
                      : " It was never posted, so no payments are affected."}
                  </>
                )
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setToDelete(null)}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-cancel"
            >
              Cancel
            </Button>
            {toDelete?.status !== "posted" && (
              <Button
                variant="destructive"
                onClick={() => { if (toDelete) deleteMutation.mutate(toDelete.id); }}
                disabled={deleteMutation.isPending}
                data-testid="button-delete-confirm"
              >
                {deleteMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting…</>
                ) : (
                  "Delete"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!duplicate} onOpenChange={(o) => { if (!o) setDuplicate(null); }}>
        <DialogContent data-testid="dialog-duplicate-statement">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              This looks like a statement you already uploaded
            </DialogTitle>
            <DialogDescription>
              {duplicate && (
                <>
                  It matches statement{" "}
                  <span className="font-semibold">#{duplicate.info.id}</span> (
                  {duplicate.info.status === "posted"
                    ? "already posted — its payments are recorded"
                    : "still in draft"}
                  ), uploaded {fmtDate(duplicate.info.createdAt)}.
                  {duplicate.info.status === "posted"
                    ? " Uploading it again could record the same insurance payments twice."
                    : " You may already be working on it."}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {duplicate && (
            <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/40">
              <div><span className="text-muted-foreground">File:</span> {duplicate.info.fileName}</div>
              <div><span className="text-muted-foreground">Payer:</span> {duplicate.info.payerName || "—"}</div>
              <div><span className="text-muted-foreground">Statement date:</span> {fmtDate(duplicate.info.statementDate)}</div>
              <div><span className="text-muted-foreground">Total paid:</span> {money(duplicate.info.totalPaid)}</div>
              <div><span className="text-muted-foreground">Lines:</span> {duplicate.info.lineCount}</div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDuplicate(null)}
              disabled={uploadMutation.isPending}
              data-testid="button-duplicate-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { if (duplicate) uploadMutation.mutate({ file: duplicate.file, force: true }); }}
              disabled={uploadMutation.isPending}
              data-testid="button-duplicate-proceed"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Upload anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail / review
// ---------------------------------------------------------------------------
function StatementDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [rematchBillingId, setRematchBillingId] = useState<Record<number, string>>({});
  const [reverseLineId, setReverseLineId] = useState<number | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const queryKey = [`/api/insurance/statements/${id}`];
  const { data, isLoading } = useQuery<StatementDetail>({ queryKey });

  const { data: therapists } = useQuery<TherapistOption[]>({
    queryKey: ["/api/therapists"],
  });

  const therapistMutation = useMutation({
    mutationFn: async (newTherapistId: number | null) =>
      apiRequest(`/api/insurance/statements/${id}/therapist`, "PATCH", {
        therapistId: newTherapistId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/transactions"] });
      toast({ title: "Therapist updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update therapist", description: err.message, variant: "destructive" });
    },
  });

  const lineMutation = useMutation({
    mutationFn: async (vars: {
      lineId: number;
      matchStatus: MatchStatus;
      matchedSessionBillingId?: number | null;
    }) => {
      return apiRequest(`/api/insurance/lines/${vars.lineId}`, "PATCH", {
        matchStatus: vars.matchStatus,
        matchedSessionBillingId: vars.matchedSessionBillingId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update line", description: err.message, variant: "destructive" });
    },
  });

  const reverseLineMutation = useMutation({
    mutationFn: async (vars: { lineId: number; reason: string }) =>
      apiRequest(`/api/insurance/lines/${vars.lineId}/reverse`, "POST", {
        reason: vars.reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/transactions"] });
      setReverseLineId(null);
      setReverseReason("");
      toast({
        title: "Line reversed",
        description: "That one payment was undone. The rest of the statement stays posted.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not reverse line", description: err.message, variant: "destructive" });
    },
  });

  const rematchMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/insurance/statements/${id}/rematch`, "POST", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Re-matched", description: "Auto-matching ran again." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not re-match", description: err.message, variant: "destructive" });
    },
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/insurance/statements/${id}/post`, "POST", {});
      return res.json();
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
      const skipped = Number(res?.skippedDuplicates ?? 0);
      toast({
        title: "Payments posted",
        description:
          `Posted ${res?.postedCount ?? 0} line(s), ${money(res?.postedTotal)} total.` +
          (skipped > 0
            ? ` Skipped ${skipped} line(s) that would have double-counted a payment already collected — review them below.`
            : ""),
      });
    },
    onError: (err: Error) => {
      // A 400 "Cannot post a voided statement." means the statement is no longer
      // in a postable state server-side — almost always because someone else
      // voided (or otherwise advanced) it while this page still shows the stale
      // postable view. Tell the user that specifically and how to recover,
      // instead of a generic "server error" that hides the real cause. Mirrors
      // the void/re-open treatment below.
      const notPostable = /voided statement|already voided|no longer/i.test(
        err.message,
      );
      toast({
        title: notPostable ? "Can't post — statement changed" : "Could not post",
        description: notPostable
          ? "This statement is no longer in a postable state — someone else may have voided or changed it. Refresh to see its current state."
          : err.message,
        variant: "destructive",
      });
    },
  });

  const voidMutation = useMutation({
    mutationFn: async () =>
      apiRequest(`/api/insurance/statements/${id}/void`, "POST", { reason: voidReason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
      setVoidOpen(false);
      setVoidReason("");
      toast({ title: "Statement voided", description: "Posted payments were reversed." });
    },
    onError: (err: Error) => {
      // A 400 "Statement already voided" means the statement is no longer posted
      // server-side — almost always because someone else already voided it while
      // this page still shows the stale posted view. Tell the user that
      // specifically and how to recover, instead of a generic "server error"
      // that hides the real cause. Mirrors the re-open treatment below.
      const alreadyVoided = /already voided/i.test(err.message);
      toast({
        title: alreadyVoided ? "Already voided" : "Could not void",
        description: alreadyVoided
          ? "This statement was already voided — someone else may have voided it. Refresh to see its current state."
          : err.message,
        variant: "destructive",
      });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async () =>
      apiRequest(`/api/insurance/statements/${id}/reopen`, "POST", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
      setReopenOpen(false);
      toast({
        title: "Statement re-opened",
        description: "Fix the lines and post again to re-record payments.",
      });
    },
    onError: (err: Error) => {
      // A 400 "Only a voided statement can be re-opened" means the statement is
      // no longer voided server-side — almost always because someone else
      // already re-opened (or otherwise advanced) it while this page still shows
      // the stale voided view. Tell the user that specifically and how to
      // recover, instead of a generic "server error" that hides the real cause.
      const alreadyReopened = /only a voided/i.test(err.message);
      toast({
        title: alreadyReopened
          ? "Already re-opened"
          : "Could not re-open",
        description: alreadyReopened
          ? "This statement is no longer voided — someone else may have re-opened it. Refresh to see its current state."
          : err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={onBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
        </div>
      </div>
    );
  }

  const { statement, lines } = data;
  const isDraft = statement.status === "draft";
  const isPosted = statement.status === "posted";
  const isVoided = statement.status === "voided";

  const confirmedCount = lines.filter((l) => l.matchStatus === "confirmed").length;
  // "Posted total" = the insurance amount actually settled by posted lines, i.e.
  // each line's full insurer-paid amount. Do NOT sum `postedAmount` here:
  // postedAmount is the NET-NEW delta added to the billing (kept for exact void
  // reversal), so it is $0 whenever a line's insurance was already recorded
  // manually and got adopted at post time — which made this tile read $0 even
  // though the statement genuinely settled that payment.
  const postedTotal = lines
    .filter((l) => l.matchStatus === "posted")
    .reduce((sum, l) => sum + (Number(l.insurancePaidAmount) || 0), 0);
  const unmatchedCount = lines.filter((l) => l.matchStatus === "unmatched").length;
  const denialCount = lines.filter((l) => isDeniedLine(l.insurancePaidAmount, l.remarkCode)).length;
  const linesTotalPaid = lines.reduce((sum, l) => sum + (Number(l.insurancePaidAmount) || 0), 0);

  return (
    <div className="p-6 space-y-6" data-testid="view-statement-detail">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" onClick={onBack} className="mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" /> All statements
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {statement.fileName} {statusBadge(statement.status)}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {statement.payerName ? `${statement.payerName} · ` : ""}
            {statement.checkNumber ? `Ref ${statement.checkNumber} · ` : ""}
            {fmtDate(statement.statementDate)}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <UserIcon className="h-4 w-4 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground">Therapist:</Label>
            <SearchableSelect
              value={statement.therapistId != null ? String(statement.therapistId) : "none"}
              onValueChange={(v) =>
                therapistMutation.mutate(v === "none" ? null : Number(v))
              }
              disabled={therapistMutation.isPending}
              options={[
                { value: "none", label: "No therapist" },
                ...(therapists ?? []).map((t) => ({
                  value: String(t.id),
                  label: t.fullName,
                })),
              ]}
              placeholder="No therapist"
              searchPlaceholder="Search therapist…"
              emptyText="No therapist found."
              triggerClassName="w-[240px] h-8"
              testId="select-detail-therapist"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isVoided && (
            <Button
              variant="outline"
              onClick={() => rematchMutation.mutate()}
              disabled={rematchMutation.isPending}
              data-testid="button-rematch"
            >
              {rematchMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Re-run matching
            </Button>
          )}
          {!isVoided && (
            <Button
              onClick={() => postMutation.mutate()}
              disabled={postMutation.isPending || confirmedCount === 0}
              data-testid="button-post-statement"
            >
              {postMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {isPosted
                ? `Post ${confirmedCount > 0 ? `${confirmedCount} ` : ""}more payment(s)`
                : `Post ${confirmedCount > 0 ? `${confirmedCount} ` : ""}payment(s)`}
            </Button>
          )}
          {isPosted && (
            <Button
              variant="destructive"
              onClick={() => setVoidOpen(true)}
              data-testid="button-void-statement"
            >
              <Ban className="h-4 w-4 mr-2" /> Void
            </Button>
          )}
          {isVoided && (
            <Button
              variant="outline"
              onClick={() => setReopenOpen(true)}
              data-testid="button-reopen-statement"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Re-open to fix &amp; re-post
            </Button>
          )}
        </div>
      </div>

      {isVoided && (
        <div
          className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2"
          data-testid="notice-voided-statement"
        >
          <Ban className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            This statement is voided — its payments were reversed and it can no
            longer be edited. Use “Re-open to fix &amp; re-post” above to make
            changes, or upload a new statement to post fresh payments.
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard label="Statement total" value={money(statement.totalPaid ?? linesTotalPaid)} />
        <SummaryCard label="Lines" value={String(lines.length)} />
        <SummaryCard label="Confirmed" value={String(confirmedCount)} />
        <SummaryCard
          label="Unmatched"
          value={String(unmatchedCount)}
          tone={unmatchedCount > 0 ? "warn" : "default"}
        />
        <SummaryCard
          label="Posted total"
          value={money(postedTotal)}
          tone="good"
          testId="text-posted-total"
        />
      </div>

      {denialCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="h-4 w-4" />
          {denialCount} line(s) appear denied (insurer paid $0 with a denial code) — review them before posting.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Claim lines</CardTitle>
          <CardDescription>
            Confirm each suggested match (or fix it) before posting. Posting records
            the insurance payment against the matched session.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service Date</TableHead>
                <TableHead>Client (statement)</TableHead>
                <TableHead>CPT</TableHead>
                <TableHead className="text-right">Ins. Paid</TableHead>
                <TableHead className="text-right">Pt. Resp.</TableHead>
                <TableHead>Remark</TableHead>
                <TableHead>Matched Session</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const canEdit = line.matchStatus !== "posted" && statement.status !== "voided";
                return (
                  <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                    <TableCell>{fmtDate(line.serviceDate)}</TableCell>
                    <TableCell className="max-w-[160px] truncate" title={line.clientNameRaw || ""}>
                      {line.clientNameRaw || "—"}
                    </TableCell>
                    <TableCell>{line.serviceCode || "—"}</TableCell>
                    <TableCell className="text-right">{money(line.insurancePaidAmount)}</TableCell>
                    <TableCell className="text-right">{money(line.patientResponsibility)}</TableCell>
                    <TableCell className="max-w-[120px] truncate" title={line.remarkCode || ""}>
                      {line.remarkCode ? (
                        <span className="text-amber-700">{line.remarkCode}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {line.matchedSessionId ? (
                        <div className="text-xs">
                          <div className="font-medium">{line.matchedClientName || "Client"}</div>
                          <div className="text-muted-foreground">
                            {fmtDate(line.matchedSessionDate)}
                            {line.matchedServiceCode ? ` · ${line.matchedServiceCode}` : ""}
                          </div>
                          <div className="text-muted-foreground">
                            {line.matchedSessionBillingId
                              ? `Billing #${line.matchedSessionBillingId}`
                              : "Not billed yet · a bill is created on confirm"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">No session matched</span>
                      )}
                    </TableCell>
                    <TableCell>{matchBadge(line)}</TableCell>
                    <TableCell className="text-right">
                      {canEdit ? (
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-1">
                            {line.matchStatus === "suggested" && line.matchedSessionId && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                disabled={lineMutation.isPending}
                                onClick={() =>
                                  lineMutation.mutate({ lineId: line.id, matchStatus: "confirmed" })
                                }
                                data-testid={`button-confirm-${line.id}`}
                              >
                                <Check className="h-3.5 w-3.5 mr-1" /> Confirm
                              </Button>
                            )}
                            {line.matchStatus === "confirmed" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                disabled={lineMutation.isPending}
                                onClick={() =>
                                  lineMutation.mutate({ lineId: line.id, matchStatus: "suggested" })
                                }
                                data-testid={`button-unconfirm-${line.id}`}
                              >
                                <X className="h-3.5 w-3.5 mr-1" /> Unconfirm
                              </Button>
                            )}
                            {line.matchStatus !== "skipped" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-muted-foreground"
                                disabled={lineMutation.isPending}
                                onClick={() =>
                                  lineMutation.mutate({ lineId: line.id, matchStatus: "skipped" })
                                }
                                data-testid={`button-skip-${line.id}`}
                              >
                                Skip
                              </Button>
                            )}
                            {line.matchStatus === "skipped" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                disabled={lineMutation.isPending}
                                onClick={() =>
                                  lineMutation.mutate({ lineId: line.id, matchStatus: "unmatched" })
                                }
                                data-testid={`button-unskip-${line.id}`}
                              >
                                Un-skip
                              </Button>
                            )}
                            {line.matchedSessionId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-muted-foreground"
                                title="Clear match"
                                disabled={lineMutation.isPending}
                                onClick={() =>
                                  lineMutation.mutate({
                                    lineId: line.id,
                                    matchStatus: "unmatched",
                                    matchedSessionBillingId: null,
                                  })
                                }
                                data-testid={`button-clear-${line.id}`}
                              >
                                <Link2Off className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Input
                              placeholder="Billing #"
                              className="h-7 w-24 text-xs"
                              value={rematchBillingId[line.id] ?? ""}
                              onChange={(e) =>
                                setRematchBillingId((prev) => ({
                                  ...prev,
                                  [line.id]: e.target.value,
                                }))
                              }
                              data-testid={`input-billing-${line.id}`}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              disabled={lineMutation.isPending || !rematchBillingId[line.id]}
                              onClick={() => {
                                const v = parseInt(rematchBillingId[line.id]);
                                if (isNaN(v)) {
                                  toast({
                                    title: "Enter a valid billing number",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                                lineMutation.mutate({
                                  lineId: line.id,
                                  matchStatus: "confirmed",
                                  matchedSessionBillingId: v,
                                });
                                setRematchBillingId((prev) => ({ ...prev, [line.id]: "" }));
                              }}
                              data-testid={`button-link-${line.id}`}
                            >
                              Link
                            </Button>
                          </div>
                        </div>
                      ) : line.matchStatus === "posted" ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-xs text-muted-foreground">
                            {money(line.postedAmount)}
                          </span>
                          {!isVoided && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-amber-700 hover:text-amber-800"
                              title="Undo just this one payment (keeps the rest of the statement posted)"
                              disabled={reverseLineMutation.isPending}
                              onClick={() => {
                                setReverseReason("");
                                setReverseLineId(line.id);
                              }}
                              data-testid={`button-reverse-${line.id}`}
                            >
                              <Undo2 className="h-3.5 w-3.5 mr-1" /> Reverse
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={reverseLineId !== null} onOpenChange={(o) => { if (!o) setReverseLineId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse just this one payment?</DialogTitle>
            <DialogDescription>
              This undoes only this single line's insurance payment and removes it
              from the billing. The rest of the statement stays posted. You can add
              a short reason for the audit log (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reverse-reason">Reason (optional)</Label>
            <Textarea
              id="reverse-reason"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="e.g. This line was matched to the wrong session"
              data-testid="input-reverse-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseLineId(null)}>
              Cancel
            </Button>
            <Button
              disabled={reverseLineMutation.isPending}
              onClick={() => {
                if (reverseLineId !== null) {
                  reverseLineMutation.mutate({ lineId: reverseLineId, reason: reverseReason.trim() });
                }
              }}
              data-testid="button-confirm-reverse"
            >
              {reverseLineMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4 mr-2" />
              )}
              Reverse this line
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this statement?</DialogTitle>
            <DialogDescription>
              This reverses every insurance payment that was posted from this
              statement. Give a reason for the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Statement uploaded in error"
              data-testid="input-void-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidMutation.isPending || !voidReason.trim()}
              onClick={() => voidMutation.mutate()}
              data-testid="button-confirm-void"
            >
              {voidMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Ban className="h-4 w-4 mr-2" />
              )}
              Void statement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-open this voided statement?</DialogTitle>
            <DialogDescription>
              This moves the reversed lines back to confirmed and clears the void
              so you can fix and post the statement again. Re-posting won't
              double-count payments that are already recorded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reopenMutation.isPending}
              onClick={() => reopenMutation.mutate()}
              data-testid="button-confirm-reopen"
            >
              {reopenMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Re-open statement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transactions tab — flat searchable list of every line across all statements
// ---------------------------------------------------------------------------
type TxFilter = "all" | "confirmed" | "not_confirmed" | "not_matched" | "posted" | "denied";

function txMatchBadge(status: string) {
  switch (status) {
    case "posted":
      return <Badge className="bg-green-600 hover:bg-green-600">Posted</Badge>;
    case "confirmed":
      return <Badge className="bg-blue-600 hover:bg-blue-600">Confirmed</Badge>;
    case "suggested":
      return (
        <Badge variant="outline" className="border-amber-500 text-amber-700">Suggested</Badge>
      );
    case "skipped":
      return <Badge variant="secondary">Skipped</Badge>;
    case "reversed":
      return (
        <Badge variant="outline" className="border-red-400 text-red-700">Reversed</Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-gray-400 text-gray-600">No match</Badge>
      );
  }
}

function TransactionsList({ onOpen }: { onOpen: (id: number) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TxFilter>("all");
  const [therapist, setTherapist] = useState<string>("all");
  const [postOpen, setPostOpen] = useState(false);
  const { toast } = useToast();

  const { data: rows, isLoading } = useQuery<TransactionRow[]>({
    queryKey: ["/api/insurance/transactions"],
  });

  const invalidateInsurance = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/insurance/transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/insurance/statements"] });
  };

  // Statements in the current therapist scope (all of them when "all" is picked).
  // Used to keep the bulk actions limited to what the user is actually looking at.
  const scopeStatementIds = () =>
    Array.from(
      new Set(
        (rows ?? [])
          .filter((r) => therapist === "all" || r.therapistName === therapist)
          .map((r) => r.statementId),
      ),
    );

  // Re-run matching across the in-scope open statements. Safe: only ever suggests.
  const rematchAll = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/insurance/rematch-all", "POST", {
        statementIds: scopeStatementIds(),
      });
      return res.json();
    },
    onSuccess: (data: { statementsScanned: number; newlyMatched: number }) => {
      invalidateInsurance();
      toast({
        title: "Re-scan complete",
        description:
          data.newlyMatched > 0
            ? `Found ${data.newlyMatched} new match${data.newlyMatched === 1 ? "" : "es"} across ${data.statementsScanned} statement${data.statementsScanned === 1 ? "" : "s"}.`
            : `No new matches found across ${data.statementsScanned} statement${data.statementsScanned === 1 ? "" : "s"}.`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Re-scan failed", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  // Confirm one suggested line (human approval before any posting).
  const confirmLine = useMutation({
    mutationFn: async (lineId: number) =>
      apiRequest(`/api/insurance/lines/${lineId}`, "PATCH", { matchStatus: "confirmed" }),
    onSuccess: () => {
      invalidateInsurance();
      toast({ title: "Match confirmed", description: "Ready to post." });
    },
    onError: (err: any) =>
      toast({ title: "Could not confirm", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  // Post the in-scope confirmed lines (records the insurance payments). Money action.
  const postAll = useMutation({
    mutationFn: async (statementIds: number[]) => {
      const res = await apiRequest("/api/insurance/post-all", "POST", { statementIds });
      return res.json();
    },
    onSuccess: (data: {
      statementsPosted: number;
      postedCount: number;
      postedTotal: number;
      failedCount?: number;
    }) => {
      invalidateInsurance();
      setPostOpen(false);
      const base = `Recorded ${data.postedCount} payment${data.postedCount === 1 ? "" : "s"} totaling ${money(data.postedTotal)} across ${data.statementsPosted} statement${data.statementsPosted === 1 ? "" : "s"}.`;
      if (data.failedCount && data.failedCount > 0) {
        toast({
          title: "Posted with some errors",
          description: `${base} ${data.failedCount} statement${data.failedCount === 1 ? "" : "s"} could not be posted — open ${data.failedCount === 1 ? "it" : "them"} to review.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Posted", description: base });
      }
    },
    onError: (err: any) =>
      toast({ title: "Post failed", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  // Confirmed lines ready to post within the current therapist scope — exactly
  // what the "Post" button commits, so the count/total match what's on screen.
  const confirmedRows = (rows ?? []).filter(
    (r) => r.matchStatus === "confirmed" && (therapist === "all" || r.therapistName === therapist),
  );
  const confirmedCount = confirmedRows.length;
  const confirmedTotal = confirmedRows.reduce(
    (sum, r) => sum + (Number(r.insurancePaidAmount) || 0),
    0,
  );
  const confirmedStatementIds = Array.from(new Set(confirmedRows.map((r) => r.statementId)));

  // Statements visible in the current therapist scope; Re-scan is disabled when
  // there are none so it can never fall back to scanning everything.
  const inScopeStatementCount = new Set(
    (rows ?? [])
      .filter((r) => therapist === "all" || r.therapistName === therapist)
      .map((r) => r.statementId),
  ).size;

  // Distinct therapist names present in the data, for the therapist picker.
  const therapistNames = Array.from(
    new Set((rows ?? []).map((r) => r.therapistName).filter((n): n is string => !!n)),
  ).sort((a, b) => a.localeCompare(b));

  const filtered = (rows ?? []).filter((r) => {
    if (therapist !== "all" && r.therapistName !== therapist) return false;
    // Status filter. "Confirmed" groups confirmed+posted; "Not confirmed"
    // groups everything still needing attention; "Denied" = insurer paid $0 with a denial code.
    if (filter === "confirmed" && !(r.matchStatus === "confirmed" || r.matchStatus === "posted"))
      return false;
    if (
      filter === "not_confirmed" &&
      !(r.matchStatus === "unmatched" || r.matchStatus === "suggested" || r.matchStatus === "skipped")
    )
      return false;
    if (filter === "posted" && r.matchStatus !== "posted") return false;
    // "Not matched" = lines that aren't tied to any session yet.
    if (filter === "not_matched" && r.matchStatus !== "unmatched") return false;
    if (filter === "denied" && !isDeniedLine(r.insurancePaidAmount, r.remarkCode)) return false;

    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [
      r.therapistName,
      r.clientName,
      r.serviceCode,
      r.payerName,
      r.statementFileName,
      r.remarkCode,
      r.insurancePaidAmount,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Transactions</CardTitle>
        <CardDescription>
          Every line from every statement. Pick a therapist, search by client,
          code, or amount, then click a row to open its statement.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search therapist, client, code, amount…"
              className="pl-8"
              data-testid="input-search-transactions"
            />
          </div>
          <SearchableSelect
            value={therapist}
            onValueChange={setTherapist}
            options={[
              { value: "all", label: "All therapists" },
              ...therapistNames.map((name) => ({ value: name, label: name })),
            ]}
            placeholder="All therapists"
            searchPlaceholder="Search therapist…"
            emptyText="No therapist found."
            triggerClassName="w-[200px]"
            testId="select-transaction-therapist"
          />
          <Select value={filter} onValueChange={(v) => setFilter(v as TxFilter)}>
            <SelectTrigger className="w-[180px]" data-testid="select-transaction-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="not_confirmed">Not confirmed</SelectItem>
              <SelectItem value="not_matched">Not matched</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="text-sm text-muted-foreground" data-testid="text-ready-to-post">
            {confirmedCount > 0
              ? `${confirmedCount} confirmed line${confirmedCount === 1 ? "" : "s"} · ${money(confirmedTotal)} ready to post`
              : "No confirmed lines waiting to post."}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => rematchAll.mutate()}
              disabled={rematchAll.isPending || inScopeStatementCount === 0}
              data-testid="button-rescan-transactions"
            >
              {rematchAll.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Re-scan unmatched
            </Button>
            <Button
              onClick={() => setPostOpen(true)}
              disabled={confirmedCount === 0 || postAll.isPending}
              data-testid="button-post-all-transactions"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Post{confirmedCount > 0 ? ` (${confirmedCount})` : ""}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : !filtered.length ? (
          <div className="text-center py-10 text-muted-foreground" data-testid="text-no-transactions">
            No transactions match your search.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Therapist</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Service Date</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Insurance Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payer / File</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow
                  key={r.lineId}
                  className="cursor-pointer"
                  onClick={() => onOpen(r.statementId)}
                  data-testid={`row-transaction-${r.lineId}`}
                >
                  <TableCell>{r.therapistName || "—"}</TableCell>
                  <TableCell>{r.clientName || "—"}</TableCell>
                  <TableCell>{fmtDate(r.serviceDate)}</TableCell>
                  <TableCell>{r.serviceCode || "—"}</TableCell>
                  <TableCell className="text-right">{money(r.insurancePaidAmount)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      {txMatchBadge(r.matchStatus)}
                      {isDeniedLine(r.insurancePaidAmount, r.remarkCode) && (
                        <Badge variant="outline" className="border-red-400 text-red-700">
                          Denied
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={r.statementFileName}>
                    {r.payerName ? `${r.payerName} · ` : ""}
                    {r.statementFileName}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {r.matchStatus === "suggested" && (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmLine.mutate(r.lineId);
                          }}
                          disabled={confirmLine.isPending}
                          data-testid={`button-confirm-transaction-${r.lineId}`}
                        >
                          <Check className="h-4 w-4 mr-1" /> Confirm
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r.statementId);
                        }}
                        data-testid={`button-open-transaction-${r.lineId}`}
                      >
                        Open
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>

    <Dialog open={postOpen} onOpenChange={(o) => !postAll.isPending && setPostOpen(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post confirmed payments?</DialogTitle>
          <DialogDescription>
            This records {confirmedCount} confirmed line{confirmedCount === 1 ? "" : "s"} totaling{" "}
            <span className="font-semibold">{money(confirmedTotal)}</span>{" "}
            {therapist === "all" ? "across all therapists" : `for ${therapist}`} as insurance
            payments. This affects therapist pay and can only be undone by voiding. Only lines you
            have confirmed will be posted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setPostOpen(false)}
            disabled={postAll.isPending}
            data-testid="button-cancel-post-all"
          >
            Cancel
          </Button>
          <Button
            onClick={() => postAll.mutate(confirmedStatementIds)}
            disabled={postAll.isPending}
            data-testid="button-confirm-post-all"
          >
            {postAll.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Post {money(confirmedTotal)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
  testId,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
  testId?: string;
}) {
  const toneClass =
    tone === "good" ? "text-green-600" : tone === "warn" ? "text-amber-600" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-xl font-bold mt-1 ${toneClass}`} data-testid={testId}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
