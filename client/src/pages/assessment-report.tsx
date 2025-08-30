import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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

export default function AssessmentReportPage() {
  const [match, params] = useRoute("/assessments/:assignmentId/report");
  const [, setLocation] = useLocation();
  const assignmentId = params?.assignmentId ? parseInt(params.assignmentId) : null;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch assessment assignment details
  const { data: assignment, isLoading: assignmentLoading } = useQuery({
    queryKey: [`/api/assessments/assignments/${assignmentId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });

  // Fetch assessment responses
  const { data: responses = [], isLoading: responsesLoading } = useQuery({
    queryKey: [`/api/assessments/assignments/${assignmentId}/responses`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });

  // Fetch template sections for structure
  const { data: sections = [] } = useQuery({
    queryKey: [`/api/assessments/templates/${assignment?.templateId}/sections`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignment?.templateId,
  });

  // Fetch existing AI report if available
  const { data: existingReport } = useQuery({
    queryKey: [`/api/assessments/assignments/${assignmentId}/report`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });

  // Generate AI report mutation
  const generateReportMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/assessments/assignments/${assignmentId}/generate-report`, "POST", {});
    },
    onSuccess: (report) => {
      toast({
        title: existingReport ? "AI Report Regenerated" : "AI Report Generated",
        description: existingReport ? "A new version of the professional assessment report has been created." : "Professional assessment report has been created successfully.",
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
    
    // Helper function to get default options when question.options is null
    const getQuestionOptions = (question: any) => {
      if (question.options) return question.options;
      
      // Use the same default logic as the completion form
      if (question.questionType === 'multiple_choice') {
        if (question.questionText?.toLowerCase().includes('session format')) {
          return ['In-Person', 'Online', 'Phone'];
        }
        return ['Yes', 'No'];
      }
      
      if (question.questionType === 'checkbox') {
        const text = question.questionText?.toLowerCase() || '';
        if (text.includes('psychological tools') || text.includes('which psychological')) {
          return ['Clinical Interview', 'Questionnaires', 'Standardized Tests', 'Behavioral Observation', 'Other'];
        } else if (text.includes('physical concerns') || text.includes('physical')) {
          return ['Headaches', 'Sleep problems', 'Fatigue', 'Appetite changes', 'Muscle tension', 'Other physical symptoms'];
        } else if (text.includes('emotional concerns') || text.includes('emotional')) {
          return ['Anxiety', 'Depression', 'Anger', 'Fear', 'Sadness', 'Feeling overwhelmed'];
        } else if (text.includes('social') || text.includes('relational')) {
          return ['Isolation', 'Relationship conflicts', 'Communication difficulties', 'Trust issues', 'Cultural adjustment'];
        } else if (text.includes('cognitive') || text.includes('thinking')) {
          return ['Memory problems', 'Concentration difficulties', 'Confusion', 'Racing thoughts', 'Negative thinking'];
        } else if (text.includes('medical conditions') || text.includes('chronic')) {
          return ['Diabetes', 'Heart disease', 'High blood pressure', 'Arthritis', 'Other chronic condition'];
        } else if (text.includes('trauma') || text.includes('migration') || text.includes('stressors')) {
          return ['Violence', 'Loss of family/friends', 'Economic hardship', 'Discrimination', 'Language barriers', 'Cultural conflicts'];
        }
        return ['Yes', 'No', 'Not applicable'];
      }
      
      return [];
    };
    
    switch (question.questionType) {
      case 'short_text':
      case 'long_text':
        return response.responseText || 'No response provided';
      
      case 'multiple_choice':
        if (response.selectedOptions && response.selectedOptions.length > 0) {
          const options = getQuestionOptions(question);
          return options[response.selectedOptions[0]] || 'Invalid selection';
        }
        return 'No response provided';
      
      case 'rating_scale':
        const maxRating = question.ratingMax != null ? question.ratingMax : 5;
        const ratingLabels = question.ratingLabels || [];
        
        if (response.ratingValue !== null) {
          const ratingIndex = response.ratingValue - (question.ratingMin || 1);
          const ratingLabel = ratingLabels[ratingIndex];
          
          if (ratingLabel) {
            return `${ratingLabel} (${response.ratingValue}/${maxRating})`;
          } else {
            return `${response.ratingValue}/${maxRating}`;
          }
        }
        return 'No rating provided';
      
      case 'checkbox':
        if (response.selectedOptions && response.selectedOptions.length > 0) {
          const options = getQuestionOptions(question);
          return response.selectedOptions
            .map((index: number) => options[index])
            .filter(Boolean)
            .join(', ') || 'Invalid selections';
        }
        return 'No options selected';
      
      default:
        return 'Unknown response type';
    }
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
                Back to Client
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
              {!existingReport ? (
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
                  onClick={() => generateReportMutation.mutate()}
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
                    const reportContent = existingReport?.generatedContent || '';
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
                      new Date(assignment.completedAt).toLocaleDateString() : 
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

        {/* AI Generated Report */}
        {existingReport?.generatedContent && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-green-600" />
                <span>AI Generated Clinical Report</span>
                <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">
                  Professional Report
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose max-w-none">
                <div className="bg-slate-50 p-6 rounded-lg border">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {existingReport.generatedContent}
                  </div>
                </div>
                <div className="flex justify-between items-center mt-4 pt-4 border-t border-slate-200">
                  <div className="text-sm text-slate-600">
                    <div>Generated on {new Date(existingReport.generatedAt).toLocaleDateString()} at {new Date(existingReport.generatedAt).toLocaleTimeString()}</div>
                    {existingReport.id && <div className="text-xs text-slate-500 mt-1">Report ID: #{existingReport.id}</div>}
                  </div>
                  <div className="flex space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => generateReportMutation.mutate()}
                      disabled={generateReportMutation.isPending}
                      className="border-orange-600 text-orange-600 hover:bg-orange-50"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      {generateReportMutation.isPending ? 'Regenerating...' : 'Regenerate'}
                    </Button>
                    <div className="flex space-x-1">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => {
                          // Create a new window with just the report content
                          const reportContent = existingReport?.generatedContent || '';
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
                          // Download as PDF
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
                          // Download as Word
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
                  {section.questions?.map((question, questionIndex) => {
                    const response = sectionResponses.find(r => r.questionId === question.id);
                    
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
    </div>
  );
}