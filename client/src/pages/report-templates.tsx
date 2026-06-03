import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReportTemplate } from "@shared/schema";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

// Icons
import { FileText, Upload, Trash2, Plus, FileType, Pencil } from "lucide-react";

// Utils
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDateDisplay } from "@/lib/datetime";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReportTemplatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [includeProfile, setIncludeProfile] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeAssessments, setIncludeAssessments] = useState(true);
  const [supportingFilesGuidance, setSupportingFilesGuidance] = useState("");
  const [supportingFilesExpected, setSupportingFilesExpected] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReportTemplate | null>(null);

  const [editTarget, setEditTarget] = useState<ReportTemplate | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAiInstructions, setEditAiInstructions] = useState("");
  const [editIncludeProfile, setEditIncludeProfile] = useState(true);
  const [editIncludeNotes, setEditIncludeNotes] = useState(true);
  const [editIncludeAssessments, setEditIncludeAssessments] = useState(true);
  const [editSupportingFilesGuidance, setEditSupportingFilesGuidance] = useState("");
  const [editSupportingFilesExpected, setEditSupportingFilesExpected] = useState(false);

  const openEdit = (template: ReportTemplate) => {
    setEditTarget(template);
    setEditName(template.name);
    setEditDescription(template.description || "");
    setEditAiInstructions(template.aiInstructions || "");
    setEditIncludeProfile(template.defaultIncludeProfile ?? true);
    setEditIncludeNotes(template.defaultIncludeNotes ?? true);
    setEditIncludeAssessments(template.defaultIncludeAssessments ?? true);
    setEditSupportingFilesGuidance(template.supportingFilesGuidance || "");
    setEditSupportingFilesExpected(template.supportingFilesExpected ?? false);
  };

  const { data: templates = [], isLoading } = useQuery<ReportTemplate[]>({
    queryKey: ["/api/report-templates", { includeInactive: true }],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setAiInstructions("");
    setSelectedFile(null);
    setIncludeProfile(true);
    setIncludeNotes(true);
    setIncludeAssessments(true);
    setSupportingFilesGuidance("");
    setSupportingFilesExpected(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("Please choose a Word or PDF file.");
      const fileContent = await readFileAsBase64(selectedFile);
      return apiRequest("/api/report-templates", "POST", {
        name,
        description: description || null,
        aiInstructions: aiInstructions || null,
        fileContent,
        originalName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
        defaultIncludeProfile: includeProfile,
        defaultIncludeNotes: includeNotes,
        defaultIncludeAssessments: includeAssessments,
        supportingFilesGuidance: supportingFilesGuidance.trim() || null,
        supportingFilesExpected,
      });
    },
    onSuccess: () => {
      toast({ title: "Template uploaded", description: "The report template is ready to use." });
      queryClient.invalidateQueries({ queryKey: ["/api/report-templates"] });
      setUploadOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload template. Please try again.",
        variant: "destructive",
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      return apiRequest(`/api/report-templates/${id}`, "PATCH", { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-templates"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update template.",
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editTarget) throw new Error("No template selected.");
      if (!editName.trim()) throw new Error("Template name is required.");
      return apiRequest(`/api/report-templates/${editTarget.id}`, "PATCH", {
        name: editName.trim(),
        description: editDescription.trim() || null,
        aiInstructions: editAiInstructions.trim() || null,
        defaultIncludeProfile: editIncludeProfile,
        defaultIncludeNotes: editIncludeNotes,
        defaultIncludeAssessments: editIncludeAssessments,
        supportingFilesGuidance: editSupportingFilesGuidance.trim() || null,
        supportingFilesExpected: editSupportingFilesExpected,
      });
    },
    onSuccess: () => {
      toast({ title: "Template updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/report-templates"] });
      setEditTarget(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update template.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/report-templates/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({ title: "Template deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/report-templates"] });
      setDeleteTarget(null);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete template.",
        variant: "destructive",
      });
      setDeleteTarget(null);
    },
  });

  const canSubmit = name.trim().length > 0 && !!selectedFile && !uploadMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Report Templates
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Upload Word or PDF report templates. The AI mimics each template's layout and headings
            when generating a client report.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-template">
          <Plus className="w-4 h-4 mr-2" />
          Upload Template
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-1">No templates yet</h3>
            <p className="text-sm text-slate-600 mb-4">
              Upload your first Word or PDF report template to get started.
            </p>
            <Button onClick={() => setUploadOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Upload Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <Card key={template.id} data-testid={`template-card-${template.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileType className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="truncate">{template.name}</span>
                  </CardTitle>
                  {template.isActive ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {template.description && (
                  <p className="text-sm text-slate-600 line-clamp-2">{template.description}</p>
                )}
                <div className="text-xs text-slate-500 space-y-1">
                  <div className="truncate">File: {template.originalName}</div>
                  <div>Size: {formatFileSize(template.fileSize)}</div>
                  <div>Added: {formatDateDisplay(template.createdAt)}</div>
                </div>
                {template.aiInstructions && (
                  <div className="text-xs bg-slate-50 rounded p-2 text-slate-600 line-clamp-3">
                    <span className="font-medium">AI guidance:</span> {template.aiInstructions}
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={template.isActive}
                      onCheckedChange={(checked) =>
                        toggleActiveMutation.mutate({ id: template.id, isActive: checked })
                      }
                      data-testid={`switch-active-${template.id}`}
                    />
                    <span className="text-xs text-slate-500">
                      {template.isActive ? "Available" : "Hidden"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                      onClick={() => openEdit(template)}
                      data-testid={`button-edit-${template.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setDeleteTarget(template)}
                      data-testid={`button-delete-${template.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Report Template</DialogTitle>
            <DialogDescription>
              Supported formats: Word (.docx) and PDF (.pdf). Max 15MB.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name *</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Initial Clinical Assessment Report"
                data-testid="input-template-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-description">Description</Label>
              <Textarea
                id="template-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes about when to use this template"
                rows={2}
                data-testid="input-template-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-ai">AI Instructions</Label>
              <Textarea
                id="template-ai"
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                placeholder="Optional guidance for the AI, e.g. tone, sections to emphasize"
                rows={3}
                data-testid="input-template-ai"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-file">Template File *</Label>
              <Input
                id="template-file"
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                data-testid="input-template-file"
              />
              {selectedFile && (
                <p className="text-xs text-slate-500">
                  {selectedFile.name} ({formatFileSize(selectedFile.size)})
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div>
                <Label className="text-sm font-medium">Default data to include</Label>
                <p className="text-xs text-slate-500">
                  Therapists can turn these on or off each time they generate a report.
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Client profile</span>
                <Switch
                  checked={includeProfile}
                  onCheckedChange={setIncludeProfile}
                  data-testid="switch-default-profile"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Sessions &amp; session notes</span>
                <Switch
                  checked={includeNotes}
                  onCheckedChange={setIncludeNotes}
                  data-testid="switch-default-notes"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Assessments</span>
                <Switch
                  checked={includeAssessments}
                  onCheckedChange={setIncludeAssessments}
                  data-testid="switch-default-assessments"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-supporting-guidance">Supporting files note</Label>
              <Textarea
                id="template-supporting-guidance"
                value={supportingFilesGuidance}
                onChange={(e) => setSupportingFilesGuidance(e.target.value)}
                placeholder="Optional note shown to therapists, e.g. which extra documents to attach for this template"
                rows={2}
                data-testid="input-template-supporting-guidance"
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Remind therapists to attach supporting files</span>
                <Switch
                  checked={supportingFilesExpected}
                  onCheckedChange={setSupportingFilesExpected}
                  data-testid="switch-supporting-expected"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!canSubmit}
              data-testid="button-submit-template"
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploadMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Report Template</DialogTitle>
            <DialogDescription>
              Update the template's name, description, and AI instructions. To change the
              uploaded file, delete this template and upload a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-template-name">Template Name *</Label>
              <Input
                id="edit-template-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. Initial Clinical Assessment Report"
                data-testid="input-edit-template-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-template-description">Description</Label>
              <Textarea
                id="edit-template-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional notes about when to use this template"
                rows={2}
                data-testid="input-edit-template-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-template-ai">AI Instructions</Label>
              <Textarea
                id="edit-template-ai"
                value={editAiInstructions}
                onChange={(e) => setEditAiInstructions(e.target.value)}
                placeholder="Optional guidance for the AI, e.g. tone, sections to emphasize"
                rows={3}
                data-testid="input-edit-template-ai"
              />
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div>
                <Label className="text-sm font-medium">Default data to include</Label>
                <p className="text-xs text-slate-500">
                  Therapists can turn these on or off each time they generate a report.
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Client profile</span>
                <Switch
                  checked={editIncludeProfile}
                  onCheckedChange={setEditIncludeProfile}
                  data-testid="switch-edit-default-profile"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Sessions &amp; session notes</span>
                <Switch
                  checked={editIncludeNotes}
                  onCheckedChange={setEditIncludeNotes}
                  data-testid="switch-edit-default-notes"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Assessments</span>
                <Switch
                  checked={editIncludeAssessments}
                  onCheckedChange={setEditIncludeAssessments}
                  data-testid="switch-edit-default-assessments"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-template-supporting-guidance">Supporting files note</Label>
              <Textarea
                id="edit-template-supporting-guidance"
                value={editSupportingFilesGuidance}
                onChange={(e) => setEditSupportingFilesGuidance(e.target.value)}
                placeholder="Optional note shown to therapists, e.g. which extra documents to attach for this template"
                rows={2}
                data-testid="input-edit-template-supporting-guidance"
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Remind therapists to attach supporting files</span>
                <Switch
                  checked={editSupportingFilesExpected}
                  onCheckedChange={setEditSupportingFilesExpected}
                  data-testid="switch-edit-supporting-expected"
                />
              </div>
            </div>

            <div className="text-xs text-slate-500">
              File: {editTarget?.originalName}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => editMutation.mutate()}
              disabled={!editName.trim() || editMutation.isPending}
              data-testid="button-save-template"
            >
              {editMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteTarget?.name}". Reports already generated from it
              are kept. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
