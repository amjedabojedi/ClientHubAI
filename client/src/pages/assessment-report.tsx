import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { formatDateDisplay, formatDateTimeDisplay } from "@/lib/datetime";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Rich Text Editor
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

// Icons
import { 
  ArrowLeft, 
  Download, 
  FileText,
  User,
  Calendar,
  CheckCircle,
  AlertCircle,
  ClipboardList,
  MoreVertical,
  ChevronDown,
  HelpCircle,
  Edit
} from "lucide-react";

// Utils
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatResponseDisplay } from "@/lib/assessment-response";

// Rich Text Editor Configuration
const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    ['clean']
  ],
};

const quillFormats = [
  'header',
  'bold', 'italic', 'underline',
  'list', 'bullet'
];

export default function AssessmentReportPage() {
  const [match, params] = useRoute("/assessments/:assignmentId/report");
  const [, setLocation] = useLocation();
  const assignmentId = params?.assignmentId ? parseInt(params.assignmentId) : null;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // State for editor and finalization
  const [editorContent, setEditorContent] = useState('');
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedResponses, setEditedResponses] = useState<Record<number, any>>({});

  // Fetch assessment assignment details
  const { data: assignment, isLoading: assignmentLoading } = useQuery<any>({
    queryKey: [`/api/assessments/assignments/${assignmentId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });

  // Fetch assessment responses
  const { data: responses = [], isLoading: responsesLoading } = useQuery<any[]>({
    queryKey: [`/api/assessments/assignments/${assignmentId}/responses`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });
  

  // Fetch template sections for structure
  const { data: sections = [] } = useQuery<any[]>({
    queryKey: [`/api/assessments/templates/${assignment?.templateId}/sections`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignment?.templateId,
  });

  // Fetch existing AI report if available
  const { data: report } = useQuery<any>({
    queryKey: [`/api/assessments/assignments/${assignmentId}/report`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });

  // Update editor content when report loads (prioritize finalContent if finalized)
  useEffect(() => {
    if (report) {
      setEditorContent(report.finalContent || report.draftContent || report.generatedContent || '');
    }
  }, [report]);

  // Generate AI report mutation
  const generateReportMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/assessments/assignments/${assignmentId}/generate-report`, "POST", {});
    },
    onSuccess: (report) => {
      toast({
        title: report ? "AI Report Regenerated" : "AI Report Generated",
        description: report ? "A new version of the professional assessment report has been created." : "Professional assessment report has been created successfully.",
      });
      // Refresh the report data
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/report`] });
    },
    onError: (error) => {
      toast({
        title: "Report Generation Failed",
        description: "There was an error generating the assessment report. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Draft saving mutation
  const saveDraftMutation = useMutation({
    mutationFn: async (draftContent: string) => {
      return apiRequest(`/api/assessments/assignments/${assignmentId}/report`, "PUT", { draftContent });
    },
    onSuccess: () => {
      toast({ title: "Draft saved successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/report`] });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save draft. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Finalize mutation
  const finalizeReportMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/assessments/assignments/${assignmentId}/report/finalize`, "POST");
    },
    onSuccess: () => {
      toast({ title: "Report finalized successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/report`] });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}`] });
      setFinalizeModalOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Finalization Failed",
        description: error.message || "Failed to finalize report. Please try again.",
        variant: "destructive",
      });
      setFinalizeModalOpen(false);
    }
  });

  // Unfinalize mutation - allows reopening finalized reports
  const unfinalizeReportMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/assessments/assignments/${assignmentId}/report/unfinalize`, "POST");
    },
    onSuccess: () => {
      toast({ 
        title: "Report Reopened", 
        description: "The report can now be regenerated or edited again."
      });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/report`] });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Reopen Failed",
        description: error.message || "Failed to reopen report. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Save edited responses mutation
  const saveResponsesMutation = useMutation({
    mutationFn: async () => {
      // Filter only changed responses
      const changedResponses = Object.values(editedResponses).filter((editedResp: any) => {
        const originalResp = responses.find((r: any) => r.questionId === editedResp.questionId);
        if (!originalResp) return true; // New response
        
        // Compare based on question type
        const question = editedResp.question;
        if (!question) return false;

        switch (question.questionType) {
          case 'short_text':
          case 'long_text':
            return editedResp.responseText !== originalResp.responseText;
          case 'multiple_choice':
            return editedResp.selectedOptions?.[0]?.id !== originalResp.selectedOptions?.[0]?.id;
          case 'checkbox':
            const editedIds = (editedResp.selectedOptions || []).map((o: any) => o.id).sort();
            const originalIds = (originalResp.selectedOptions || []).map((o: any) => o.id).sort();
            return JSON.stringify(editedIds) !== JSON.stringify(originalIds);
          case 'rating_scale':
            return editedResp.ratingValue !== originalResp.ratingValue;
          case 'number':
            return editedResp.numericValue !== originalResp.numericValue;
          case 'date':
            return editedResp.dateValue !== originalResp.dateValue;
          default:
            return false;
        }
      });

      if (changedResponses.length === 0) {
        throw new Error("No changes to save");
      }

      return apiRequest(
        `/api/assessments/assignments/${assignmentId}/responses`, 
        "PATCH", 
        { responses: changedResponses }
      );
    },
    onSuccess: () => {
      toast({ 
        title: "Responses Saved", 
        description: "Assessment responses have been updated successfully."
      });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/responses`] });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/report`] });
      setIsEditMode(false);
      setEditedResponses({});
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save responses. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Handle Save & Finalize
  const handleSaveAndFinalize = async () => {
    // First save draft
    await saveDraftMutation.mutateAsync(editorContent);
    // Then show finalize dialog
    setFinalizeModalOpen(true);
  };

  if (assignmentLoading || responsesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading assessment report...</p>
        </div>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Assessment Not Found</h2>
          <p className="text-slate-600 mb-4">The requested assessment could not be found.</p>
          <Button onClick={() => setLocation("/assessments")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Assessments
          </Button>
        </div>
      </div>
    );
  }

  // Group responses by section
  const responsesBySection = responses.reduce((acc: any, response: any) => {
    // Response already includes question object from backend
    const question = response.question || sections
      .flatMap(s => s.questions || [])
      .find(q => q.id === response.questionId || Number(q.id) === Number(response.questionId));
    
    if (question) {
      const sectionId = question.sectionId;
      if (!acc[sectionId]) acc[sectionId] = [];
      acc[sectionId].push({ ...response, question });
    }
    return acc;
  }, {});

  const getResponseDisplay = (response: any) => {
    const { question } = response;
    
    // Use shared utility for consistent response formatting
    const result = formatResponseDisplay({ question, response });
    
    // For rating responses with labels, show both value and label
    if (result.secondaryText) {
      return `${result.secondaryText} (${result.primaryText})`;
    }
    
    return result.primaryText;
  };

  // Render editable response based on question type
  const renderEditableResponse = (question: any, response: any) => {
    const editedResp = editedResponses[question.id] || response || {};
    
    const handleResponseChange = (value: any) => {
      setEditedResponses(prev => ({
        ...prev,
        [question.id]: {
          ...editedResp,
          questionId: question.id,
          question,
          ...value
        }
      }));
    };

    switch (question.questionType) {
      case 'short_text':
        return (
          <Input
            value={editedResp.responseText || ''}
            onChange={(e) => handleResponseChange({ responseText: e.target.value })}
            placeholder="Enter your response"
            data-testid={`input-response-${question.id}`}
          />
        );

      case 'long_text':
        return (
          <Textarea
            value={editedResp.responseText || ''}
            onChange={(e) => handleResponseChange({ responseText: e.target.value })}
            placeholder="Enter your response"
            rows={4}
            data-testid={`textarea-response-${question.id}`}
          />
        );

      case 'multiple_choice':
        const allOptions = question.allOptions || [];
        return (
          <Select
            value={editedResp.selectedOptions?.[0]?.id?.toString() || ''}
            onValueChange={(value) => {
              const selectedOption = allOptions.find((opt: any) => opt.id.toString() === value);
              handleResponseChange({ 
                selectedOptions: selectedOption ? [selectedOption] : [] 
              });
            }}
          >
            <SelectTrigger data-testid={`select-response-${question.id}`}>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {allOptions.map((option: any) => (
                <SelectItem key={option.id} value={option.id.toString()}>
                  {option.optionText}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'checkbox':
        const checkboxOptions = question.allOptions || [];
        // selectedOptions is an array of option IDs (numbers), not objects
        const selectedIds = editedResp.selectedOptions || [];
        
        return (
          <div className="space-y-2" data-testid={`checkbox-group-response-${question.id}`}>
            {checkboxOptions.map((option: any) => (
              <div key={option.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`checkbox-${question.id}-${option.id}`}
                  checked={selectedIds.includes(option.id)}
                  onCheckedChange={(checked) => {
                    let newSelectedIds;
                    if (checked) {
                      newSelectedIds = [...selectedIds, option.id];
                    } else {
                      newSelectedIds = selectedIds.filter((id: number) => id !== option.id);
                    }
                    handleResponseChange({ selectedOptions: newSelectedIds });
                  }}
                  data-testid={`checkbox-response-${question.id}-${option.id}`}
                />
                <Label 
                  htmlFor={`checkbox-${question.id}-${option.id}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {option.optionText}
                </Label>
              </div>
            ))}
          </div>
        );

      case 'rating_scale':
        const ratingOptions = question.allOptions || [];
        return (
          <RadioGroup
            value={editedResp.ratingValue?.toString() || ''}
            onValueChange={(value) => handleResponseChange({ ratingValue: parseInt(value) })}
            data-testid={`radio-group-response-${question.id}`}
          >
            {ratingOptions.map((option: any) => (
              <div key={option.id} className="flex items-center space-x-2">
                <RadioGroupItem 
                  value={option.ratingValue.toString()} 
                  id={`rating-${question.id}-${option.ratingValue}`}
                  data-testid={`radio-response-${question.id}-${option.ratingValue}`}
                />
                <Label 
                  htmlFor={`rating-${question.id}-${option.ratingValue}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {option.ratingValue} - {option.ratingLabel}
                </Label>
              </div>
            ))}
          </RadioGroup>
        );

      case 'number':
        return (
          <Input
            type="number"
            value={editedResp.numericValue ?? ''}
            onChange={(e) => handleResponseChange({ 
              numericValue: e.target.value ? parseFloat(e.target.value) : null 
            })}
            placeholder="Enter a number"
            data-testid={`input-number-response-${question.id}`}
          />
        );

      case 'date':
        return (
          <Input
            type="date"
            value={editedResp.dateValue || ''}
            onChange={(e) => handleResponseChange({ dateValue: e.target.value })}
            data-testid={`input-date-response-${question.id}`}
          />
        );

      default:
        return (
          <p className="text-slate-500 italic">Unsupported question type: {question.questionType}</p>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center space-x-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setLocation(`/clients/${assignment.clientId}?from=assessments&tab=assessments`)}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              {!report?.isFinalized && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setLocation(`/assessments/${assignmentId}/complete`)}
                  className="border-purple-600 text-purple-600 hover:bg-purple-50"
                  data-testid="button-edit-assessment-responses"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Assessment Responses
                </Button>
              )}
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Assessment Report</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Assessment Summary */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <span>Assessment Summary</span>
              </CardTitle>
              
              {/* Actions Dropdown Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MoreVertical className="w-4 h-4 mr-2" />
                    Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {!report ? (
                    <DropdownMenuItem 
                      onClick={() => generateReportMutation.mutate()}
                      disabled={generateReportMutation.isPending}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      {generateReportMutation.isPending ? 'Generating...' : 'Generate AI Report'}
                    </DropdownMenuItem>
                  ) : !report.isFinalized ? (
                    <DropdownMenuItem 
                      onClick={() => setShowRegenerateDialog(true)}
                      disabled={generateReportMutation.isPending}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      {generateReportMutation.isPending ? 'Regenerating...' : 'Regenerate Report'}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem 
                      onClick={() => unfinalizeReportMutation.mutate()}
                      disabled={unfinalizeReportMutation.isPending}
                      data-testid="button-reopen-report"
                    >
                      <AlertCircle className="w-4 h-4 mr-2" />
                      {unfinalizeReportMutation.isPending ? 'Reopening...' : 'Reopen Report'}
                    </DropdownMenuItem>
                  )}
                  
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem 
                    onClick={() => {
                      window.open(`/api/assessments/assignments/${assignmentId}/download/pdf`, '_blank');
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem 
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = `/api/assessments/assignments/${assignmentId}/download/docx`;
                      link.download = `assessment-report-${assignment.client?.fullName?.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.docx`;
                      link.click();
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Word
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="flex items-center space-x-3">
                <User className="w-5 h-5 text-blue-600" />
                <div>
                  <div className="text-sm text-slate-600">Client</div>
                  <div className="font-semibold">{assignment.client.fullName}</div>
                  <div className="text-sm text-slate-500">{assignment.client.clientId}</div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <ClipboardList className="w-5 h-5 text-green-600" />
                <div>
                  <div className="text-sm text-slate-600">Assessment</div>
                  <div className="font-semibold">{assignment.template.name}</div>
                  <div className="text-sm text-slate-500">{assignment.template.category}</div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <Calendar className="w-5 h-5 text-purple-600" />
                <div>
                  <div className="text-sm text-slate-600">Completed</div>
                  <div className="font-semibold">
                    {assignment.completedAt ? 
                      formatDateDisplay(assignment.completedAt) : 
                      'Not completed'
                    }
                  </div>
                  <div className="text-sm text-slate-500">
                    by {assignment.assignedBy.fullName}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div>
                  <div className="text-sm text-slate-600">Responses</div>
                  <div className="font-semibold">{responses.length} questions</div>
                  <div className="text-sm text-slate-500">
                    {sections.reduce((acc, s) => acc + (s.questions?.length || 0), 0)} total
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inline Report Generation Help */}
        <Collapsible defaultOpen={true} className="mb-6">
          <Card className="border-blue-200 bg-blue-50">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-blue-100 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-base">Assessment Report Generation Guide {report?.isFinalized ? '- Finalized' : '- Draft Mode'}</CardTitle>
                  </div>
                  <ChevronDown className="w-5 h-5 text-blue-600" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                {report?.isFinalized ? (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                      <div>
                        <p className="font-medium text-sm">View Finalized Report</p>
                        <p className="text-xs text-gray-600">This report is finalized and locked with digital signature dated {formatDateDisplay(report.finalizedAt)}. Click the "View Report" accordion below to expand and review the complete professional assessment report with your credentials.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                      <div>
                        <p className="font-medium text-sm">Reopen for Edits (If Needed)</p>
                        <p className="text-xs text-gray-600">To make changes: Click <strong>Actions</strong> → select <strong>Reopen Report</strong> → report unlocks → edit content below → <strong>Save Draft</strong> → when ready click <strong>Save & Finalize</strong> to lock again with new timestamp.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                      <div>
                        <p className="font-medium text-sm">Download Professional Documents</p>
                        <p className="text-xs text-gray-600">Click <strong>Actions</strong> → Download PDF or Word. Both formats include your full name, license credentials, and digital signature. These documents appear on official client records and can be shared with insurance or other providers.</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                      <div>
                        <p className="font-medium text-sm">Generate AI Report (First Time)</p>
                        <p className="text-xs text-gray-600">If no report exists yet: Click <strong>Actions</strong> → <strong>Generate AI Report</strong>. If report exists: Click <strong>Actions</strong> → <strong>Regenerate Report</strong>. The AI analyzes all client responses and creates a comprehensive professional assessment report with clinical insights, diagnoses, and treatment recommendations. Generation takes 30-60 seconds.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                      <div>
                        <p className="font-medium text-sm">Review & Edit Report</p>
                        <p className="text-xs text-gray-600">Click the "Edit Report" accordion below to expand and review AI-generated content. Accept as-is OR edit manually using the rich text editor. Add your clinical interpretations, modify wording, or restructure sections as needed.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                      <div>
                        <p className="font-medium text-sm">Save Draft or Finalize</p>
                        <p className="text-xs text-gray-600">Click <strong>Save Draft</strong> to save changes without locking (edit later). When report is complete, click <strong>Save & Finalize</strong> to lock with digital signature and timestamp. Finalized reports appear on official documentation and can be downloaded as PDF/Word.</p>
                      </div>
                    </div>
                  </>
                )}
                <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                  <p className="text-xs text-blue-900">
                    <strong>💡 Pro Tips:</strong> Finalized reports include your professional credentials and digital signature on all exports. AI reports can be regenerated if you need a fresh analysis. All assessment activities are HIPAA audit-logged automatically.
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* AI Generated Report with ReactQuill Editor - Collapsible */}
        {report?.generatedContent && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="w-5 h-5 text-green-600" />
                  <span>Professional Report</span>
                  {report.isFinalized && (
                    <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">
                      ✅ Finalized {formatDateDisplay(report.finalizedAt)}
                    </Badge>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible defaultValue="report-content" className="w-full">
                <AccordionItem value="report-content" className="border-none">
                  <AccordionTrigger className="hover:no-underline py-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold">
                        {report.isFinalized ? '📄 View Report' : '✏️ Edit Report'}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-4">
                      <ReactQuill
                        theme="snow"
                        value={editorContent}
                        onChange={setEditorContent}
                        modules={quillModules}
                        formats={quillFormats}
                        readOnly={report.isFinalized === true}
                        className={report.isFinalized ? "readonly-editor" : ""}
                      />
                      
                      {/* Action Buttons */}
                      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                        <div className="text-sm text-slate-600">
                          {report.generatedAt && (
                            <div>Generated on {formatDateTimeDisplay(report.generatedAt)}</div>
                          )}
                          {report.id && <div className="text-xs text-slate-500 mt-1">Report ID: #{report.id}</div>}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {!report.isFinalized ? (
                            <>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => saveDraftMutation.mutate(editorContent)}
                                disabled={saveDraftMutation.isPending}
                              >
                                {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                              </Button>
                              <Button 
                                size="sm"
                                onClick={handleSaveAndFinalize}
                                disabled={saveDraftMutation.isPending}
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Save & Finalize
                              </Button>
                            </>
                          ) : (
                            <Badge className="bg-green-100 text-green-800 px-3 py-1">
                              ✅ Finalized {formatDateDisplay(report.finalizedAt)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        )}

        {/* Assessment Responses by Section - Collapsible */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <ClipboardList className="w-5 h-5 text-blue-600" />
                  <span>Assessment Responses</span>
                </CardTitle>
                <p className="text-sm text-slate-600 mt-1">
                  {isEditMode ? 'Edit responses directly below' : 'Click on each section to view detailed responses'}
                </p>
              </div>
              {!report?.isFinalized && (
                <Button
                  variant={isEditMode ? "outline" : "default"}
                  size="sm"
                  onClick={() => {
                    if (isEditMode) {
                      // Cancel edit mode
                      setIsEditMode(false);
                      setEditedResponses({});
                    } else {
                      // Enter edit mode - initialize with current responses
                      const initialEdits: Record<number, any> = {};
                      responses.forEach((r: any) => {
                        initialEdits[r.questionId] = r;
                      });
                      setEditedResponses(initialEdits);
                      setIsEditMode(true);
                    }
                  }}
                  className={isEditMode ? "" : "bg-purple-600 hover:bg-purple-700"}
                  data-testid="button-edit-responses-mode"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  {isEditMode ? 'Cancel Edit' : 'Edit Responses'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {sections.map((section, sectionIndex) => {
                const sectionResponses = responsesBySection[section.id] || [];
                
                return (
                  <AccordionItem key={section.id} value={`section-${section.id}`}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center space-x-3 flex-1">
                        <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
                          {sectionIndex + 1}
                        </span>
                        <div className="flex-1 text-left">
                          <div className="font-semibold text-slate-900">{section.title}</div>
                          {section.description && (
                            <p className="text-sm text-slate-600 mt-1">{section.description}</p>
                          )}
                        </div>
                        <Badge variant="outline" className="ml-2">
                          {section.questions?.length || 0} questions
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-6 pt-4">
                        {section.questions?.map((question: any, questionIndex: number) => {
                          const response = sectionResponses.find((r: any) => r.questionId === question.id || Number(r.questionId) === Number(question.id));
                          
                          return (
                            <div key={question.id} className="space-y-2">
                              <div className="flex items-start space-x-3">
                                <div className="flex-shrink-0 w-6 h-6 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center text-xs font-semibold">
                                  {questionIndex + 1}
                                </div>
                                <div className="flex-1">
                                  <div className="font-medium text-slate-900 mb-2">
                                    {question.questionText}
                                    {question.isRequired && <span className="text-red-500 ml-1">*</span>}
                                  </div>
                                  {isEditMode ? (
                                    <div className="space-y-2">
                                      {renderEditableResponse(question, response)}
                                    </div>
                                  ) : (
                                    <div className="bg-slate-50 rounded-lg p-3">
                                      {response ? (
                                        <p className="text-slate-700">{getResponseDisplay(response)}</p>
                                      ) : (
                                        <p className="text-slate-500 italic">No response provided</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {questionIndex < (section.questions?.length || 0) - 1 && (
                                <Separator className="my-4" />
                              )}
                            </div>
                          );
                        })}
                        
                        {(!section.questions || section.questions.length === 0) && (
                          <p className="text-slate-500 text-center py-8">
                            No questions in this section
                          </p>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
            
            {isEditMode && (
              <div className="mt-6 flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditMode(false);
                    setEditedResponses({});
                  }}
                  data-testid="button-cancel-save-responses"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => saveResponsesMutation.mutate()}
                  disabled={saveResponsesMutation.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                  data-testid="button-save-all-responses"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {saveResponsesMutation.isPending ? 'Saving...' : 'Save All Responses'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Finalization Confirmation Dialog */}
      <Dialog open={finalizeModalOpen} onOpenChange={setFinalizeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize Assessment Report</DialogTitle>
            <DialogDescription>
              Are you sure you want to finalize this assessment report?
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium mb-2">
                ⚠️ This action is irreversible
              </p>
              <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1 list-disc list-inside">
                <li>The report will be locked and cannot be edited</li>
                <li>Finalization timestamp will be recorded</li>
                <li>Your digital signature will be applied to the PDF</li>
              </ul>
            </div>

            {(!user?.title || !user?.signatureImage) && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
                  📝 Profile Information
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {!user?.title && !user?.signatureImage && "Your professional title and signature image are not set. "}
                  {!user?.title && user?.signatureImage && "Your professional title is not set. "}
                  {user?.title && !user?.signatureImage && "Your signature image is not set. "}
                  The PDF will include your name{user?.title ? " and title" : ""} in the signature section.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFinalizeModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => finalizeReportMutation.mutate()}
              disabled={finalizeReportMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {finalizeReportMutation.isPending ? 'Finalizing...' : 'Finalize Report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate Report Confirmation */}
      <AlertDialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-orange-500" />
              <span>Regenerate Report?</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will generate a new AI report based on the assessment responses. 
              <span className="font-semibold text-orange-600"> Any unsaved edits to the current report will be lost.</span>
              <br /><br />
              Make sure to save any changes you want to keep before regenerating.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowRegenerateDialog(false);
                generateReportMutation.mutate();
              }}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Regenerate Report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
