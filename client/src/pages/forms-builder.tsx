import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Plus, Trash2, GripVertical, Eye, Edit2, MoveUp, MoveDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface FormField {
  id: number;
  templateId: number;
  fieldType: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  isRequired: boolean;
  options?: string;
  sortOrder: number;
}

interface FormTemplate {
  id: number;
  name: string;
  description?: string;
  category: string;
  fields: FormField[];
}

const FIELD_TYPES = [
  { value: "heading", label: "Heading (Read-Only)" },
  { value: "info_text", label: "Information Text (Read-Only)" },
  { value: "text", label: "Short Text" },
  { value: "textarea", label: "Long Text" },
  { value: "select", label: "Dropdown" },
  { value: "radio", label: "Radio Buttons" },
  { value: "checkbox", label: "Single Checkbox" },
  { value: "checkbox_group", label: "Multiple Checkboxes" },
  { value: "date", label: "Date" },
  { value: "signature", label: "Signature" },
  { value: "file", label: "File Upload" },
];

export default function FormsBuilder() {
  const { templateId } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isAddFieldOpen, setIsAddFieldOpen] = useState(false);
  const [isEditFieldOpen, setIsEditFieldOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [editingField, setEditingField] = useState<FormField | null>(null);
  const [fieldData, setFieldData] = useState({
    fieldType: "text",
    label: "",
    placeholder: "",
    helpText: "",
    isRequired: false,
    options: "",
  });

  const { data: template, isLoading } = useQuery<FormTemplate>({
    queryKey: ["/api/forms/templates", templateId],
    queryFn: async () => {
      const res = await fetch(`/api/forms/templates/${templateId}`);
      if (!res.ok) throw new Error("Failed to fetch template");
      return res.json();
    },
  });

  const createFieldMutation = useMutation({
    mutationFn: async (data: typeof fieldData) => {
      const sortOrder = template?.fields?.length || 0;
      return await apiRequest("/api/forms/fields", "POST", {
        ...data,
        templateId: parseInt(templateId!),
        sortOrder,
        options: data.options ? data.options : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms/templates", templateId] });
      setIsAddFieldOpen(false);
      setFieldData({
        fieldType: "text",
        label: "",
        placeholder: "",
        helpText: "",
        isRequired: false,
        options: "",
      });
      toast({ title: "Success", description: "Field added successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add field",
        variant: "destructive",
      });
    },
  });

  const updateFieldMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<typeof fieldData> }) => {
      return await apiRequest(`/api/forms/fields/${data.id}`, "PATCH", {
        ...data.updates,
        options: data.updates.options || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms/templates", templateId] });
      setIsEditFieldOpen(false);
      setEditingField(null);
      toast({ title: "Success", description: "Field updated successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update field",
        variant: "destructive",
      });
    },
  });

  const deleteFieldMutation = useMutation({
    mutationFn: async (fieldId: number) => {
      return await apiRequest(`/api/forms/fields/${fieldId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms/templates", templateId] });
      toast({ title: "Success", description: "Field deleted successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete field",
        variant: "destructive",
      });
    },
  });

  const reorderFieldMutation = useMutation({
    mutationFn: async ({ fieldId, newSortOrder }: { fieldId: number; newSortOrder: number }) => {
      return await apiRequest(`/api/forms/fields/${fieldId}`, "PATCH", { sortOrder: newSortOrder });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms/templates", templateId] });
    },
  });

  const handleSubmitField = () => {
    if (!fieldData.label) {
      toast({
        title: "Validation Error",
        description: "Field label is required",
        variant: "destructive",
      });
      return;
    }

    const needsOptions = ["select", "radio", "checkbox_group"].includes(fieldData.fieldType);
    if (needsOptions && !fieldData.options) {
      toast({
        title: "Validation Error",
        description: "Options are required for this field type",
        variant: "destructive",
      });
      return;
    }

    createFieldMutation.mutate(fieldData);
  };

  const handleEditField = (field: FormField) => {
    setEditingField(field);
    setFieldData({
      fieldType: field.fieldType,
      label: field.label,
      placeholder: field.placeholder || "",
      helpText: field.helpText || "",
      isRequired: field.isRequired,
      options: field.options || "",
    });
    setIsEditFieldOpen(true);
  };

  const handleUpdateField = () => {
    if (!editingField) return;

    updateFieldMutation.mutate({
      id: editingField.id,
      updates: fieldData,
    });
  };

  const handleMoveField = (fieldId: number, direction: "up" | "down") => {
    if (!template?.fields) return;

    const currentIndex = template.fields.findIndex((f) => f.id === fieldId);
    if (currentIndex === -1) return;

    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= template.fields.length) return;

    const field1 = template.fields[currentIndex];
    const field2 = template.fields[newIndex];

    reorderFieldMutation.mutate({ fieldId: field1.id, newSortOrder: field2.sortOrder });
    reorderFieldMutation.mutate({ fieldId: field2.id, newSortOrder: field1.sortOrder });
  };

  const renderFieldPreview = (field: FormField) => {
    const needsOptions = ["select", "radio", "checkbox_group"].includes(field.fieldType);
    let options: string[] = [];
    if (needsOptions && field.options) {
      try {
        options = JSON.parse(field.options);
      } catch {
        options = field.options.split(",").map((o) => o.trim());
      }
    }

    switch (field.fieldType) {
      case "heading":
        return (
          <h2 className="text-2xl font-bold text-foreground mt-4 mb-2">
            {field.label}
          </h2>
        );
      case "info_text":
        return (
          <div className="bg-muted/30 p-4 rounded-md border border-muted">
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {field.helpText || "Information text will appear here..."}
            </p>
          </div>
        );
      case "text":
        return (
          <Input
            placeholder={field.placeholder}
            disabled
            className="bg-muted/50"
          />
        );
      case "textarea":
        return (
          <Textarea
            placeholder={field.placeholder}
            disabled
            className="bg-muted/50"
          />
        );
      case "select":
        return (
          <Select disabled>
            <SelectTrigger className="bg-muted/50">
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option, idx) => (
                <SelectItem key={idx} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "radio":
        return (
          <RadioGroup disabled>
            {options.map((option, idx) => (
              <div key={idx} className="flex items-center space-x-2">
                <RadioGroupItem value={option} disabled className="cursor-not-allowed" />
                <Label className="text-sm text-muted-foreground cursor-not-allowed">{option}</Label>
              </div>
            ))}
          </RadioGroup>
        );
      case "checkbox_group":
        return (
          <div className="space-y-2">
            {options.map((option, idx) => (
              <div key={idx} className="flex items-center space-x-2">
                <Checkbox disabled className="cursor-not-allowed" />
                <span className="text-sm text-muted-foreground">{option}</span>
              </div>
            ))}
          </div>
        );
      case "checkbox":
        return (
          <div className="flex items-center space-x-2">
            <Checkbox disabled className="cursor-not-allowed" />
            <span className="text-sm text-muted-foreground">{field.label}</span>
          </div>
        );
      case "date":
        return (
          <Input type="date" disabled className="bg-muted/50" />
        );
      case "signature":
        return (
          <div className="border-2 border-dashed border-muted rounded-md h-32 flex items-center justify-center bg-muted/20">
            <span className="text-sm text-muted-foreground">Signature Area</span>
          </div>
        );
      case "file":
        return (
          <div className="border-2 border-dashed border-muted rounded-md h-24 flex items-center justify-center bg-muted/20">
            <span className="text-sm text-muted-foreground">File Upload Area</span>
          </div>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div>Loading...</div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="container mx-auto p-6">
        <div>Template not found</div>
      </div>
    );
  }

  const needsOptions = ["select", "radio", "checkbox_group"].includes(fieldData.fieldType);

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/forms-management")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{template.name}</h1>
            <p className="text-sm text-muted-foreground">{template.description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setIsPreviewOpen(true)}
            data-testid="button-preview"
          >
            <Eye className="h-4 w-4 mr-2" />
            Preview Form
          </Button>
          <Button
            onClick={() => setIsAddFieldOpen(true)}
            data-testid="button-add-field"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Field
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {template.fields && template.fields.length > 0 ? (
          template.fields.map((field, index) => (
            <Card key={field.id} data-testid={`card-field-${field.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <GripVertical className="h-5 w-5 text-muted-foreground mt-1 cursor-grab" />
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        {field.label}
                        {field.isRequired && (
                          <Badge variant="destructive" className="text-xs">Required</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {FIELD_TYPES.find((t) => t.value === field.fieldType)?.label}
                        {field.helpText && ` • ${field.helpText}`}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleMoveField(field.id, "up")}
                      disabled={index === 0}
                      data-testid={`button-move-up-${field.id}`}
                    >
                      <MoveUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleMoveField(field.id, "down")}
                      disabled={index === template.fields.length - 1}
                      data-testid={`button-move-down-${field.id}`}
                    >
                      <MoveDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditField(field)}
                      data-testid={`button-edit-${field.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteFieldMutation.mutate(field.id)}
                      data-testid={`button-delete-${field.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No fields yet. Click "Add Field" to get started.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isAddFieldOpen} onOpenChange={setIsAddFieldOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Form Field</DialogTitle>
            <DialogDescription>
              Configure a new field for this form template
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="fieldType">Field Type</Label>
              <Select
                value={fieldData.fieldType}
                onValueChange={(value) =>
                  setFieldData({ ...fieldData, fieldType: value })
                }
              >
                <SelectTrigger id="fieldType" data-testid="select-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="label">
                {fieldData.fieldType === 'heading' ? 'Heading Text *' : 
                 fieldData.fieldType === 'info_text' ? 'Section Title (Optional)' : 
                 'Label *'}
              </Label>
              <Input
                id="label"
                data-testid="input-label"
                value={fieldData.label}
                onChange={(e) =>
                  setFieldData({ ...fieldData, label: e.target.value })
                }
                placeholder={
                  fieldData.fieldType === 'heading' ? 'e.g., INFORMED CONSENT FOR TREATMENT' :
                  fieldData.fieldType === 'info_text' ? 'e.g., Important Information' :
                  'Enter field label'
                }
              />
            </div>

            {!['heading', 'info_text', 'signature', 'file'].includes(fieldData.fieldType) && (
              <div className="grid gap-2">
                <Label htmlFor="placeholder">Placeholder</Label>
                <Input
                  id="placeholder"
                  data-testid="input-placeholder"
                  value={fieldData.placeholder}
                  onChange={(e) =>
                    setFieldData({ ...fieldData, placeholder: e.target.value })
                  }
                  placeholder="Enter placeholder text"
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="helpText">
                {fieldData.fieldType === 'info_text' ? 'Content Text *' : 'Help Text'}
              </Label>
              <Textarea
                id="helpText"
                data-testid="input-help-text"
                value={fieldData.helpText}
                onChange={(e) =>
                  setFieldData({ ...fieldData, helpText: e.target.value })
                }
                placeholder={
                  fieldData.fieldType === 'info_text' 
                    ? 'Enter the full text that clients will read (e.g., consent language, disclaimers, instructions)'
                    : 'Optional help text for users'
                }
                rows={fieldData.fieldType === 'info_text' ? 8 : 3}
              />
              {fieldData.fieldType === 'info_text' && (
                <p className="text-xs text-muted-foreground">
                  This text will be displayed to clients as read-only information
                </p>
              )}
            </div>

            {needsOptions && (
              <div className="grid gap-2">
                <Label htmlFor="options">
                  Options *
                  <span className="text-xs text-muted-foreground ml-2">
                    (comma-separated or JSON array)
                  </span>
                </Label>
                <Textarea
                  id="options"
                  data-testid="input-options"
                  value={fieldData.options}
                  onChange={(e) =>
                    setFieldData({ ...fieldData, options: e.target.value })
                  }
                  placeholder='Option 1, Option 2, Option 3 or ["Option 1", "Option 2"]'
                />
              </div>
            )}

            {!['heading', 'info_text'].includes(fieldData.fieldType) && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isRequired"
                  data-testid="checkbox-required"
                  checked={fieldData.isRequired}
                  onCheckedChange={(checked) =>
                    setFieldData({ ...fieldData, isRequired: checked as boolean })
                  }
                />
                <Label htmlFor="isRequired" className="cursor-pointer">
                  Required field
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddFieldOpen(false)}
              data-testid="button-cancel-add"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitField}
              disabled={createFieldMutation.isPending}
              data-testid="button-save-field"
            >
              {createFieldMutation.isPending ? "Adding..." : "Add Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditFieldOpen} onOpenChange={setIsEditFieldOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Form Field</DialogTitle>
            <DialogDescription>
              Update field configuration
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-fieldType">Field Type</Label>
              <Select
                value={fieldData.fieldType}
                onValueChange={(value) =>
                  setFieldData({ ...fieldData, fieldType: value })
                }
              >
                <SelectTrigger id="edit-fieldType" data-testid="select-edit-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-label">
                {fieldData.fieldType === 'heading' ? 'Heading Text *' : 
                 fieldData.fieldType === 'info_text' ? 'Section Title (Optional)' : 
                 'Label *'}
              </Label>
              <Input
                id="edit-label"
                data-testid="input-edit-label"
                value={fieldData.label}
                onChange={(e) =>
                  setFieldData({ ...fieldData, label: e.target.value })
                }
              />
            </div>

            {!['heading', 'info_text', 'signature', 'file'].includes(fieldData.fieldType) && (
              <div className="grid gap-2">
                <Label htmlFor="edit-placeholder">Placeholder</Label>
                <Input
                  id="edit-placeholder"
                  data-testid="input-edit-placeholder"
                  value={fieldData.placeholder}
                  onChange={(e) =>
                    setFieldData({ ...fieldData, placeholder: e.target.value })
                  }
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="edit-helpText">
                {fieldData.fieldType === 'info_text' ? 'Content Text *' : 'Help Text'}
              </Label>
              <Textarea
                id="edit-helpText"
                data-testid="input-edit-help-text"
                value={fieldData.helpText}
                onChange={(e) =>
                  setFieldData({ ...fieldData, helpText: e.target.value })
                }
                rows={fieldData.fieldType === 'info_text' ? 8 : 3}
              />
              {fieldData.fieldType === 'info_text' && (
                <p className="text-xs text-muted-foreground">
                  This text will be displayed to clients as read-only information
                </p>
              )}
            </div>

            {needsOptions && (
              <div className="grid gap-2">
                <Label htmlFor="edit-options">Options *</Label>
                <Textarea
                  id="edit-options"
                  data-testid="input-edit-options"
                  value={fieldData.options}
                  onChange={(e) =>
                    setFieldData({ ...fieldData, options: e.target.value })
                  }
                />
              </div>
            )}

            {!['heading', 'info_text'].includes(fieldData.fieldType) && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-isRequired"
                  data-testid="checkbox-edit-required"
                  checked={fieldData.isRequired}
                  onCheckedChange={(checked) =>
                    setFieldData({ ...fieldData, isRequired: checked as boolean })
                  }
                />
                <Label htmlFor="edit-isRequired" className="cursor-pointer">
                  Required field
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditFieldOpen(false)}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateField}
              disabled={updateFieldMutation.isPending}
              data-testid="button-update-field"
            >
              {updateFieldMutation.isPending ? "Updating..." : "Update Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{template.name}</DialogTitle>
            <DialogDescription>{template.description}</DialogDescription>
          </DialogHeader>
          <Separator className="my-4" />
          <div className="space-y-6">
            {template.fields && template.fields.length > 0 ? (
              template.fields.map((field) => (
                <div key={field.id} className="space-y-2">
                  <Label className="flex items-center gap-2">
                    {field.label}
                    {field.isRequired && <span className="text-destructive">*</span>}
                  </Label>
                  {field.helpText && (
                    <p className="text-sm text-muted-foreground">{field.helpText}</p>
                  )}
                  {renderFieldPreview(field)}
                </div>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No fields to preview
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setIsPreviewOpen(false)} data-testid="button-close-preview">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
