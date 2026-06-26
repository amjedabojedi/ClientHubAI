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
  FileText, Upload, Loader2, ArrowLeft, CheckCircle2, Ban, AlertTriangle,
  Check, X, RefreshCw, Link2Off,
} from "lucide-react";

type MatchStatus = "unmatched" | "suggested" | "confirmed" | "posted" | "skipped";
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
  uploadedByName: string | null;
  createdAt: string;
  lineCount: number;
  matchedCount: number;
  postedCount: number;
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
  matchStatus: MatchStatus;
  matchConfidence: "high" | "medium" | "low" | null;
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
  lines: StatementLine[];
}

const money = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
};

// Render a literal YYYY-MM-DD without constructing a Date (avoids timezone shift).
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const ymd = String(d).slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[2]}/${m[3]}/${m[1]}`;
};

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
      return (
        <Badge variant="outline" className="border-amber-500 text-amber-700">
          Suggested{line.matchConfidence ? ` · ${line.matchConfidence}` : ""}
        </Badge>
      );
    case "skipped":
      return <Badge variant="secondary">Skipped</Badge>;
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

  if (selectedId === null) {
    return <StatementList onOpen={setSelectedId} />;
  }
  return <StatementDetailView id={selectedId} onBack={() => setSelectedId(null)} />;
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

  const { data: statements, isLoading } = useQuery<StatementSummary[]>({
    queryKey: ["/api/insurance/statements"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, force }: { file: File; force?: boolean }) => {
      const formData = new FormData();
      formData.append("file", file);
      if (force) formData.append("force", "true");
      const res = await apiRequest("/api/insurance/statements", "POST", formData);
      const body = (await res.json()) as StatementDetail | { duplicate: DuplicateInfo };
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

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate({ file });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-insurance-reconciliation">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" /> Insurance Reconciliation
          </h1>
          <p className="text-muted-foreground mt-1">
            Upload an insurance payment statement (PDF or Excel/CSV). We read the
            paid lines, match them to sessions, and record the insurance payments.
          </p>
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
                  <TableHead>File</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Statement Date</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
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
                    <TableCell className="font-medium max-w-[220px] truncate" title={s.fileName}>
                      <span className="inline-flex items-center gap-2">
                        <Badge variant="outline" className="uppercase text-[10px]">
                          {s.sourceType}
                        </Badge>
                        {s.fileName}
                      </span>
                    </TableCell>
                    <TableCell>{s.payerName || "—"}</TableCell>
                    <TableCell>{fmtDate(s.statementDate)}</TableCell>
                    <TableCell className="text-right">{money(s.totalPaid)}</TableCell>
                    <TableCell className="text-center">{s.lineCount}</TableCell>
                    <TableCell className="text-center">{s.matchedCount}</TableCell>
                    <TableCell className="text-center">{s.postedCount}</TableCell>
                    <TableCell>{statusBadge(s.status)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpen(s.id)}
                        data-testid={`button-open-statement-${s.id}`}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
  const [rematchBillingId, setRematchBillingId] = useState<Record<number, string>>({});

  const queryKey = [`/api/insurance/statements/${id}`];
  const { data, isLoading } = useQuery<StatementDetail>({ queryKey });

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
      toast({
        title: "Payments posted",
        description: `Posted ${res?.postedCount ?? 0} line(s), ${money(res?.postedTotal)} total.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not post", description: err.message, variant: "destructive" });
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
      toast({ title: "Could not void", description: err.message, variant: "destructive" });
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
  const denialCount = lines.filter((l) => !!l.remarkCode).length;
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
        </div>
      </div>

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
        <SummaryCard label="Posted total" value={money(postedTotal)} tone="good" />
      </div>

      {denialCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="h-4 w-4" />
          {denialCount} line(s) have a remark/denial code — review them before posting.
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
                      {line.matchedSessionBillingId ? (
                        <div className="text-xs">
                          <div className="font-medium">{line.matchedClientName || "Client"}</div>
                          <div className="text-muted-foreground">
                            {fmtDate(line.matchedSessionDate)}
                            {line.matchedServiceCode ? ` · ${line.matchedServiceCode}` : ""}
                          </div>
                          <div className="text-muted-foreground">
                            Billing #{line.matchedSessionBillingId}
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
                            {line.matchStatus === "suggested" && line.matchedSessionBillingId && (
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
                            {line.matchedSessionBillingId && (
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
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {line.matchStatus === "posted" ? money(line.postedAmount) : "—"}
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
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  const toneClass =
    tone === "good" ? "text-green-600" : tone === "warn" ? "text-amber-600" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-xl font-bold mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
