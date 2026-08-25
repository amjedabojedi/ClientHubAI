import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Calendar, CheckCircle2, Clock, Filter, Mic, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateDisplay, formatDateTimeDisplay } from "@/lib/datetime";
import { getCsrfToken } from "@/lib/queryClient";
import type { RecordingRetentionDecision, UnresolvedRecordingAttempt } from "@shared/schema";

const decisionLabels: Record<RecordingRetentionDecision, string> = {
  retain: "Retain recording/transcript",
  cleanup_authorized: "Cleanup authorized separately",
  defer: "Defer decision",
};

export default function UnresolvedRecordingsPage() {
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [decisionAttempt, setDecisionAttempt] = useState<UnresolvedRecordingAttempt | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState<UnresolvedRecordingAttempt | null>(null);
  const [decision, setDecision] = useState<RecordingRetentionDecision>("retain");
  const [rationale, setRationale] = useState("");
  const queryClient = useQueryClient();

  const { data: attempts = [], isLoading, isFetching, error, refetch } = useQuery<UnresolvedRecordingAttempt[]>({
    queryKey: ["/api/admin/session-transcripts/recovery", createdFrom, createdTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (createdFrom) params.set("createdFrom", createdFrom);
      if (createdTo) params.set("createdTo", createdTo);
      const query = params.toString();
      const response = await fetch(`/api/admin/session-transcripts/recovery${query ? `?${query}` : ""}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load unresolved recording attempts");
      }
      return response.json();
    },
  });

  const recordDecision = useMutation({
    mutationFn: async () => {
      if (!decisionAttempt) throw new Error("No recording attempt selected");
      const csrfToken = getCsrfToken();
      const response = await fetch(
        `/api/admin/session-transcripts/recovery/${decisionAttempt.id}/decisions`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
          body: JSON.stringify({ decision, rationale: rationale.trim() }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Failed to record retention decision");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/session-transcripts/recovery"] });
      setDecisionAttempt(null);
      setRationale("");
      setDecision("retain");
    },
  });

  const recoverableCount = attempts.filter((attempt) => attempt.classification === "recoverable").length;
  const abandonedCount = attempts.length - recoverableCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Mic className="h-8 w-8 text-blue-600" />
            Unresolved Recording Attempts
          </h1>
          <p className="mt-2 text-muted-foreground">
            Review unfinished session recordings across the practice. Recording a decision adds an audited history entry; it does not delete or recover anything.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-unresolved-recordings"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="h-5 w-5" />
            Created date range
          </CardTitle>
          <CardDescription>
            Leave either field blank to include all unfinished attempts. Dates use the practice timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="unresolved-created-from">From</Label>
              <Input
                id="unresolved-created-from"
                type="date"
                value={createdFrom}
                max={createdTo || undefined}
                onChange={(event) => setCreatedFrom(event.target.value)}
                data-testid="input-unresolved-created-from"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unresolved-created-to">Through</Label>
              <Input
                id="unresolved-created-to"
                type="date"
                value={createdTo}
                min={createdFrom || undefined}
                onChange={(event) => setCreatedTo(event.target.value)}
                data-testid="input-unresolved-created-to"
              />
            </div>
            {(createdFrom || createdTo) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setCreatedFrom("");
                  setCreatedTo("");
                }}
                data-testid="button-clear-unresolved-filters"
              >
                Clear dates
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not load report</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading unresolved recording attempts…
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-3 pt-6">
                <Clock className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-2xl font-bold">{attempts.length}</p>
                  <p className="text-sm text-muted-foreground">Unfinished attempts</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 pt-6">
                <CheckCircle2 className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-2xl font-bold">{recoverableCount}</p>
                  <p className="text-sm text-muted-foreground">Potentially recoverable</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 pt-6">
                <AlertCircle className="h-5 w-5 text-slate-500" />
                <div>
                  <p className="text-2xl font-bold">{abandonedCount}</p>
                  <p className="text-sm text-muted-foreground">Likely abandoned</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recording attempts</CardTitle>
              <CardDescription>
                Only unfinished attempts are listed. Decisions are append-only and cleanup remains a separate authorized action.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {attempts.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
                  No unresolved recording attempts match this date range.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Session / client</TableHead>
                        <TableHead>Therapist</TableHead>
                        <TableHead>Attempt status</TableHead>
                        <TableHead>Chunks</TableHead>
                        <TableHead>Retention decision</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Last updated</TableHead>
                        <TableHead className="text-right">Review</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attempts.map((attempt) => (
                        <TableRow key={attempt.id} data-testid={`row-unresolved-recording-${attempt.id}`}>
                          <TableCell>
                            <div className="font-medium">{attempt.clientName}</div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {formatDateDisplay(attempt.sessionDate)} · Session #{attempt.sessionId}
                            </div>
                          </TableCell>
                          <TableCell>{attempt.therapistName}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Badge variant={attempt.classification === "recoverable" ? "default" : "outline"}>
                                {attempt.classification === "recoverable" ? "Potentially recoverable" : "Likely abandoned"}
                              </Badge>
                              <div className="text-xs text-muted-foreground">
                                {attempt.status === "processing" ? "Finalization in progress" : "Recording interrupted"}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">{attempt.persistedChunkCount}</span>
                            <span className="text-muted-foreground">
                              {" "}saved{attempt.chunkCount > 0 ? ` of ${attempt.chunkCount}` : ""}
                            </span>
                          </TableCell>
                          <TableCell>
                            {attempt.retentionDecisions.length > 0 ? (
                              <div className="space-y-1">
                                <Badge variant="secondary">
                                  {decisionLabels[attempt.retentionDecisions[attempt.retentionDecisions.length - 1].decision]}
                                </Badge>
                                <div className="text-xs text-muted-foreground">
                                  {attempt.retentionDecisions.length} decision{attempt.retentionDecisions.length === 1 ? "" : "s"} ·{" "}
                                  {attempt.retentionDecisions[attempt.retentionDecisions.length - 1].decidedByName}
                                </div>
                                <div className="max-w-[18rem] truncate text-xs text-muted-foreground" title={attempt.retentionDecisions[attempt.retentionDecisions.length - 1].rationale}>
                                  {attempt.retentionDecisions[attempt.retentionDecisions.length - 1].rationale}
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">Not recorded</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatDateTimeDisplay(attempt.createdAt)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatDateTimeDisplay(attempt.updatedAt)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => setDecisionAttempt(attempt)}
                                data-testid={`button-record-retention-decision-${attempt.id}`}
                              >
                                <ShieldCheck className="mr-1 h-4 w-4" />
                                Record decision
                              </Button>
                              {attempt.retentionDecisions.length > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setHistoryAttempt(attempt)}
                                  data-testid={`button-view-retention-history-${attempt.id}`}
                                >
                                  View history
                                </Button>
                              )}
                              <Link href={`/clients/${attempt.clientId}?tab=sessions&sessionId=${attempt.sessionId}`}>
                                <Button variant="outline" size="sm" data-testid={`button-review-unresolved-${attempt.id}`}>
                                  Review session
                                </Button>
                              </Link>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={historyAttempt !== null} onOpenChange={(open) => !open && setHistoryAttempt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retention decision history</DialogTitle>
            <DialogDescription>
              Append-only decisions for {historyAttempt?.clientName}, session #{historyAttempt?.sessionId}.
              This history records decisions only; it does not expose or remove audio or transcript content.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(28rem,60vh)] space-y-3 overflow-y-auto pr-1">
            {historyAttempt?.retentionDecisions.map((retentionDecision, index) => (
              <div key={retentionDecision.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="secondary">{decisionLabels[retentionDecision.decision]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Decision {index + 1} · {formatDateTimeDisplay(retentionDecision.decidedAt)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{retentionDecision.rationale}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Recorded by {retentionDecision.decidedByName}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={decisionAttempt !== null}
        onOpenChange={(open) => {
          if (!open && !recordDecision.isPending) {
            setDecisionAttempt(null);
            setRationale("");
            setDecision("retain");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record retention decision</DialogTitle>
            <DialogDescription>
              Record the approved decision for {decisionAttempt?.clientName}, session #{decisionAttempt?.sessionId}.
              This only records the decision; it does not delete audio or transcript content.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="retention-decision">Decision</Label>
              <Select value={decision} onValueChange={(value) => setDecision(value as RecordingRetentionDecision)}>
                <SelectTrigger id="retention-decision" data-testid="select-retention-decision">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(decisionLabels) as RecordingRetentionDecision[]).map((value) => (
                    <SelectItem key={value} value={value}>{decisionLabels[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="retention-rationale">Rationale</Label>
              <Textarea
                id="retention-rationale"
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                placeholder="Explain the approved retention decision."
                maxLength={4000}
                rows={5}
                data-testid="textarea-retention-rationale"
              />
              <p className="text-xs text-muted-foreground">{rationale.length}/4000 characters</p>
            </div>
            {decisionAttempt && decisionAttempt.retentionDecisions.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Existing decisions are kept</p>
                <p className="mt-1 text-muted-foreground">
                  This will append a new decision to the history; it will not replace earlier decisions.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDecisionAttempt(null)} disabled={recordDecision.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => recordDecision.mutate()}
              disabled={!rationale.trim() || recordDecision.isPending}
              data-testid="button-save-retention-decision"
            >
              {recordDecision.isPending ? "Saving..." : "Save decision"}
            </Button>
          </DialogFooter>
          {recordDecision.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{recordDecision.error.message}</AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}