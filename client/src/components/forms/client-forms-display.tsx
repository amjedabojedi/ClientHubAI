import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FileText, Clock, CheckCircle2, AlertCircle, Eye, Download, X } from "lucide-react";
import { formatDateDisplay } from "@/lib/datetime";
import { sanitizeHtml } from "@/lib/sanitize";

interface FormField {
  id: number;
  templateId: number;
  fieldType: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  options?: string;
  sortOrder: number;
}

interface FormTemplate {
  id: number;
  name: string;
  category: string;
  description?: string;
  fields?: FormField[];
}

interface FormAssignment {
  id: number;
  templateId: number;
  clientId: number;
  status: string;
  assignedAt: Date;
  completedAt?: Date;
  reviewedAt?: Date;
  template?: FormTemplate;
}

interface ClientFormsDisplayProps {
  clientId: number;
}

export function ClientFormsDisplay({ clientId }: ClientFormsDisplayProps) {
  const { toast } = useToast();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [previewAssignmentId, setPreviewAssignmentId] = useState<number | null>(null);

  const { data: templates = [], isLoading: templatesLoading } = useQuery<FormTemplate[]>({
    queryKey: ["/api/forms/templates"],
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<FormAssignment[]>({
    queryKey: ["/api/forms/assignments/client", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/forms/assignments/client/${clientId}`);
      if (!res.ok) throw new Error("Failed to fetch form assignments");
      return res.json();
    },
  });

  const { data: previewData, isLoading: previewLoading } = useQuery<FormTemplate>({
    queryKey: ["/api/forms/templates", previewAssignmentId],
    queryFn: async () => {
      const assignment = assignments.find(a => a.id === previewAssignmentId);
      if (!assignment) throw new Error("Assignment not found");
      const res = await fetch(`/api/forms/templates/${assignment.templateId}`);
      if (!res.ok) throw new Error("Failed to fetch form template");
      return res.json();
    },
    enabled: !!previewAssignmentId,
  });

  const assignFormMutation = useMutation({
    mutationFn: async (templateId: number) => {
      return await apiRequest("/api/forms/assignments", "POST", {
        templateId,
        clientId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms/assignments/client", clientId] });
      setSelectedTemplateId("");
      toast({
        title: "Success",
        description: "Form assigned successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to assign form",
        variant: "destructive",
      });
    },
  });

  const handleAssignForm = () => {
    if (!selectedTemplateId) {
      toast({
        title: "No form selected",
        description: "Please select a form template to assign",
        variant: "destructive",
      });
      return;
    }
    assignFormMutation.mutate(parseInt(selectedTemplateId));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="bg-gray-100 text-gray-800">Pending</Badge>;
      case "in_progress":
        return <Badge variant="default" className="bg-blue-100 text-blue-800">In Progress</Badge>;
      case "completed":
        return <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>;
      case "reviewed":
        return <Badge variant="default" className="bg-purple-100 text-purple-800">Reviewed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Clock className="w-4 h-4 text-gray-500" />;
      case "in_progress":
        return <AlertCircle className="w-4 h-4 text-blue-500" />;
      case "completed":
      case "reviewed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      default:
        return <FileText className="w-4 h-4 text-gray-500" />;
    }
  };

  if (templatesLoading || assignmentsLoading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Loading forms...</p>
      </div>
    );
  }

  const activeTemplates = templates.filter((t: any) => t.isActive && !t.isDeleted);

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium text-slate-700 mb-2 block">
            Assign Form Template
          </label>
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger data-testid="select-form-template">
              <SelectValue placeholder="Select a form template to assign..." />
            </SelectTrigger>
            <SelectContent>
              {activeTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id.toString()}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleAssignForm}
          disabled={!selectedTemplateId || assignFormMutation.isPending}
          data-testid="button-assign-form"
        >
          {assignFormMutation.isPending ? "Assigning..." : "Assign Form"}
        </Button>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Assigned Forms</h3>
        {assignments.length > 0 ? (
          <div className="space-y-3">
            {assignments.map((assignment) => (
              <Card key={assignment.id} data-testid={`card-assignment-${assignment.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      {getStatusIcon(assignment.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-slate-900 truncate">
                            {assignment.template?.name || "Unknown Form"}
                          </h4>
                          {getStatusBadge(assignment.status)}
                        </div>
                        <p className="text-sm text-slate-600">
                          Assigned {formatDateDisplay(assignment.assignedAt)}
                          {assignment.completedAt && (
                            <> • Completed {formatDateDisplay(assignment.completedAt)}</>
                          )}
                          {assignment.reviewedAt && (
                            <> • Reviewed {formatDateDisplay(assignment.reviewedAt)}</>
                          )}
                        </p>
                        {assignment.template?.description && (
                          <p className="text-sm text-slate-500 mt-1">
                            {assignment.template.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {assignment.status === 'completed' && (
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`button-download-pdf-${assignment.id}`}
                          onClick={() => {
                            window.open(`/api/forms/assignments/${assignment.id}/download/pdf`, '_blank');
                          }}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download PDF
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`button-view-${assignment.id}`}
                        onClick={() => setPreviewAssignmentId(assignment.id)}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No forms assigned yet</p>
            <p className="text-slate-400 text-sm">Use the dropdown above to assign a form template</p>
          </div>
        )}
      </div>

      <Dialog open={!!previewAssignmentId} onOpenChange={() => setPreviewAssignmentId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewData?.name || "Form Preview"}</DialogTitle>
            <DialogDescription>
              {previewData?.description || "Preview of assigned form template"}
            </DialogDescription>
          </DialogHeader>
          
          {previewLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="space-y-6 py-4">
              {previewData?.fields && previewData.fields.length > 0 ? (
                previewData.fields
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((field) => (
                    <div key={field.id} className="space-y-2">
                      {field.fieldType === "heading" ? (
                        <h2 className="text-2xl font-bold text-slate-900 mt-6 mb-2">
                          {field.label}
                        </h2>
                      ) : field.fieldType === "info_text" ? (
                        <div className="bg-slate-50 p-4 rounded-md border border-slate-200">
                          {field.label && (
                            <h3 className="font-semibold text-slate-900 mb-2">{field.label}</h3>
                          )}
                          <div 
                            className="text-sm text-slate-700 prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(field.helpText || "") }}
                          />
                        </div>
                      ) : (
                        <>
                          <label className="text-sm font-medium text-slate-700">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          
                          {field.helpText && field.fieldType !== "fill_in_blank" && (
                            <p className="text-sm text-slate-500">{field.helpText}</p>
                          )}

                          {field.fieldType === "fill_in_blank" && field.helpText && (
                            <div className="bg-slate-50 p-3 rounded-md border border-slate-200 text-sm text-slate-700">
                              {field.helpText}
                            </div>
                          )}

                          {(field.fieldType === "select" || field.fieldType === "radio" || field.fieldType === "checkbox_group") && field.options && (
                            <div className="text-sm text-slate-600 space-y-1">
                              {(() => {
                                try {
                                  const opts = JSON.parse(field.options);
                                  return opts.map((opt: string, idx: number) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <span className="w-4 h-4 border border-slate-300 rounded"></span>
                                      {opt}
                                    </div>
                                  ));
                                } catch {
                                  return <div className="text-slate-400">Options: {field.options}</div>;
                                }
                              })()}
                            </div>
                          )}

                          {field.fieldType === "signature" && (
                            <div className="border-2 border-dashed border-slate-300 rounded-md h-32 flex items-center justify-center text-slate-400">
                              Signature field
                            </div>
                          )}

                          {field.fieldType === "file" && (
                            <div className="border-2 border-dashed border-slate-300 rounded-md h-24 flex items-center justify-center text-slate-400">
                              File upload field
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))
              ) : (
                <div className="text-center py-8 text-slate-500">
                  No fields found in this form template
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
