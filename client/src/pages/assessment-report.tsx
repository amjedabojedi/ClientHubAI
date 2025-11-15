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
  HelpCircle
} from "lucide-react";

// Utils
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

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

  // DEBUG: Log responses to see what we're receiving
  useEffect(() => {
    if (responses.length > 0) {
      console.log('=== ASSESSMENT RESPONSES DEBUG ===');
      console.log('Total responses:', responses.length);
      const sampleResponse = responses.find(r => r.question?.questionText?.toLowerCase().includes('sadness'));
      if (sampleResponse) {
        console.log('Sample Sadness response:', {
          questionId: sampleResponse.questionId,
          questionText: sampleResponse.question?.questionText,
          selectedOptions: sampleResponse.selectedOptions,
          hasAllOptions: !!sampleResponse.question?.allOptions,
          allOptionsCount: sampleResponse.question?.allOptions?.length || 0,
          allOptions: sampleResponse.question?.allOptions
        });
      }
      console.log('=================================');
    }
  }, [responses]);

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
    const question = sections
      .flatMap(s => s.questions || [])
      .find(q => q.id === response.questionId);
    
    if (question) {
      const sectionId = question.sectionId;
      if (!acc[sectionId]) acc[sectionId] = [];
      acc[sectionId].push({ ...response, question });
    }
    return acc;
  }, {});

  const getResponseDisplay = (response: any) => {
    const { question } = response;
    
    // Show actual text responses
    if (response.responseText && response.responseText.trim()) {
      return response.responseText.trim();
    }
    
    // Show rating labels instead of numeric values
    if (response.ratingValue !== null && response.ratingValue !== undefined) {
      // Try to use rating labels if available
      if (question.ratingLabels && Array.isArray(question.ratingLabels)) {
        const labelIndex = response.ratingValue - (question.ratingMin || 1);
        const label = question.ratingLabels[labelIndex];
        if (label) {
          return `${label} (${response.ratingValue})`;
        }
      }
      // Fallback to just showing the numeric value
      return String(response.ratingValue);
    }
    
    // Show selected options using database options
    if (response.selectedOptions && response.selectedOptions.length > 0) {
      // PREFERRED: Use allOptions from database (includes option IDs for proper matching)
      if (question.allOptions && question.allOptions.length > 0) {
        const selectedTexts = response.selectedOptions
          .map((optionId: number) => {
            const option = question.allOptions.find((opt: any) => opt.id === optionId);
            return option?.optionText;
          })
          .filter(Boolean);
        
        return selectedTexts.length > 0 ? selectedTexts.join(', ') : 'No selection made';
      }
      
      // FALLBACK: Try legacy array-based options (for old data)
      let questionOptions = question.options;
      
      // If no options in database, use same hardcoded fallbacks as assessment completion form
      if (!questionOptions || questionOptions.length === 0) {
        const questionText = question.questionText?.toLowerCase() || '';
        
        // BDI-II Items - ALL 21 items with exact options
        if (questionText.includes('sadness')) {
          questionOptions = ['I do not feel sad.', 'I feel sad much of the time.', 'I am sad all the time.', "I am so sad or unhappy that I can't stand it."];
        } else if (questionText.includes('pessimism')) {
          questionOptions = ['I am not discouraged about my future.', 'I feel more discouraged about my future than I used to be.', 'I do not expect things to work out for me.', 'I feel my future is hopeless and will only get worse.'];
        } else if (questionText.includes('past failure')) {
          questionOptions = ['I do not feel like a failure.', 'I have failed more than I should have.', 'As I look back, I see a lot of failures.', 'I feel I am a total failure as a person.'];
        } else if (questionText.includes('loss of pleasure')) {
          questionOptions = ['I get as much pleasure as I ever did from the things I enjoy.', "I don't enjoy things as much as I used to.", 'I get very little pleasure from the things I used to enjoy.', "I can't get any pleasure from the things I used to enjoy."];
        } else if (questionText.includes('guilty feelings')) {
          questionOptions = ["I don't feel particularly guilty.", 'I feel guilty over many things I have done or should have done.', 'I feel quite guilty most of the time.', 'I feel guilty all of the time.'];
        } else if (questionText.includes('punishment feelings')) {
          questionOptions = ["I don't feel I am being punished.", 'I feel I may be punished.', 'I expect to be punished.', 'I feel I am being punished.'];
        } else if (questionText.includes('self-dislike')) {
          questionOptions = ['I feel the same about myself as ever.', 'I have lost confidence in myself.', 'I am disappointed in myself.', 'I dislike myself.'];
        } else if (questionText.includes('self-criticalness')) {
          questionOptions = ["I don't criticize or blame myself more than usual.", 'I am more critical of myself than I used to be.', 'I criticize myself for all of my faults.', 'I blame myself for everything bad that happens.'];
        } else if (questionText.includes('suicidal thoughts')) {
          questionOptions = ["I don't have any thoughts of killing myself.", 'I have thoughts of killing myself, but I would not carry them out.', 'I would like to kill myself.', 'I would kill myself if I had the chance.'];
        } else if (questionText.includes('crying')) {
          questionOptions = ["I don't cry anymore than I used to.", 'I cry more than I used to.', 'I cry over every little thing.', "I feel like crying, but I can't."];
        } else if (questionText.includes('agitation')) {
          questionOptions = ['I am no more restless or wound up than usual.', 'I feel more restless or wound up than usual.', "I am so restless or agitated that it's hard to stay still.", 'I am so restless or agitated that I have to keep moving or doing something.'];
        } else if (questionText.includes('loss of interest')) {
          questionOptions = ['I have not lost interest in other people or activities.', 'I am less interested in other people or things than before.', 'I have lost most of my interest in other people or things.', "It's hard to get interested in anything."];
        } else if (questionText.includes('indecisiveness')) {
          questionOptions = ['I make decisions about as well as ever.', 'I find it more difficult to make decisions than usual.', 'I have much greater difficulty in making decisions than I used to.', 'I have trouble making any decisions.'];
        } else if (questionText.includes('worthlessness')) {
          questionOptions = ['I do not feel I am worthless.', "I don't consider myself as worthwhile and useful as I used to.", 'I feel more worthless as compared to other people.', 'I feel utterly worthless.'];
        } else if (questionText.includes('loss of energy')) {
          questionOptions = ['I have as much energy as ever.', 'I have less energy than I used to have.', "I don't have enough energy to do very much.", "I don't have enough energy to do anything."];
        } else if (questionText.includes('changes in sleeping')) {
          questionOptions = ['I have not experienced any change in my sleeping pattern.', 'I sleep somewhat more than usual / I sleep somewhat less than usual.', 'I sleep a lot more than usual / I sleep a lot less than usual.', 'I sleep most of the day / I wake up 1-2 hours early and can\'t get back to sleep.'];
        } else if (questionText.includes('irritability')) {
          questionOptions = ['I am no more irritable than usual.', 'I am more irritable than usual.', 'I am much more irritable than usual.', 'I am irritable all the time.'];
        } else if (questionText.includes('changes in appetite')) {
          questionOptions = ['I have not experienced any change in my appetite.', 'My appetite is somewhat less than usual / My appetite is somewhat greater than usual.', 'My appetite is much less than before / My appetite is much greater than usual.', 'I have no appetite at all / I crave food all the time.'];
        } else if (questionText.includes('concentration')) {
          questionOptions = ['I can concentrate as well as ever.', "I can't concentrate as well as usual.", "It's hard to keep my mind on anything for very long.", "I find I can't concentrate on anything."];
        } else if (questionText.includes('tiredness') || questionText.includes('fatigue')) {
          questionOptions = ['I am no more tired or fatigued than usual.', 'I get more tired or fatigued more easily than usual.', 'I am too tired or fatigued to do a lot of the things I used to do.', 'I am too tired or fatigued to do most of the things I used to do.'];
        } else if (questionText.includes('loss of interest in sex')) {
          questionOptions = ['I have not noticed any recent change in my interest in sex.', 'I am less interested in sex than I used to be.', 'I am much less interested in sex now.', 'I have lost interest in sex completely.'];
        } else if (questionText.includes('session format')) {
          questionOptions = ['In-Person', 'Online', 'Phone'];
        } else {
          // Default fallback for unmatched questions
          questionOptions = ['Yes', 'No'];
        }
      }
      
      // Map selected indices to actual option text (LEGACY - only for old data without IDs)
      const selectedTexts = response.selectedOptions
        .map((idx: number) => questionOptions[idx])
        .filter(Boolean);
      
      return selectedTexts.length > 0 ? selectedTexts.join(', ') : 'No selection made';
    }
    
    return 'No response provided';
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
            <CardTitle className="flex items-center space-x-2">
              <ClipboardList className="w-5 h-5 text-blue-600" />
              <span>Assessment Responses</span>
            </CardTitle>
            <p className="text-sm text-slate-600 mt-1">Click on each section to view detailed responses</p>
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
                          const response = sectionResponses.find((r: any) => r.questionId === question.id);
                          
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
                                  <div className="bg-slate-50 rounded-lg p-3">
                                    {response ? (
                                      <p className="text-slate-700">{getResponseDisplay(response)}</p>
                                    ) : (
                                      <p className="text-slate-500 italic">No response provided</p>
                                    )}
                                  </div>
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
