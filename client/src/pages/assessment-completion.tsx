import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";

// Icons
import { 
  ArrowLeft, 
  Save, 
  CheckCircle, 
  AlertCircle,
  ClipboardList,
  User,
  Clock,
  FileText
} from "lucide-react";

// Utils and Types
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AssessmentQuestion {
  id: number;
  sectionId: number;
  questionText: string;
  questionType: 'short_text' | 'long_text' | 'multiple_choice' | 'rating_scale' | 'checkbox' | 'number' | 'date';
  isRequired: boolean;
  options?: string[];
  scoreValues?: number[];
  ratingMin?: number;
  ratingMax?: number;
  ratingLabels?: string[];
  sortOrder: number;
}

interface AssessmentSection {
  id: number;
  templateId: number;
  title: string;
  description?: string;
  accessLevel: string;
  isScoring: boolean;
  sortOrder: number;
  questions: AssessmentQuestion[];
}

interface AssessmentAssignment {
  id: number;
  templateId: number;
  clientId: number;
  assignedById: number;
  status: string;
  template: {
    id: number;
    name: string;
    description: string;
    category: string;
  };
  client: {
    id: number;
    clientId: string;
    fullName: string;
  };
  assignedBy: {
    id: number;
    fullName: string;
  };
  createdAt: string;
}

