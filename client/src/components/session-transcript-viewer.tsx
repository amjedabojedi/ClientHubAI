import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Copy, Download, Trash2, FileAudio, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCsrfToken } from "@/lib/queryClient";
import { format } from "date-fns";

type SessionTranscript = {
  id: number;
  sessionId: number;
  clientId: number;
  therapistId: number;
  content: string;
  rawContent: string | null;
  language: string | null;
  durationSeconds: number | null;
  chunkCount: number | null;
  wordCount: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

interface SessionTranscriptViewerProps {
  sessionId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function SessionTranscriptViewer({
  sessionId,
  open,
  onOpenChange,
}: SessionTranscriptViewerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<SessionTranscript | null>({
    queryKey: ["/api/sessions", sessionId, "transcript"],
    enabled: open && sessionId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/transcript`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const handleCopy = async () => {
    if (!data?.content) return;
    try {
      await navigator.clipboard.writeText(data.content);
      toast({ title: "Copied to clipboard" });
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    if (!data) return;
    const header = `Session Transcript\nSession ID: ${data.sessionId}\nDate: ${format(
      new Date(data.createdAt),
      "PPPp",
    )}\nDuration: ${data.durationSeconds ? formatDuration(data.durationSeconds) : "—"}\nWords: ${data.wordCount ?? "—"}\n\n---\n\n`;
    const blob = new Blob([header + data.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${data.sessionId}-transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (!sessionId) return;
    if (!confirm("Permanently delete this transcript? This cannot be undone.")) return;
    setIsDeleting(true);
    try {
      const csrfToken = getCsrfToken();
      const res = await fetch(`/api/sessions/${sessionId}/transcript`, {
        method: "DELETE",
        credentials: "include",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Transcript deleted" });
      // Close immediately on server success — don't gate on cache refresh.
      onOpenChange(false);
      // Best-effort cache invalidation; failures here shouldn't surface as "Delete failed".
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "transcript"] });
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err.message || "Could not delete transcript.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileAudio className="h-5 w-5 text-blue-600" />
            Session Transcript
          </DialogTitle>
          <DialogDescription>
            Speaker-labeled transcript saved as a separate document attached to this session.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading transcript…
          </div>
        )}

        {!isLoading && isError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Could not load transcript</div>
              <div className="text-xs mt-1">{(error as Error)?.message || "Unknown error"}</div>
            </div>
          </div>
        )}

        {!isLoading && !isError && !data && (
          <div className="py-12 text-center text-muted-foreground">
            <FileAudio className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <div className="font-medium">No transcript saved for this session</div>
            <div className="text-sm mt-1">
              Open the session note and use the recorder to create one.
            </div>
          </div>
        )}

        {!isLoading && !isError && data && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground border-b pb-3">
              <Badge variant="outline">Status: {data.status}</Badge>
              <span>
                Duration:{" "}
                <strong className="text-foreground">
                  {data.durationSeconds ? formatDuration(data.durationSeconds) : "—"}
                </strong>
              </span>
              <span>
                Chunks: <strong className="text-foreground">{data.chunkCount ?? "—"}</strong>
              </span>
              <span>
                Words: <strong className="text-foreground">{data.wordCount ?? "—"}</strong>
              </span>
              <span>
                Recorded:{" "}
                <strong className="text-foreground">
                  {format(new Date(data.createdAt), "MMM d, yyyy 'at' p")}
                </strong>
              </span>
            </div>
            <div
              data-testid="text-transcript-content"
              className="flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4 whitespace-pre-wrap text-sm font-mono leading-relaxed"
            >
              {data.content}
            </div>
          </>
        )}

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          {data && (
            <>
              <Button
                data-testid="button-copy-transcript"
                variant="outline"
                size="sm"
                onClick={handleCopy}
              >
                <Copy className="h-4 w-4 mr-1" /> Copy
              </Button>
              <Button
                data-testid="button-download-transcript"
                variant="outline"
                size="sm"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4 mr-1" /> Download .txt
              </Button>
              <Button
                data-testid="button-delete-transcript-viewer"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-destructive hover:text-destructive"
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Delete
              </Button>
            </>
          )}
          <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
