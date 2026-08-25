import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Calendar, CheckCircle2, Clock, Filter, Mic, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateDisplay, formatDateTimeDisplay } from "@/lib/datetime";
import type { UnresolvedRecordingAttempt } from "@shared/schema";

export default function UnresolvedRecordingsPage() {
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");

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
            Review unfinished session recordings across the practice. This report is read-only and does not delete or recover anything.
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
                Only unfinished attempts are listed. Open a session to use its existing authorized review controls.
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
                          <TableCell className="whitespace-nowrap text-sm">{formatDateTimeDisplay(attempt.createdAt)}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{formatDateTimeDisplay(attempt.updatedAt)}</TableCell>
                          <TableCell className="text-right">
                            <Link href={`/clients/${attempt.clientId}?tab=sessions&sessionId=${attempt.sessionId}`}>
                              <Button variant="outline" size="sm" data-testid={`button-review-unresolved-${attempt.id}`}>
                                Review session
                              </Button>
                            </Link>
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
    </div>
  );
}