export default function AssessmentCompletionPage() {
  const [match, params] = useRoute("/assessments/:assignmentId/complete");
  const [, setLocation] = useLocation();
  const assignmentId = params?.assignmentId ? parseInt(params.assignmentId) : null;
  
  const [responses, setResponses] = useState<Record<number, any>>({});
  const [currentSection, setCurrentSection] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch assessment assignment details
  const { data: assignment, isLoading: assignmentLoading } = useQuery({
    queryKey: [`/api/assessments/assignments/${assignmentId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });

  // Fetch assessment template with sections and questions
  const { data: sections = [], isLoading: sectionsLoading } = useQuery({
    queryKey: [`/api/assessments/templates/${assignment?.templateId}/sections`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignment?.templateId,
  });

  // Fetch existing responses if any
  const { data: existingResponses = [] } = useQuery({
    queryKey: [`/api/assessments/assignments/${assignmentId}/responses`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });

  // Load existing responses into state (only when initially empty)
  useEffect(() => {
    if (existingResponses.length > 0 && Object.keys(responses).length === 0) {
      const responseMap: Record<number, any> = {};
      existingResponses.forEach((response: any) => {
        // Handle selectedOptions - database may return as JSON array or null
        let selectedOptions = response.selectedOptions;
        if (selectedOptions) {
          // If it's already an array, use it directly
          if (Array.isArray(selectedOptions)) {
            selectedOptions = selectedOptions.map((val: any) => parseInt(val));
          } else {
            // Handle other formats by parsing as array
            selectedOptions = [];
          }
        } else {
          selectedOptions = [];
        }
        
        responseMap[response.questionId] = {
          responseText: response.responseText || '',
          selectedOptions: selectedOptions,
          ratingValue: response.ratingValue
        };
      });
      setResponses(responseMap);
    }
  }, [existingResponses]);

  // Auto-save functionality - save responses every 30 seconds
  useEffect(() => {
    if (Object.keys(responses).length === 0) return; // Don't auto-save if no responses

    const autoSaveInterval = setInterval(() => {
      Object.keys(responses).forEach((questionId) => {
        saveResponse(parseInt(questionId));
      });
    }, 30000); // Save every 30 seconds

    return () => clearInterval(autoSaveInterval);
  }, [responses]);

  // Save progress on page unload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Save all current responses
      Object.keys(responses).forEach((questionId) => {
        saveResponse(parseInt(questionId));
      });
      
      // Show warning if there are unsaved changes
      if (Object.keys(responses).length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Save response mutation
  const saveResponseMutation = useMutation({
    mutationFn: async (responseData: any) => {
      return apiRequest("/api/assessments/responses", "POST", responseData);
    },
    onSuccess: () => {
      // Don't immediately invalidate queries to prevent UI flicker
      // queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/responses`] });
    }
  });

  // Complete assessment mutation
  const completeAssessmentMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      return apiRequest(`/api/assessments/assignments/${assignmentId}`, "PATCH", {
        status: 'completed',
        completedAt: now,
        therapistCompletedAt: now
      });
    },
    onSuccess: () => {
      toast({
        title: "Assessment completed",
        description: "The assessment has been completed successfully.",
      });
      setLocation(`/assessments/${assignmentId}/report`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to complete assessment",
        variant: "destructive",
      });
    }
  });

  // Generate AI report mutation
  const generateReportMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/assessments/assignments/${assignmentId}/generate-report`, "POST", {});
    },
    onSuccess: (report) => {
      toast({
        title: "AI Report Generated",
        description: "Professional assessment report has been created successfully.",
      });
      // Navigate to the report view
      setLocation(`/assessments/${assignmentId}/report`);
    },
    onError: (error) => {
      toast({
        title: "Report Generation Failed",
        description: "There was an error generating the assessment report. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleResponseChange = (questionId: number, value: any, type: string) => {
    setResponses(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        [type]: value
      }
    }));
  };

  const saveResponse = async (questionId: number) => {
    const response = responses[questionId];
    if (!response) return;

    // Only save if there's actually some data
    const hasData = response.responseText || 
                   (response.selectedOptions && response.selectedOptions.length > 0) || 
                   response.ratingValue;
    
    if (!hasData) return; // Don't save empty responses

    try {
      await saveResponseMutation.mutateAsync({
        assignmentId,
        questionId,
        responderId: 17, // Valid therapist ID - Abi Cherian
        responseText: response.responseText || null,
        selectedOptions: (response.selectedOptions && response.selectedOptions.length > 0) ? response.selectedOptions : null,
        ratingValue: response.ratingValue || null
      });
    } catch (error) {
      console.error('Failed to save response:', error);
    }
  };

  const handleCompleteAssessment = () => {
    completeAssessmentMutation.mutate();
  };

  const handleGenerateReport = () => {
    generateReportMutation.mutate();
  };

  const renderQuestion = (question: AssessmentQuestion) => {
    const response = responses[question.id] || {};

    switch (question.questionType) {
      case 'short_text':
        return (
          <Input
            value={response.responseText || ''}
            onChange={(e) => handleResponseChange(question.id, e.target.value, 'responseText')}
            onBlur={() => saveResponse(question.id)}
            placeholder="Enter your response..."
            className="w-full"
          />
        );

      case 'long_text':
        return (
          <Textarea
            value={response.responseText || ''}
            onChange={(e) => handleResponseChange(question.id, e.target.value, 'responseText')}
            onBlur={() => saveResponse(question.id)}
            placeholder="Enter your detailed response..."
            rows={4}
            className="w-full"
          />
        );

      case 'multiple_choice':
        return (
          <RadioGroup
            value={response.selectedOptions?.[0]?.toString() || ''}
            onValueChange={(value) => {
              handleResponseChange(question.id, [parseInt(value)], 'selectedOptions');
              setTimeout(() => saveResponse(question.id), 100);
            }}
          >
            {question.options?.map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <RadioGroupItem value={index.toString()} id={`q${question.id}_${index}`} />
                <Label htmlFor={`q${question.id}_${index}`}>{option}</Label>
              </div>
            ))}
          </RadioGroup>
        );

      case 'rating_scale':
        // Use the template's rating scale configuration, defaulting to 1-5 if not set
        const ratingMin = question.ratingMin != null ? question.ratingMin : 1;
        const ratingMax = question.ratingMax != null ? question.ratingMax : 5;
        const ratingLabels = question.ratingLabels || [];
        
        return (
          <div className="space-y-3">
            {/* Only show range indicators if no individual labels are available */}
            {ratingLabels.length === 0 && (
              <div className="flex justify-between text-sm text-slate-600">
                <span>{ratingMin}</span>
                <span>{ratingMax}</span>
              </div>
            )}
            <RadioGroup
              value={response.ratingValue?.toString() || ''}
              onValueChange={(value) => {
                handleResponseChange(question.id, parseInt(value), 'ratingValue');
                setTimeout(() => saveResponse(question.id), 300);
              }}
              className="flex justify-between"
            >
              {Array.from({ length: ratingMax - ratingMin + 1 }, (_, i) => ratingMin + i).map((value, index) => (
                <div key={value} className="flex flex-col items-center space-y-2">
                  <RadioGroupItem value={value.toString()} id={`q${question.id}_${value}`} />
                  <Label htmlFor={`q${question.id}_${value}`} className="text-xs text-center max-w-16">
                    {ratingLabels[index] || value}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        );

      case 'checkbox':
        return (
          <div className="space-y-2">
            {question.options?.map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <Checkbox
                  id={`q${question.id}_${index}`}
                  checked={response.selectedOptions?.includes(index) || false}
                  onCheckedChange={(checked) => {
                    const currentOptions = response.selectedOptions || [];
                    const newOptions = checked
                      ? [...currentOptions, index]
                      : currentOptions.filter((opt: number) => opt !== index);
                    handleResponseChange(question.id, newOptions, 'selectedOptions');
                    // Debounced save with longer delay to prevent too many API calls
                    setTimeout(() => saveResponse(question.id), 500);
                  }}
                />
                <Label htmlFor={`q${question.id}_${index}`}>{option}</Label>
              </div>
            ))}
          </div>
        );

      case 'number':
        return (
          <Input
            type="number"
            value={response.responseText || ''}
            onChange={(e) => handleResponseChange(question.id, e.target.value, 'responseText')}
            onBlur={() => saveResponse(question.id)}
            placeholder="Enter a number..."
            className="w-full"
          />
        );

      case 'date':
        return (
          <Input
            type="date"
            value={response.responseText || ''}
            onChange={(e) => handleResponseChange(question.id, e.target.value, 'responseText')}
            onBlur={() => saveResponse(question.id)}
            className="w-full"
          />
        );

      default:
        return <div>Unsupported question type: {question.questionType}</div>;
    }
  };

  if (assignmentLoading || sectionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading assessment...</p>
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

  const currentSectionData = sections[currentSection];
  const totalQuestions = sections.reduce((acc, section) => acc + (section.questions?.length || 0), 0);
  const completedQuestions = Object.keys(responses).length;
  const progressPercentage = totalQuestions > 0 ? (completedQuestions / totalQuestions) * 100 : 0;

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
                <h1 className="text-2xl font-bold text-slate-900">{assignment.template.name}</h1>
                <p className="text-slate-600">Assessment for {assignment.client.fullName}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-slate-600">Progress</div>
                <div className="text-lg font-semibold text-slate-900">
                  {completedQuestions}/{totalQuestions} questions
                </div>
              </div>
              <div className="w-32">
                <Progress value={progressPercentage} className="h-2" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Assessment Info */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                <Clock className="w-5 h-5 text-purple-600" />
                <div>
                  <div className="text-sm text-slate-600">Assigned</div>
                  <div className="font-semibold">{new Date(assignment.createdAt).toLocaleDateString()}</div>
                  <div className="text-sm text-slate-500">by {assignment.assignedBy.fullName}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section Navigation */}
        {sections.length > 1 && (
          <div className="flex space-x-2 mb-6 overflow-x-auto">
            {sections.map((section, index) => (
              <Button
                key={section.id}
                variant={currentSection === index ? "default" : "outline"}
                size="sm"
                onClick={() => setCurrentSection(index)}
                className="whitespace-nowrap"
              >
                {index + 1}. {section.title}
              </Button>
            ))}
          </div>
        )}

        {/* Current Section */}
        {currentSectionData && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <span>Section {currentSection + 1}: {currentSectionData.title}</span>
              </CardTitle>
              {currentSectionData.description && (
                <p className="text-slate-600">{currentSectionData.description}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-8">
              {currentSectionData.questions?.map((question, questionIndex) => (
                <div key={question.id} className="space-y-3">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
                      {questionIndex + 1}
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <Label className="text-base font-medium text-slate-900">
                          {question.questionText}
                          {question.isRequired && <span className="text-red-500 ml-1">*</span>}
                        </Label>
                      </div>
                      {renderQuestion(question)}
                    </div>
                  </div>
                  {questionIndex < (currentSectionData.questions?.length || 0) - 1 && (
                    <Separator className="my-6" />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8">
          <div className="flex space-x-2">
            {currentSection > 0 && (
              <Button
                variant="outline"
                onClick={() => setCurrentSection(currentSection - 1)}
              >
                Previous Section
              </Button>
            )}
          </div>
          
          <div className="flex space-x-2">
            <Button 
              variant="outline"
              onClick={() => {
                Object.keys(responses).forEach((questionId) => {
                  saveResponse(parseInt(questionId));
                });
                toast({
                  title: "Progress saved",
                  description: "Your responses have been saved. You can continue later.",
                });
              }}
              disabled={saveResponseMutation.isPending}
            >
              <Save className="w-4 h-4 mr-2" />
              {saveResponseMutation.isPending ? 'Saving...' : 'Save Progress'}
            </Button>
            
            {currentSection < sections.length - 1 ? (
              <Button
                onClick={() => setCurrentSection(currentSection + 1)}
              >
                Next Section
              </Button>
            ) : (
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  onClick={handleGenerateReport}
                  disabled={generateReportMutation.isPending}
                  className="border-blue-600 text-blue-600 hover:bg-blue-50"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {generateReportMutation.isPending ? 'Generating...' : 'Generate AI Report'}
                </Button>
                <Button
                  onClick={handleCompleteAssessment}
                  disabled={isSubmitting || completeAssessmentMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Complete Assessment
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}