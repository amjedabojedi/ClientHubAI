import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Send, Clock, CheckCircle2, PenTool } from "lucide-react";
import { SignaturePad } from "@/components/forms/signature-pad";

function debounce<T extends (...args: any[]) => any>(func: T, wait: number) {
  let timeout: NodeJS.Timeout | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

interface FormField {
  id: number;
  templateId: number;
  fieldType: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  options?: string[];
  sortOrder: number;
}

interface FormTemplate {
  id: number;
  name: string;
  description?: string;
  category: string;
  fields: FormField[];
}

interface FormAssignment {
  id: number;
  templateId: number;
  clientId: number;
  status: string;
  assignedAt: Date;
  completedAt?: Date;
  template?: FormTemplate;
}

interface FormResponse {
  id: number;
  assignmentId: number;
  fieldId: number;
  value: string;
}

interface FormSignature {
  id: number;
  assignmentId: number;
  signatureDataUrl: string;
  signedAt: Date;
}

export default function PortalFormCompletion() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [formValues, setFormValues] = useState<Record<number, string>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [signature, setSignature] = useState<string>("");

  const { data: assignment, isLoading: assignmentLoading } = useQuery<FormAssignment>({
    queryKey: ["/api/portal/forms/assignments", id],
    queryFn: async () => {
      const res = await fetch(`/api/portal/forms/assignments/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch form assignment");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: responses = [] } = useQuery<FormResponse[]>({
    queryKey: ["/api/portal/forms/responses", id],
    queryFn: async () => {
      const res = await fetch(`/api/portal/forms/responses/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch responses");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: existingSignature } = useQuery<FormSignature>({
    queryKey: ["/api/portal/forms/signature", id],
    queryFn: async () => {
      const res = await fetch(`/api/portal/forms/signature/${id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch signature");
      }
      return res.json();
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (responses.length > 0) {
      const values: Record<number, string> = {};
      responses.forEach((response) => {
        values[response.fieldId] = response.value;
      });
      setFormValues(values);
    }
  }, [responses]);

  useEffect(() => {
    if (existingSignature?.signatureDataUrl) {
      setSignature(existingSignature.signatureDataUrl);
    }
  }, [existingSignature]);

  const saveResponseMutation = useMutation({
    mutationFn: async ({ fieldId, value }: { fieldId: number; value: string }) => {
      return await apiRequest("/api/portal/forms/responses", "POST", {
        assignmentId: parseInt(id!),
        fieldId,
        value,
      });
    },
    onSuccess: () => {
      setLastSaved(new Date());
      queryClient.invalidateQueries({ queryKey: ["/api/portal/forms/responses", id] });
    },
  });

  const debouncedSave = useCallback(
    debounce((fieldId: number, value: string) => {
      const isCompleted = assignment?.status === "completed" || assignment?.status === "reviewed";
      if (isCompleted) return;
      
      setIsSaving(true);
      saveResponseMutation.mutate(
        { fieldId, value },
        {
          onSettled: () => {
            setIsSaving(false);
          },
        }
      );
    }, 1000),
    [id, assignment]
  );

  const handleFieldChange = (fieldId: number, value: string) => {
    const isCompleted = assignment?.status === "completed" || assignment?.status === "reviewed";
    if (isCompleted) return;
    
    setFormValues((prev) => ({ ...prev, [fieldId]: value }));
    debouncedSave(fieldId, value);
  };

  const saveSignatureMutation = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      return await apiRequest("/api/portal/forms/signature", "POST", {
        assignmentId: parseInt(id!),
        signatureDataUrl,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/forms/signature", id] });
    },
  });

  const handleSignatureSave = (dataUrl: string) => {
    setSignature(dataUrl);
    saveSignatureMutation.mutate(dataUrl);
  };

  const submitFormMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/portal/forms/submit/${id}`, "POST", {});
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Form submitted successfully!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/forms/assignments"] });
      setLocation("/portal/forms");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit form. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    const fields = assignment?.template?.fields || [];
    // Exclude read-only fields (heading, info_text) and signature from required validation
    const inputFields = fields.filter((f) => !['signature', 'heading', 'info_text'].includes(f.fieldType));
    const requiredFields = inputFields.filter((f) => f.required);
    const missingFields = requiredFields.filter((f) => !formValues[f.id] || formValues[f.id].trim() === "");

    if (missingFields.length > 0) {
      toast({
        title: "Missing Required Fields",
        description: `Please fill out all required fields: ${missingFields.map((f) => f.label).join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    if (!signature) {
      toast({
        title: "Signature Required",
        description: "Please provide your signature before submitting the form",
        variant: "destructive",
      });
      return;
    }

    submitFormMutation.mutate();
  };

  const calculateProgress = () => {
    const fields = assignment?.template?.fields || [];
    // Exclude read-only fields (heading, info_text) and signature from progress calculation
    const inputFields = fields.filter((f) => !['signature', 'heading', 'info_text'].includes(f.fieldType));
    if (inputFields.length === 0) return 0;
    const filled = inputFields.filter((f) => formValues[f.id] && formValues[f.id].trim() !== "");
    return Math.round((filled.length / inputFields.length) * 100);
  };

  const renderField = (field: FormField, isCompleted: boolean) => {
    const value = formValues[field.id] || "";

    switch (field.fieldType) {
      case "heading":
        return (
          <div key={field.id} className="mt-6 mb-4">
            <h2 className="text-2xl font-bold text-foreground">
              {field.label}
            </h2>
          </div>
        );

      case "info_text":
        return (
          <div key={field.id} className="my-4">
            {field.label && (
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                {field.label}
              </h3>
            )}
            <div className="bg-muted/30 p-4 rounded-md border border-muted">
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {field.helpText || ""}
              </p>
            </div>
          </div>
        );

      case "text":
      case "email":
      case "phone":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={`field-${field.id}`}>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={`field-${field.id}`}
              type={field.fieldType === "email" ? "email" : field.fieldType === "phone" ? "tel" : "text"}
              placeholder={field.placeholder || ""}
              value={value}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              disabled={isCompleted}
              data-testid={`input-field-${field.id}`}
            />
          </div>
        );

      case "textarea":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={`field-${field.id}`}>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Textarea
              id={`field-${field.id}`}
              placeholder={field.placeholder || ""}
              value={value}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              rows={4}
              disabled={isCompleted}
              data-testid={`textarea-field-${field.id}`}
            />
          </div>
        );

      case "select":
      case "dropdown":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={`field-${field.id}`}>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Select value={value} onValueChange={(val) => handleFieldChange(field.id, val)} disabled={isCompleted}>
              <SelectTrigger id={`field-${field.id}`} data-testid={`select-field-${field.id}`}>
                <SelectValue placeholder={field.placeholder || "Select an option..."} />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((option, idx) => (
                  <SelectItem key={idx} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case "radio":
        return (
          <div key={field.id} className="space-y-2">
            <Label>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <RadioGroup value={value} onValueChange={(val) => handleFieldChange(field.id, val)} disabled={isCompleted}>
              {field.options?.map((option, idx) => (
                <div key={idx} className="flex items-center space-x-2">
                  <RadioGroupItem value={option} id={`field-${field.id}-${idx}`} disabled={isCompleted} data-testid={`radio-field-${field.id}-${idx}`} />
                  <Label htmlFor={`field-${field.id}-${idx}`} className={`font-normal ${!isCompleted && 'cursor-pointer'}`}>
                    {option}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        );

      case "checkbox":
        const checkboxValues = value ? value.split(",") : [];
        return (
          <div key={field.id} className="space-y-2">
            <Label>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <div className="space-y-2">
              {field.options?.map((option, idx) => (
                <div key={idx} className="flex items-center space-x-2">
                  <Checkbox
                    id={`field-${field.id}-${idx}`}
                    checked={checkboxValues.includes(option)}
                    onCheckedChange={(checked) => {
                      let newValues;
                      if (checked) {
                        newValues = [...checkboxValues, option];
                      } else {
                        newValues = checkboxValues.filter((v) => v !== option);
                      }
                      handleFieldChange(field.id, newValues.join(","));
                    }}
                    disabled={isCompleted}
                    data-testid={`checkbox-field-${field.id}-${idx}`}
                  />
                  <Label htmlFor={`field-${field.id}-${idx}`} className={`font-normal ${!isCompleted && 'cursor-pointer'}`}>
                    {option}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        );

      case "date":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={`field-${field.id}`}>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={`field-${field.id}`}
              type="date"
              value={value}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              disabled={isCompleted}
              data-testid={`date-field-${field.id}`}
            />
          </div>
        );

      case "file":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={`field-${field.id}`}>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <div className="text-sm text-gray-500 mb-2">File upload will be available in the next update</div>
            <Input
              id={`field-${field.id}`}
              type="text"
              placeholder="File upload coming soon..."
              disabled
              data-testid={`file-field-${field.id}`}
            />
          </div>
        );

      case "signature":
        return null;

      default:
        return (
          <div key={field.id} className="space-y-2">
            <Label>{field.label}</Label>
            <div className="text-sm text-gray-500">Unsupported field type: {field.fieldType}</div>
          </div>
        );
    }
  };

  if (assignmentLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading form...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!assignment || !assignment.template) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-3xl mx-auto">
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-red-600">Form not found or access denied</p>
              <Link href="/portal/forms">
                <Button className="mt-4">Back to Forms</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const isCompleted = assignment.status === "completed" || assignment.status === "reviewed";
  const progress = calculateProgress();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/portal/forms">
            <Button variant="outline" size="sm" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Forms
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-xl sm:text-2xl">{assignment.template.name}</CardTitle>
                {assignment.template.description && (
                  <CardDescription className="mt-2">{assignment.template.description}</CardDescription>
                )}
              </div>
              {isCompleted ? (
                <Badge className="bg-green-100 text-green-800 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  Completed
                </Badge>
              ) : (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  In Progress
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-6">
            {!isCompleted && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Progress: {progress}%</span>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {isSaving && (
                      <>
                        <Save className="w-3 h-3 animate-pulse" />
                        <span>Saving...</span>
                      </>
                    )}
                    {!isSaving && lastSaved && <span>Last saved {lastSaved.toLocaleTimeString()}</span>}
                  </div>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <div className="space-y-6">
              {assignment.template.fields
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((field) => renderField(field, isCompleted))}
            </div>

            {progress === 100 && (
              <div className="mt-8">
                <div className="border-t pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <PenTool className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Electronic Signature</h3>
                  </div>
                  <p className="text-sm text-gray-600 mb-4">
                    Please sign below to certify that the information provided is accurate and complete.
                  </p>
                  <SignaturePad
                    onSave={handleSignatureSave}
                    initialSignature={signature}
                    disabled={isCompleted}
                  />
                </div>
              </div>
            )}

            {!isCompleted && (
              <div className="mt-8 flex justify-end gap-4">
                <Button
                  size="lg"
                  onClick={handleSubmit}
                  disabled={submitFormMutation.isPending || progress < 100 || !signature}
                  data-testid="button-submit-form"
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {submitFormMutation.isPending ? "Submitting..." : "Submit Form"}
                </Button>
              </div>
            )}

            {isCompleted && (
              <>
                <div className="mt-8 border-t pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <PenTool className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Electronic Signature</h3>
                  </div>
                  <SignaturePad
                    onSave={handleSignatureSave}
                    initialSignature={signature}
                    disabled={true}
                  />
                </div>
                <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                  <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
                  <p className="text-green-800 font-medium">This form has been completed and submitted</p>
                  <p className="text-green-600 text-sm mt-1">
                    Your therapist will review your responses
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
