import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
  ClipboardList
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
      setFinalizeModalOpen(false);
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
      // Always use options from database - no hardcoded values
      const questionOptions = question.options;
      
      // If no options in database, try to show meaningful text
      if (!questionOptions || questionOptions.length === 0) {
        console.warn(`Question options missing for question: ${question.questionText}`);
        return response.selectedOptions.map((idx: number) => `Option ${idx + 1}`).join(', ');
      }
      
      // Map selected indices to actual option text from database
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center space-x-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setLocation(`/clients/${assignment.clientId}?tab=assessments`)}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Assessment Report</h1>
                <p className="text-slate-600">{assignment.template.name} - {assignment.client.fullName}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle className="w-3 h-3 mr-1" />
                Completed
              </Badge>
              {!report ? (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => generateReportMutation.mutate()}
                  disabled={generateReportMutation.isPending}
                  className="border-blue-600 text-blue-600 hover:bg-blue-50"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {generateReportMutation.isPending ? 'Generating...' : 'Generate AI Report'}
                </Button>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowRegenerateDialog(true)}
                  disabled={generateReportMutation.isPending}
                  className="border-orange-600 text-orange-600 hover:bg-orange-50"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {generateReportMutation.isPending ? 'Regenerating...' : 'Regenerate Report'}
                </Button>
              )}
              <div className="flex space-x-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    // Create a new window with just the report content
                    const reportContent = report?.draftContent || report?.generatedContent || '';
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      printWindow.document.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                          <title>Assessment Report - ${assignment.client?.fullName}</title>
                          <style>
                            body { 
                              font-family: 'Times New Roman', serif; 
                              line-height: 1.8; 
                              margin: 1in; 
                              color: #000; 
                              font-size: 12pt;
                              background: white;
                            }
                            h1 { 
                              color: #000; 
                              border-bottom: 2px solid #000; 
                              padding-bottom: 10px; 
                              page-break-after: avoid; 
                              font-size: 18pt;
                              font-weight: bold;
                              text-align: center;
                              margin-bottom: 30px;
                              text-transform: uppercase;
                            }
                            h2 { 
                              color: #000; 
                              margin-top: 25px; 
                              margin-bottom: 15px;
                              page-break-after: avoid; 
                              font-size: 14pt;
                              font-weight: bold;
                              text-decoration: underline;
                            }
                            .client-info { 
                              border: 1px solid #000; 
                              padding: 20px; 
                              margin-bottom: 30px; 
                              background: white;
                            }
                            .section { 
                              margin-bottom: 25px; 
                              page-break-inside: avoid; 
                            }
                            p { 
                              margin-bottom: 12px; 
                              text-align: justify;
                            }
                            strong { font-weight: bold; }
                            @media print { 
                              body { margin: 0.75in; font-size: 11pt; }
                              .no-print { display: none; }
                              h1 { font-size: 16pt; }
                              h2 { font-size: 13pt; }
                            }
                          </style>
                        </head>
                        <body>
                          ${reportContent
                            .replace(/\n\n/g, '</p><p>')
                            .replace(/\n/g, '<br>')
                            .replace(/## ([^<]+)/g, '<h2>$1</h2>')
                            .replace(/# ([^<]+)/g, '<h1>$1</h1>')
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/^([^<])/gm, '<p>$1')
                            .replace(/([^>])$/gm, '$1</p>')}
                        </body>
                        </html>
                      `);
                      printWindow.document.close();
                      printWindow.print();
                    }
                  }}
                  className="border-gray-600 text-gray-600 hover:bg-gray-50"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Print
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = `/api/assessments/assignments/${assignmentId}/download/pdf`;
                    link.download = `assessment-report-${assignment.client?.fullName?.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`;
                    link.click();
                  }}
                  className="border-red-600 text-red-600 hover:bg-red-50"
                >
                  <Download className="w-4 h-4 mr-2" />
                  PDF
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = `/api/assessments/assignments/${assignmentId}/download/docx`;
                    link.download = `assessment-report-${assignment.client?.fullName?.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.docx`;
                    link.click();
                  }}
                  className="border-blue-600 text-blue-600 hover:bg-blue-50"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Word
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Assessment Summary */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <FileText className="w-5 h-5 text-blue-600" />
              <span>Assessment Summary</span>
            </CardTitle>
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
                      formatInTimeZone(new Date(assignment.completedAt), 'America/New_York', 'MMM dd, yyyy') : 
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

        {/* AI Generated Report with ReactQuill Editor */}
        {report?.generatedContent && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-green-600" />
                <span>Assessment Report</span>
                {report.isFinalized && (
                  <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">
                    ✅ Finalized {formatInTimeZone(new Date(report.finalizedAt), 'America/New_York', 'MMM dd, yyyy')}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
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
                      <div>Generated on {formatInTimeZone(new Date(report.generatedAt), 'America/New_York', "MMM dd, yyyy 'at' h:mm a")}</div>
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
                        ✅ Finalized {formatInTimeZone(new Date(report.finalizedAt), 'America/New_York', 'MMM dd, yyyy')}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Assessment Description */}
        {assignment.template.description && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Assessment Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-700">{assignment.template.description}</p>
            </CardContent>
          </Card>
        )}

        {/* Assessment Responses by Section */}
        <div className="space-y-6">
          {sections.map((section, sectionIndex) => {
            const sectionResponses = responsesBySection[section.id] || [];
            
            return (
              <Card key={section.id}>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
                      {sectionIndex + 1}
                    </span>
                    <span>{section.title}</span>
                  </CardTitle>
                  {section.description && (
                    <p className="text-slate-600 mt-2">{section.description}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-6">
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
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Summary */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Assessment Notes</CardTitle>
          </CardHeader>
          <CardContent>
            {assignment.notes ? (
              <p className="text-slate-700">{assignment.notes}</p>
            ) : (
              <p className="text-slate-500 italic">No additional notes provided for this assessment.</p>
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
