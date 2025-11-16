import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { format } from "date-fns";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Icons
import { 
  ArrowLeft, 
  Save, 
  CheckCircle, 
  AlertCircle,
  ClipboardList,
  User,
  Clock,
  FileText,
  Edit,
  HelpCircle,
  ChevronDown,
  Mic
} from "lucide-react";

// Utils and Types
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { AssessmentVoiceRecorder } from "@/components/assessment-voice-recorder";
import { AssessmentSectionSummary } from "@/components/assessment-section-summary";

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
  allOptions?: Array<{ id: number; optionText: string; optionValue: string | number; sortOrder: number }>;
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
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [showNextStepsDialog, setShowNextStepsDialog] = useState(false);
  const [isSectionLoading, setIsSectionLoading] = useState(false);
  const [activeVoiceRecorder, setActiveVoiceRecorder] = useState<number | null>(null);
  const [showSummaryDialog, setShowSummaryDialog] = useState(false);
  const initialLoadDone = useRef(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  // Fetch assessment assignment details
  const { data: assignment, isLoading: assignmentLoading } = useQuery<AssessmentAssignment>({
    queryKey: [`/api/assessments/assignments/${assignmentId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
  });

  // Fetch assessment template with sections and questions
  const { data: sections = [], isLoading: sectionsLoading } = useQuery<AssessmentSection[]>({
    queryKey: [`/api/assessments/templates/${assignment?.templateId}/sections`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignment?.templateId,
  });
  

  // Fetch existing responses if any
  const { data: existingResponses = [], isLoading: responsesLoading } = useQuery<any[]>({
    queryKey: [`/api/assessments/assignments/${assignmentId}/responses`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!assignmentId,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    staleTime: Infinity,
  });

  // Track when we should reload from server (after saves complete)
  const shouldReloadFromServer = useRef(false);

  // Load existing responses into state
  // Only on initial load OR after a save completes
  useEffect(() => {
    if (existingResponses.length === 0) return;
    
    // Only update state if:
    // 1. Initial load (first time), OR
    // 2. After a save completes (shouldReloadFromServer flag is true)
    if (!initialLoadDone.current || shouldReloadFromServer.current) {
      console.log('🔄 Loading responses from server', { 
        initialLoad: !initialLoadDone.current, 
        afterSave: shouldReloadFromServer.current,
        count: existingResponses.length 
      });
      
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
          selectedOptions = null; // Keep as null instead of empty array for radio buttons
        }
        
        responseMap[response.questionId] = {
          responseText: response.responseText || '',
          selectedOptions: selectedOptions,
          ratingValue: response.ratingValue
        };
      });
      
      console.log('✅ Responses loaded into state', { questionIds: Object.keys(responseMap) });
      setResponses(responseMap);
      initialLoadDone.current = true;
      shouldReloadFromServer.current = false; // Reset the flag
    } else {
      console.log('⏭️ Skipping response reload (not initial load or after save)');
    }
  }, [existingResponses]);

  // Batch save state - collect responses to save together
  const pendingSaves = useRef<Set<number>>(new Set());
  const batchSaveTimer = useRef<NodeJS.Timeout | null>(null);

  // Batch save mutation - saves multiple responses at once
  const batchSaveMutation = useMutation({
    mutationFn: async (responsesData: any[]) => {
      return apiRequest("/api/assessments/responses/batch", "POST", { responses: responsesData });
    },
    onSuccess: () => {
      // Mark that we should reload from server on next data fetch
      shouldReloadFromServer.current = true;
      // Invalidate cache to trigger refetch
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/responses`] });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}`] });
      pendingSaves.current.clear();
    }
  });

  // Save response mutation (fallback for single saves)
  const saveResponseMutation = useMutation({
    mutationFn: async (responseData: any) => {
      return apiRequest("/api/assessments/responses", "POST", responseData);
    },
    onSuccess: () => {
      // Mark that we should reload from server on next data fetch
      shouldReloadFromServer.current = true;
      // Invalidate queries to refresh data after save
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}/responses`] });
      queryClient.invalidateQueries({ queryKey: [`/api/assessments/assignments/${assignmentId}`] });
    }
  });

  // Trigger batch save with debouncing
  const triggerBatchSave = () => {
    // Clear existing timer
    if (batchSaveTimer.current) {
      clearTimeout(batchSaveTimer.current);
    }

    // Set new timer to batch saves
    batchSaveTimer.current = setTimeout(() => {
      if (pendingSaves.current.size === 0) return;

      // Collect all pending responses
      const responsesToSave = Array.from(pendingSaves.current)
        .map(questionId => {
          const response = responses[questionId];
          if (!response) return null;

          // Only include if there's actual data
          const hasData = response.responseText || 
                         (response.selectedOptions && response.selectedOptions.length > 0) || 
                         response.ratingValue !== null;
          
          if (!hasData) return null;

          return {
            assignmentId,
            questionId,
            responderId: user?.id,
            responseText: response.responseText || null,
            selectedOptions: (response.selectedOptions && response.selectedOptions.length > 0) ? response.selectedOptions : null,
            ratingValue: response.ratingValue || null
          };
        })
        .filter(Boolean);

      if (responsesToSave.length > 0) {
        batchSaveMutation.mutate(responsesToSave);
      } else {
        pendingSaves.current.clear();
      }
    }, 1000); // Wait 1 second to batch multiple changes
  };

  // Auto-save functionality - save responses every 30 seconds
  useEffect(() => {
    if (Object.keys(responses).length === 0) return;

    const autoSaveInterval = setInterval(() => {
      // Add all responses to pending saves
      Object.keys(responses).forEach((questionId) => {
        pendingSaves.current.add(parseInt(questionId));
      });
      // Trigger immediate batch save
      if (batchSaveTimer.current) {
        clearTimeout(batchSaveTimer.current);
      }
      triggerBatchSave();
    }, 30000); // Every 30 seconds

    return () => clearInterval(autoSaveInterval);
  }, [responses]);

  // Save progress on page unload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Trigger immediate save on unload
      if (pendingSaves.current.size > 0 && batchSaveTimer.current) {
        clearTimeout(batchSaveTimer.current);
        triggerBatchSave();
      }
      
      // Show warning if there are unsaved changes
      if (Object.keys(responses).length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Note: Completing questions does NOT finalize the assessment
  // Status changes only happen when:
  // 1. Generate Report → changes to 'waiting_for_therapist'
  // 2. Finalize Report → changes to 'completed'

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

  const saveResponse = (questionId: number) => {
    const response = responses[questionId];
    if (!response) return;

    // Only save if there's actually some data
    const hasData = response.responseText || 
                   (response.selectedOptions && response.selectedOptions.length > 0) || 
                   response.ratingValue !== null;
    
    if (!hasData) return; // Don't save empty responses

    // Validate user is authenticated
    if (!user?.id) {
      toast({
        title: "Authentication required",
        description: "Please log in to save responses.",
        variant: "destructive"
      });
      return;
    }

    // Add to pending saves and trigger batch save
    pendingSaves.current.add(questionId);
    triggerBatchSave();
  };

  // Calculate completion stats
  const getCompletionStats = () => {
    const allQuestions = sections.flatMap((s: any) => s.questions || []);
    const totalQuestions = allQuestions.length;
    const answeredQuestions = allQuestions.filter((q: any) => {
      const response = responses[q.id];
      return response && (
        response.responseText || 
        (response.selectedOptions && response.selectedOptions.length > 0) || 
        response.ratingValue !== null && response.ratingValue !== undefined
      );
    }).length;
    const unansweredRequired = allQuestions.filter((q: any) => {
      const response = responses[q.id];
      const hasResponse = response && (
        response.responseText || 
        (response.selectedOptions && response.selectedOptions.length > 0) || 
        response.ratingValue !== null && response.ratingValue !== undefined
      );
      return q.isRequired && !hasResponse;
    });
    
    return {
      total: totalQuestions,
      answered: answeredQuestions,
      skipped: totalQuestions - answeredQuestions,
      unansweredRequired
    };
  };

  const handleCompleteAssessment = () => {
    setShowCompletionDialog(true);
  };

  const confirmComplete = () => {
    setShowCompletionDialog(false);
    // Just show next steps dialog - status stays as 'therapist_completed'
    setShowNextStepsDialog(true);
  };

  const handleGenerateReport = () => {
    generateReportMutation.mutate();
  };

  const handleEditSection = (sectionIndex: number) => {
    setShowSummaryDialog(false);
    setCurrentSection(sectionIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleShowSummary = async () => {
    // Save all responses before showing summary
    setIsSectionLoading(true);
    const savePromises = Object.keys(responses).map((questionId) => 
      saveResponse(parseInt(questionId))
    );
    await Promise.all(savePromises);
    setShowSummaryDialog(true);
    setTimeout(() => setIsSectionLoading(false), 300);
  };

  const handleVoiceTranscription = (questionId: number, transcribedText: string) => {
    // Update the response with transcribed text
    handleResponseChange(questionId, transcribedText, 'responseText');
    
    // Save the response
    setTimeout(() => {
      saveResponse(questionId);
    }, 100);
    
    // Close the voice recorder
    setActiveVoiceRecorder(null);
    
    toast({
      title: "Voice transcribed",
      description: "Text has been added to the field",
    });
  };

  const renderQuestion = (question: AssessmentQuestion) => {
    const response = responses[question.id] || {};
    const isVoiceRecorderActive = activeVoiceRecorder === question.id;

    switch (question.questionType) {
      case 'short_text':
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={response.responseText || ''}
                onChange={(e) => handleResponseChange(question.id, e.target.value, 'responseText')}
                onBlur={() => saveResponse(question.id)}
                placeholder="Enter your response..."
                className="flex-1"
                data-testid={`input-question-${question.id}`}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setActiveVoiceRecorder(isVoiceRecorderActive ? null : question.id)}
                data-testid={`button-voice-${question.id}`}
              >
                <Mic className="w-4 h-4" />
              </Button>
            </div>
            {isVoiceRecorderActive && (
              <AssessmentVoiceRecorder
                questionId={question.id}
                onTranscriptionComplete={(text) => handleVoiceTranscription(question.id, text)}
                onCancel={() => setActiveVoiceRecorder(null)}
              />
            )}
          </div>
        );

      case 'long_text':
        return (
          <div className="space-y-2">
            <div className="flex gap-2 items-start">
              <Textarea
                value={response.responseText || ''}
                onChange={(e) => handleResponseChange(question.id, e.target.value, 'responseText')}
                onBlur={() => saveResponse(question.id)}
                placeholder="Enter your detailed response..."
                rows={4}
                className="flex-1"
                data-testid={`textarea-question-${question.id}`}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setActiveVoiceRecorder(isVoiceRecorderActive ? null : question.id)}
                data-testid={`button-voice-${question.id}`}
              >
                <Mic className="w-4 h-4" />
              </Button>
            </div>
            {isVoiceRecorderActive && (
              <AssessmentVoiceRecorder
                questionId={question.id}
                onTranscriptionComplete={(text) => handleVoiceTranscription(question.id, text)}
                onCancel={() => setActiveVoiceRecorder(null)}
              />
            )}
          </div>
        );

      case 'multiple_choice':
        // Use allOptions from database (includes option IDs) for proper response saving
        const allOptions = question.allOptions || [];
        
        // If allOptions is available from database, use it (this is the preferred path)
        if (allOptions.length > 0) {
          return (
            <RadioGroup
              value={response.selectedOptions?.[0]?.toString() || ''}
              onValueChange={(value) => {
                handleResponseChange(question.id, [parseInt(value)], 'selectedOptions');
                setTimeout(() => saveResponse(question.id), 100);
              }}
            >
              {allOptions.map((option) => (
                <div key={option.id} className="flex items-center space-x-2">
                  <RadioGroupItem value={option.id.toString()} id={`q${question.id}_${option.id}`} />
                  <Label htmlFor={`q${question.id}_${option.id}`}>{option.optionText}</Label>
                </div>
              ))}
            </RadioGroup>
          );
        }
        
        // FALLBACK ONLY: For legacy questions without database options
        let questionOptions = question.options;
        
        if (!questionOptions || questionOptions.length === 0) {
          // Special handling for session format question
          if (question.questionText.toLowerCase().includes('session format')) {
            questionOptions = ['In-Person', 'Online', 'Phone'];
          } 
          // BDI-II Items - ALL 21 items with exact options from the PDF
          else if (question.questionText?.toLowerCase().includes('sadness')) {
            questionOptions = ['I do not feel sad.', 'I feel sad much of the time.', 'I am sad all the time.', "I am so sad or unhappy that I can't stand it."];
          }
          else if (question.questionText?.toLowerCase().includes('pessimism')) {
            questionOptions = ['I am not discouraged about my future.', 'I feel more discouraged about my future than I used to be.', 'I do not expect things to work out for me.', 'I feel my future is hopeless and will only get worse.'];
          }
          else if (question.questionText?.toLowerCase().includes('past failure')) {
            questionOptions = ['I do not feel like a failure.', 'I have failed more than I should have.', 'As I look back, I see a lot of failures.', 'I feel I am a total failure as a person.'];
          }
          else if (question.questionText?.toLowerCase().includes('loss of pleasure')) {
            questionOptions = ['I get as much pleasure as I ever did from the things I enjoy.', "I don't enjoy things as much as I used to.", 'I get very little pleasure from the things I used to enjoy.', "I can't get any pleasure from the things I used to enjoy."];
          }
          else if (question.questionText?.toLowerCase().includes('guilty feelings')) {
            questionOptions = ["I don't feel particularly guilty.", 'I feel guilty over many things I have done or should have done.', 'I feel quite guilty most of the time.', 'I feel guilty all of the time.'];
          }
          else if (question.questionText?.toLowerCase().includes('punishment feelings')) {
            questionOptions = ["I don't feel I am being punished.", 'I feel I may be punished.', 'I expect to be punished.', 'I feel I am being punished.'];
          }
          else if (question.questionText?.toLowerCase().includes('self-dislike')) {
            questionOptions = ['I feel the same about myself as ever.', 'I have lost confidence in myself.', 'I am disappointed in myself.', 'I dislike myself.'];
          }
          else if (question.questionText?.toLowerCase().includes('self-criticalness')) {
            questionOptions = ["I don't criticize or blame myself more than usual.", 'I am more critical of myself than I used to be.', 'I criticize myself for all of my faults.', 'I blame myself for everything bad that happens.'];
          }
          else if (question.questionText?.toLowerCase().includes('suicidal thoughts')) {
            questionOptions = ["I don't have any thoughts of killing myself.", 'I have thoughts of killing myself, but I would not carry them out.', 'I would like to kill myself.', 'I would kill myself if I had the chance.'];
          }
          else if (question.questionText?.toLowerCase().includes('crying')) {
            questionOptions = ["I don't cry anymore than I used to.", 'I cry more than I used to.', 'I cry over every little thing.', "I feel like crying, but I can't."];
          }
          else if (question.questionText?.toLowerCase().includes('agitation')) {
            questionOptions = ['I am no more restless or wound up than usual.', 'I feel more restless or wound up than usual.', "I am so restless or agitated that it's hard to stay still.", 'I am so restless or agitated that I have to keep moving or doing something.'];
          }
          else if (question.questionText?.toLowerCase().includes('loss of interest')) {
            questionOptions = ['I have not lost interest in other people or activities.', 'I am less interested in other people or things than before.', 'I have lost most of my interest in other people or things.', "It's hard to get interested in anything."];
          }
          else if (question.questionText?.toLowerCase().includes('indecisiveness')) {
            questionOptions = ['I make decisions about as well as ever.', 'I find it more difficult to make decisions than usual.', 'I have much greater difficulty in making decisions than I used to.', 'I have trouble making any decisions.'];
          }
          else if (question.questionText?.toLowerCase().includes('worthlessness')) {
            questionOptions = ['I do not feel I am worthless.', "I don't consider myself as worthwhile and useful as I used to.", 'I feel more worthless as compared to other people.', 'I feel utterly worthless.'];
          }
          else if (question.questionText?.toLowerCase().includes('loss of energy')) {
            questionOptions = ['I have as much energy as ever.', 'I have less energy than I used to have.', "I don't have enough energy to do very much.", "I don't have enough energy to do anything."];
          }
          else if (question.questionText?.toLowerCase().includes('changes in sleeping')) {
            questionOptions = ['I have not experienced any change in my sleeping pattern.', 'I sleep somewhat more than usual / I sleep somewhat less than usual.', 'I sleep a lot more than usual / I sleep a lot less than usual.', 'I sleep most of the day / I wake up 1-2 hours early and can\'t get back to sleep.'];
          }
          else if (question.questionText?.toLowerCase().includes('irritability')) {
            questionOptions = ['I am no more irritable than usual.', 'I am more irritable than usual.', 'I am much more irritable than usual.', 'I am irritable all the time.'];
          }
          else if (question.questionText?.toLowerCase().includes('changes in appetite')) {
            questionOptions = ['I have not experienced any change in my appetite.', 'My appetite is somewhat less than usual / My appetite is somewhat greater than usual.', 'My appetite is much less than before / My appetite is much greater than usual.', 'I have no appetite at all / I crave food all the time.'];
          }
          else if (question.questionText?.toLowerCase().includes('concentration')) {
            questionOptions = ['I can concentrate as well as ever.', "I can't concentrate as well as usual.", "It's hard to keep my mind on anything for very long.", "I find I can't concentrate on anything."];
          }
          else if (question.questionText?.toLowerCase().includes('tiredness') || question.questionText?.toLowerCase().includes('fatigue')) {
            questionOptions = ['I am no more tired or fatigued than usual.', 'I get more tired or fatigued more easily than usual.', 'I am too tired or fatigued to do a lot of the things I used to do.', 'I am too tired or fatigued to do most of the things I used to do.'];
          }
          else if (question.questionText?.toLowerCase().includes('loss of interest in sex')) {
            questionOptions = ['I have not noticed any recent change in my interest in sex.', 'I am less interested in sex than I used to be.', 'I am much less interested in sex now.', 'I have lost interest in sex completely.'];
          }
          // Most other multiple choice questions appear to be Yes/No questions
          else {
            questionOptions = ['Yes', 'No'];
          }
        }
        
        // WARNING: This fallback path uses array indices as option IDs
        // This will not properly match saved responses that have real database IDs
        console.warn(`Question ${question.id} missing database options (allOptions), using fallback with indices`);
        
        return (
          <RadioGroup
            value={response.selectedOptions?.[0]?.toString() || ''}
            onValueChange={(value) => {
              handleResponseChange(question.id, [parseInt(value)], 'selectedOptions');
              setTimeout(() => saveResponse(question.id), 100);
            }}
          >
            {questionOptions.map((option, index) => (
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
        // Use allOptions from database (includes option IDs) for proper response saving
        const checkboxAllOptions = question.allOptions || [];
        
        // If allOptions is available from database, use it (this is the preferred path)
        if (checkboxAllOptions.length > 0) {
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
              {checkboxAllOptions.map((option) => {
                // Ensure both option.id and selectedOptions items are numbers for comparison
                const optionId = typeof option.id === 'string' ? parseInt(option.id) : option.id;
                const selectedIds = (response.selectedOptions || []).map((id: any) => typeof id === 'string' ? parseInt(id) : id);
                
                return (
                  <div key={option.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`q${question.id}_${option.id}`}
                      checked={selectedIds.includes(optionId)}
                      onCheckedChange={(checked) => {
                        console.log('📝 Checkbox changed', { 
                          questionId: question.id, 
                          optionId, 
                          checked, 
                          currentOptions: selectedIds 
                        });
                        const currentOptions = selectedIds;
                        const newOptions = checked
                          ? [...currentOptions, optionId]
                          : currentOptions.filter((opt: number) => opt !== optionId);
                        console.log('💾 Updating local state with new options:', newOptions);
                        handleResponseChange(question.id, newOptions, 'selectedOptions');
                        setTimeout(() => saveResponse(question.id), 500);
                      }}
                    />
                    <Label htmlFor={`q${question.id}_${option.id}`}>{option.optionText}</Label>
                  </div>
                );
              })}
            </div>
          );
        }
        
        // FALLBACK ONLY: For legacy questions without database options
        let checkboxOptions = question.options;
        
        if (!checkboxOptions || checkboxOptions.length === 0) {
          // Provide sensible defaults based on question text
          if (question.questionText.toLowerCase().includes('psychological tools') || question.questionText.toLowerCase().includes('which psychological')) {
            checkboxOptions = ['Clinical Interview', 'Questionnaires', 'Standardized Tests', 'Behavioral Observation', 'Other'];
          } else if (question.questionText.toLowerCase().includes('physical concerns') || question.questionText.toLowerCase().includes('physical')) {
            checkboxOptions = ['Headaches', 'Sleep problems', 'Fatigue', 'Appetite changes', 'Muscle tension', 'Other physical symptoms'];
          } else if (question.questionText.toLowerCase().includes('emotional concerns') || question.questionText.toLowerCase().includes('emotional')) {
            checkboxOptions = ['Anxiety', 'Depression', 'Anger', 'Fear', 'Sadness', 'Feeling overwhelmed'];
          } else if (question.questionText.toLowerCase().includes('social') || question.questionText.toLowerCase().includes('relational')) {
            checkboxOptions = ['Isolation', 'Relationship conflicts', 'Communication difficulties', 'Trust issues', 'Cultural adjustment'];
          } else if (question.questionText.toLowerCase().includes('cognitive') || question.questionText.toLowerCase().includes('thinking')) {
            checkboxOptions = ['Memory problems', 'Concentration difficulties', 'Confusion', 'Racing thoughts', 'Negative thinking'];
          } else if (question.questionText.toLowerCase().includes('medical conditions') || question.questionText.toLowerCase().includes('chronic')) {
            checkboxOptions = ['Diabetes', 'Heart disease', 'High blood pressure', 'Arthritis', 'Other chronic condition'];
          } else if (question.questionText.toLowerCase().includes('trauma') || question.questionText.toLowerCase().includes('migration') || question.questionText.toLowerCase().includes('stressors')) {
            checkboxOptions = ['Violence', 'Loss of family/friends', 'Economic hardship', 'Discrimination', 'Language barriers', 'Cultural conflicts'];
          } else {
            // Default checkbox options for other questions
            checkboxOptions = ['Yes', 'No', 'Not applicable'];
          }
        }
        
        // WARNING: This fallback path uses array indices as option IDs
        // This will not properly match saved responses that have real database IDs
        console.warn(`Question ${question.id} missing database options (allOptions), using fallback with indices`);
        
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            {checkboxOptions.map((option, index) => (
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                  <div className="font-semibold">{format(new Date(assignment.createdAt), 'MMM dd, yyyy')}</div>
                  <div className="text-sm text-slate-500">by {assignment.assignedBy.fullName}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inline Assessment Help - Step Indicator Style */}
        <Collapsible defaultOpen={true} className="mb-6">
          <Card className="border-blue-200 bg-blue-50">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-blue-100 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-base">Assessment Navigation - Section {currentSection + 1} of {sections.length}</CardTitle>
                  </div>
                  <ChevronDown className="w-5 h-5 text-blue-600" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                  <div>
                    <p className="font-medium text-sm">Answer Questions</p>
                    <p className="text-xs text-gray-600">Complete each question in the current section you're viewing. Your progress auto-saves every 30 seconds and when you move between sections. Required questions are marked with an asterisk (*).</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                  <div>
                    <p className="font-medium text-sm">Navigate Sections</p>
                    <p className="text-xs text-gray-600">Click the section tabs above to move between different parts. Each assessment has its own number of sections. The progress bar shows your overall completion percentage across all sections in this assessment.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                  <div>
                    <p className="font-medium text-sm">Submit or Save</p>
                    <p className="text-xs text-gray-600">When done with all sections, click "Submit Assessment" at the bottom. Your therapist gets notified to review. Not ready? Click "Save Progress" to continue later - all your answers are preserved.</p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                  <p className="text-xs text-blue-900">
                    <strong>💡 Pro Tip:</strong> Auto-save runs every 30 seconds and when navigating sections. You can safely close the page anytime and return to continue where you left off - no progress is lost.
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section Navigation */}
            {sections.length > 1 && (
              <div className="flex space-x-2 mb-6 overflow-x-auto">
                {sections.map((section, index) => (
                  <Button
                    key={section.id}
                    variant={currentSection === index ? "default" : "outline"}
                    size="sm"
                    onClick={async () => {
                      if (currentSection !== index) {
                        // Save all current responses before switching sections
                        setIsSectionLoading(true);
                        const savePromises = Object.keys(responses).map((questionId) => 
                          saveResponse(parseInt(questionId))
                        );
                        await Promise.all(savePromises);
                        setCurrentSection(index);
                        setTimeout(() => setIsSectionLoading(false), 300);
                      }
                    }}
                    className="whitespace-nowrap"
                    disabled={isSectionLoading}
                  >
                    {index + 1}. {section.title}
                  </Button>
                ))}
              </div>
            )}

            {/* Current Section */}
            {currentSectionData && (
          <Card className={isSectionLoading ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <span>Section {currentSection + 1}: {currentSectionData.title}</span>
                {isSectionLoading && (
                  <span className="text-sm text-blue-600 font-normal ml-2">(Saving...)</span>
                )}
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
                onClick={async () => {
                  // Save before going to previous section
                  setIsSectionLoading(true);
                  const savePromises = Object.keys(responses).map((questionId) => 
                    saveResponse(parseInt(questionId))
                  );
                  await Promise.all(savePromises);
                  setCurrentSection(currentSection - 1);
                  setTimeout(() => setIsSectionLoading(false), 300);
                }}
                disabled={isSectionLoading}
              >
                Previous Section
              </Button>
            )}
          </div>
          
          <div className="flex space-x-2">
            <Button 
              variant="outline"
              onClick={async () => {
                const savePromises = Object.keys(responses).map((questionId) => 
                  saveResponse(parseInt(questionId))
                );
                await Promise.all(savePromises);
                toast({
                  title: "Progress saved",
                  description: "Your responses have been saved. You can continue later.",
                });
              }}
              disabled={saveResponseMutation.isPending || isSectionLoading}
            >
              <Save className="w-4 h-4 mr-2" />
              {saveResponseMutation.isPending ? 'Saving...' : 'Save Progress'}
            </Button>
            
            {currentSection < sections.length - 1 ? (
              <Button
                onClick={async () => {
                  // Save before going to next section
                  setIsSectionLoading(true);
                  const savePromises = Object.keys(responses).map((questionId) => 
                    saveResponse(parseInt(questionId))
                  );
                  await Promise.all(savePromises);
                  setCurrentSection(currentSection + 1);
                  setTimeout(() => setIsSectionLoading(false), 300);
                }}
                disabled={isSectionLoading}
              >
                {isSectionLoading ? 'Saving...' : 'Next Section'}
              </Button>
            ) : (
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  onClick={handleShowSummary}
                  disabled={isSectionLoading}
                  className="border-purple-600 text-purple-600 hover:bg-purple-50"
                  data-testid="button-review-summary"
                >
                  <ClipboardList className="w-4 h-4 mr-2" />
                  {isSectionLoading ? 'Saving...' : 'Review Summary'}
                </Button>
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
                  disabled={isSubmitting}
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

      {/* Section Summary Dialog */}
      <Dialog open={showSummaryDialog} onOpenChange={setShowSummaryDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assessment Summary</DialogTitle>
            <DialogDescription>
              Review your responses across all sections
            </DialogDescription>
          </DialogHeader>
          <AssessmentSectionSummary
            sections={sections}
            responses={responses}
            onEditSection={handleEditSection}
            onGenerateReport={handleGenerateReport}
            isGenerating={generateReportMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Completion Summary Dialog */}
      <Dialog open={showCompletionDialog} onOpenChange={setShowCompletionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Assessment</DialogTitle>
            <DialogDescription>
              Review your assessment completion summary
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(() => {
              const stats = getCompletionStats();
              return (
                <>
                  <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Total Questions:</span>
                      <span className="text-sm font-bold">{stats.total}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-green-600">Answered:</span>
                      <span className="text-sm font-bold text-green-600">{stats.answered}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-slate-600">Skipped:</span>
                      <span className="text-sm font-bold text-slate-600">{stats.skipped}</span>
                    </div>
                  </div>

                  {stats.unansweredRequired.length > 0 && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-5 h-5 text-orange-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-orange-800">
                            {stats.unansweredRequired.length} Required Question{stats.unansweredRequired.length > 1 ? 's' : ''} Unanswered
                          </p>
                          <p className="text-xs text-orange-600 mt-1">
                            The assessment can still be completed, but these questions are marked as required.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompletionDialog(false)}>
              Cancel
            </Button>
            <Button onClick={confirmComplete} className="bg-green-600 hover:bg-green-700">
              <CheckCircle className="w-4 h-4 mr-2" />
              Confirm Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Next Steps Dialog */}
      <Dialog open={showNextStepsDialog} onOpenChange={setShowNextStepsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <CheckCircle className="w-6 h-6 text-green-600" />
              <span>Assessment Completed!</span>
            </DialogTitle>
            <DialogDescription>
              What would you like to do next?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Button
              className="w-full justify-start h-auto py-4"
              variant="outline"
              onClick={() => {
                setShowNextStepsDialog(false);
                // Stay on current page to edit assessment
              }}
            >
              <div className="flex items-start space-x-3">
                <Edit className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-semibold">Edit Assessment</div>
                  <div className="text-sm text-slate-600">Go back and modify your answers</div>
                </div>
              </div>
            </Button>
            <Button
              className="w-full justify-start h-auto py-4 bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                setShowNextStepsDialog(false);
                setLocation(`/assessments/${assignmentId}/report`);
              }}
            >
              <div className="flex items-start space-x-3">
                <FileText className="w-5 h-5 mt-0.5 flex-shrink-0 text-white" />
                <div className="text-left text-white">
                  <div className="font-semibold">View & Edit Report</div>
                  <div className="text-sm text-blue-100">Generate AI report and edit content</div>
                </div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}