import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { formatDateTimeDisplay } from "@/lib/datetime";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// Rich Text Editor
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

// Icons
import {
  ArrowLeft,
  Download,
  FileText,
  Save,
  CheckCircle,
  AlertCircle,
  Lock,
  MoreVertical,
  Loader2,
} from "lucide-react";

// Utils
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["clean"],
  ],
};

const quillFormats = ["header", "bold", "italic", "underline", "list", "bullet"];

export default function ClientReportPage() {
  const [, params] = useRoute("/clients/:clientId/reports/:reportId");
  const [, setLocation] = useLocation();
  const clientId = params?.clientId ? parseInt(params.clientId) : null;
  const reportId = params?.reportId ? parseInt(params.reportId) : null;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editorContent, setEditorContent] = useState("");
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const response = await fetch(`/api/reports/${reportId}/download/pdf`, {
        credentials: "include",
      });
      if (!response.ok) {
        let message = "Failed to generate PDF. Please try again.";
        try {
          const data = await response.json();
          if (data?.message) message = data.message;
        } catch {
          // response was not JSON; keep default message
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `client-report-${reportId}.pdf`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        title: "Download Failed",
        description: error?.message || "Failed to generate PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const { data: report, isLoading } = useQuery<any>({
    queryKey: [`/api/reports/${reportId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!reportId,
  });

  useEffect(() => {
    if (report) {
      setEditorContent(
        report.finalContent || report.draftContent || report.generatedContent || "",
      );
    }
  }, [report]);

  const saveDraftMutation = useMutation({
    mutationFn: async (draftContent: string) => {
      return apiRequest(`/api/reports/${reportId}`, "PUT", { draftContent });
    },
    onSuccess: () => {
      toast({ title: "Draft saved successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/reports`] });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save draft. Please try again.",
        variant: "destructive",
      });
    },
  });

  const finalizeReportMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/reports/${reportId}/finalize`, "POST");
    },
    onSuccess: () => {
      toast({ title: "Report finalized successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/reports`] });
      }
      setFinalizeModalOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Finalization Failed",
        description: error.message || "Failed to finalize report. Please try again.",
        variant: "destructive",
      });
      setFinalizeModalOpen(false);
    },
  });

  const unfinalizeReportMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/reports/${reportId}/unfinalize`, "POST");
    },
    onSuccess: () => {
      toast({
        title: "Report Reopened",
        description: "The report can now be edited again.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/reports`] });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Reopen Failed",
        description: error.message || "Failed to reopen report. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSaveAndFinalize = async () => {
    await saveDraftMutation.mutateAsync(editorContent);
    setFinalizeModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading report...</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Report Not Found</h2>
          <p className="text-slate-600 mb-4">The requested report could not be found.</p>
          <Button onClick={() => setLocation(clientId ? `/clients/${clientId}?tab=reports` : "/clients")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  const isFinalized = !!report.isFinalized;
  const clientName = report.client?.fullName || "Client";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/clients/${report.clientId}?tab=reports`)}
            data-testid="button-back-to-reports"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Client Report</h1>
            <p className="text-sm text-slate-600">
              {clientName}
              {report.templateName ? ` • ${report.templateName}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {isFinalized ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              <CheckCircle className="w-3 h-3 mr-1" />
              Finalized
            </Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-report-actions">
                <MoreVertical className="w-4 h-4 mr-2" />
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {isFinalized ? (
                <DropdownMenuItem
                  onClick={() => unfinalizeReportMutation.mutate()}
                  disabled={unfinalizeReportMutation.isPending}
                  data-testid="button-reopen-report"
                >
                  <AlertCircle className="w-4 h-4 mr-2" />
                  {unfinalizeReportMutation.isPending ? "Reopening..." : "Reopen Report"}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  handleDownloadPdf();
                }}
                disabled={isDownloadingPdf}
                data-testid="button-download-pdf"
              >
                {isDownloadingPdf ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                {isDownloadingPdf ? "Preparing PDF..." : "Download PDF"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = `/api/reports/${reportId}/download/docx`;
                  link.click();
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Word
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Meta */}
      <Card className="mb-6">
        <CardContent className="p-4 flex flex-wrap gap-6 text-sm text-slate-600">
          {report.generatedAt && (
            <span>Generated: {formatDateTimeDisplay(report.generatedAt)}</span>
          )}
          {report.editedAt && <span>Last edited: {formatDateTimeDisplay(report.editedAt)}</span>}
          {report.finalizedAt && (
            <span>Finalized: {formatDateTimeDisplay(report.finalizedAt)}</span>
          )}
        </CardContent>
      </Card>

      {/* Editor / Finalized view */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <span>{isFinalized ? "Finalized Report" : "Review & Edit Report"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isFinalized ? (
            <div
              className="prose max-w-none"
              data-testid="finalized-report-content"
              dangerouslySetInnerHTML={{
                __html: report.finalContent || report.draftContent || report.generatedContent || "",
              }}
            />
          ) : (
            <div className="space-y-4">
              <div className="bg-white" data-testid="report-editor">
                <ReactQuill
                  theme="snow"
                  value={editorContent}
                  onChange={setEditorContent}
                  modules={quillModules}
                  formats={quillFormats}
                />
              </div>
              <div className="flex items-center justify-end space-x-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => saveDraftMutation.mutate(editorContent)}
                  disabled={saveDraftMutation.isPending}
                  data-testid="button-save-draft"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveDraftMutation.isPending ? "Saving..." : "Save Draft"}
                </Button>
                <Button
                  onClick={handleSaveAndFinalize}
                  disabled={saveDraftMutation.isPending || finalizeReportMutation.isPending}
                  data-testid="button-finalize-report"
                >
                  <Lock className="w-4 h-4 mr-2" />
                  Save & Finalize
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Finalize confirmation */}
      <AlertDialog open={finalizeModalOpen} onOpenChange={setFinalizeModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize this report?</AlertDialogTitle>
            <AlertDialogDescription>
              Finalizing locks the report from further edits. You can reopen it later if you need to
              make changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => finalizeReportMutation.mutate()}
              disabled={finalizeReportMutation.isPending}
            >
              {finalizeReportMutation.isPending ? "Finalizing..." : "Finalize"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
