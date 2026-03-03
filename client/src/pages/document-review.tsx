import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ClipboardCheck, Clock, AlertTriangle, CheckCircle, X, Eye, Download,
  FileText, RefreshCw, ExternalLink, User
} from "lucide-react";

interface PendingDocument {
  id: number;
  fileName: string;
  originalName: string;
  fileSize: number;
  category: string;
  reviewStatus: string;
  requiresTherapistReview: boolean;
  requiresSupervisorReview: boolean;
  createdAt: string;
  clientId: number;
  clientFirstName: string;
  clientLastName: string;
  uploadedByName: string | null;
  waitingHours: number;
  isOverdue: boolean;
}

function WaitingBadge({ hours, isOverdue }: { hours: number; isOverdue: boolean }) {
  const text = hours < 1 ? "< 1 hr" : hours < 24 ? `${hours} hr${hours !== 1 ? 's' : ''}` : `${Math.floor(hours / 24)} day${Math.floor(hours / 24) !== 1 ? 's' : ''}`;
  if (isOverdue) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
      <AlertTriangle className="w-3 h-3" /> {text}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
      <Clock className="w-3 h-3" /> {text}
    </span>
  );
}

function ReviewTypeBadge({ therapist, supervisor }: { therapist: boolean; supervisor: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {therapist && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Therapist</span>}
      {supervisor && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">Supervisor</span>}
    </div>
  );
}

export default function DocumentReviewPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [reviewDoc, setReviewDoc] = useState<PendingDocument | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const { data: pendingDocs = [], isLoading, refetch } = useQuery<PendingDocument[]>({
    queryKey: ["/api/documents/pending-review"],
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60000,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ docId, clientId, action, notes }: { docId: number; clientId: number; action: 'reviewed' | 'rejected'; notes: string }) => {
      const response = await apiRequest(`/api/clients/${clientId}/documents/${docId}/review`, "PATCH", { action, reviewNotes: notes, reviewChecklist: {} });
      return await response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents/pending-review"] });
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${variables.clientId}/documents`] });
      toast({ title: "Document updated", description: `Document has been marked as ${variables.action}.` });
      setReviewDoc(null);
      setReviewNotes("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update document review status.", variant: "destructive" });
    },
  });

  const overdueCount = pendingDocs.filter(d => d.isOverdue).length;
  const therapistCount = pendingDocs.filter(d => d.requiresTherapistReview).length;
  const supervisorCount = pendingDocs.filter(d => d.requiresSupervisorReview).length;

  const filterDocs = (tab: string) => {
    if (tab === "overdue") return pendingDocs.filter(d => d.isOverdue);
    if (tab === "therapist") return pendingDocs.filter(d => d.requiresTherapistReview);
    if (tab === "supervisor") return pendingDocs.filter(d => d.requiresSupervisorReview);
    return pendingDocs;
  };

  const filtered = filterDocs(activeTab);

  const renderRow = (doc: PendingDocument) => (
    <div key={doc.id} className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 border rounded-lg ${doc.isOverdue ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'} hover:shadow-sm transition-shadow`}>
      {/* File icon + name */}
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${doc.isOverdue ? 'bg-red-100' : 'bg-slate-100'}`}>
          <FileText className={`w-4 h-4 ${doc.isOverdue ? 'text-red-600' : 'text-slate-500'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900 text-sm truncate" title={doc.originalName}>{doc.originalName}</p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <span className="text-xs text-slate-500 capitalize">{doc.category}</span>
            {doc.fileSize && <span className="text-xs text-slate-400">{Math.round(doc.fileSize / 1024)} KB</span>}
            <ReviewTypeBadge therapist={doc.requiresTherapistReview} supervisor={doc.requiresSupervisorReview} />
          </div>
        </div>
      </div>

      {/* Client link */}
      <div className="flex-shrink-0 w-40">
        <Link href={`/clients/${doc.clientId}?tab=documents`}>
          <span className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium">
            <User className="w-3.5 h-3.5" />
            {doc.clientFirstName} {doc.clientLastName}
            <ExternalLink className="w-3 h-3" />
          </span>
        </Link>
        {doc.uploadedByName && (
          <p className="text-xs text-slate-400 mt-0.5">by {doc.uploadedByName}</p>
        )}
      </div>

      {/* Waiting time */}
      <div className="flex-shrink-0 w-24">
        <WaitingBadge hours={doc.waitingHours} isOverdue={doc.isOverdue} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 px-2"
          onClick={() => window.open(`/api/clients/${doc.clientId}/documents/${doc.id}/download`, '_blank')}
          title="Download document"
        >
          <Download className="w-3 h-3" />
        </Button>
        <Button
          size="sm"
          className="text-xs h-7 bg-amber-600 hover:bg-amber-700"
          onClick={() => { setReviewDoc(doc); setReviewNotes(""); }}
        >
          <ClipboardCheck className="w-3 h-3 mr-1" />
          Review
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-amber-600" />
            Document Review
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            All documents awaiting review across your clients
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <p className="text-xs text-amber-600 font-medium uppercase tracking-wide">Total Pending</p>
            <p className="text-3xl font-bold text-amber-700 mt-1">{pendingDocs.length}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-xs text-red-600 font-medium uppercase tracking-wide">Overdue (&gt;24h)</p>
            <p className="text-3xl font-bold text-red-700 mt-1">{overdueCount}</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Therapist Review</p>
            <p className="text-3xl font-bold text-blue-700 mt-1">{therapistCount}</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="p-4">
            <p className="text-xs text-purple-600 font-medium uppercase tracking-wide">Supervisor Review</p>
            <p className="text-3xl font-bold text-purple-700 mt-1">{supervisorCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Document list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pending Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="all">All ({pendingDocs.length})</TabsTrigger>
              <TabsTrigger value="overdue" className="data-[state=active]:bg-red-600 data-[state=active]:text-white">
                Overdue ({overdueCount})
              </TabsTrigger>
              <TabsTrigger value="therapist">Therapist ({therapistCount})</TabsTrigger>
              <TabsTrigger value="supervisor">Supervisor ({supervisorCount})</TabsTrigger>
            </TabsList>

            {["all", "overdue", "therapist", "supervisor"].map(tab => (
              <TabsContent key={tab} value={tab}>
                {isLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-600 mx-auto mb-3" />
                      <p className="text-slate-500 text-sm">Loading pending documents...</p>
                    </div>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-16">
                    <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                    <p className="text-slate-700 font-medium">All clear!</p>
                    <p className="text-slate-500 text-sm mt-1">No documents pending review in this category.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filtered.map(renderRow)}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!reviewDoc} onOpenChange={(open) => { if (!open) { setReviewDoc(null); setReviewNotes(""); } }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-amber-600" />
              Review Document
            </DialogTitle>
            <DialogDescription>
              Review the document then approve or reject it.
            </DialogDescription>
          </DialogHeader>

          {reviewDoc && (
            <div className="space-y-4">
              {/* Document info */}
              <div className="bg-slate-50 border rounded-lg p-3 space-y-1">
                <p className="font-semibold text-slate-900 text-sm">{reviewDoc.originalName}</p>
                <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>Category: <span className="font-medium text-slate-700 capitalize">{reviewDoc.category}</span></span>
                  <span>Size: <span className="font-medium text-slate-700">{Math.round(reviewDoc.fileSize / 1024)} KB</span></span>
                  <span>Waiting: <span className={`font-medium ${reviewDoc.isOverdue ? 'text-red-600' : 'text-slate-700'}`}>{reviewDoc.waitingHours}h</span></span>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                  <User className="w-3 h-3" />
                  Client:
                  <Link href={`/clients/${reviewDoc.clientId}?tab=documents`}>
                    <span className="text-blue-600 hover:underline font-medium cursor-pointer ml-1">
                      {reviewDoc.clientFirstName} {reviewDoc.clientLastName}
                    </span>
                  </Link>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => window.open(`/api/clients/${reviewDoc.clientId}/documents/${reviewDoc.id}/download`, '_blank')}
                  >
                    <Download className="w-3 h-3 mr-1" /> Download
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => window.open(`/api/clients/${reviewDoc.clientId}/documents/${reviewDoc.id}/preview`, '_blank')}
                  >
                    <Eye className="w-3 h-3 mr-1" /> Preview
                  </Button>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <Label className="text-sm font-medium">Notes <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Textarea
                  placeholder="Add any notes about this review..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setReviewDoc(null); setReviewNotes(""); }}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewDoc && reviewMutation.mutate({ docId: reviewDoc.id, clientId: reviewDoc.clientId, action: 'rejected', notes: reviewNotes })}
                >
                  <X className="w-4 h-4 mr-1" /> Reject
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewDoc && reviewMutation.mutate({ docId: reviewDoc.id, clientId: reviewDoc.clientId, action: 'reviewed', notes: reviewNotes })}
                >
                  {reviewMutation.isPending ? "Saving..." : <><CheckCircle className="w-4 h-4 mr-1" /> Approve</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
