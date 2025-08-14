import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

// Icons
import { 
  Plus, 
  Trash2, 
  Save, 
  Copy, 
  ArrowLeft, 
  GripVertical, 
  Eye,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown
} from "lucide-react";

// Hooks & Utils
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Types
import type { AssessmentTemplate, AssessmentSection, AssessmentQuestion, InsertAssessmentSection, InsertAssessmentQuestion } from "@shared/schema";

interface TemplateBuilderProps {
  templateId: number;
  onBack: () => void;
}

interface QuestionForm {
  id?: number;
  text: string;
  type: "short_text" | "long_text" | "multiple_choice" | "rating_scale" | "checkbox" | "date" | "number";
  options: string[];
  required: boolean;
  scoreValues: number[];
  sortOrder?: number;
}

interface SectionForm {
  id?: number;
  title: string;
  description: string;
  accessLevel: "therapist_only" | "client_only" | "shared";
  isScoring: boolean;
  reportMapping: string;
  aiReportPrompt: string;
  order: number;
  questions: QuestionForm[];
}

export function TemplateBuilder({ templateId, onBack }: TemplateBuilderProps) {
  const [sections, setSections] = useState<SectionForm[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch template details and existing sections
  const { data: template } = useQuery({
    queryKey: [`/api/assessments/templates/${templateId}`],
  });

  const { data: existingSections = [] } = useQuery({
    queryKey: [`/api/assessments/templates/${templateId}/sections`],
    select: (data: any[]) => data
      .map((section: any) => ({
        id: section.id,
        title: section.title,
        description: section.description,
        accessLevel: section.accessLevel,
        isScoring: section.isScoring,
        reportMapping: section.reportMapping,
        aiReportPrompt: section.aiReportPrompt || "",
        order: section.sortOrder || 0, // Use sortOrder from database
        questions: section.questions?.map((q: any) => ({
          id: q.id,
          text: q.questionText,
          type: q.questionType,
          options: q.options || [],
          required: q.isRequired,
          scoreValues: q.scoreValues || [],
          sortOrder: q.sortOrder || 0
        })).sort((a: any, b: any) => a.sortOrder - b.sortOrder) || []
      }))
      .sort((a, b) => a.order - b.order) // Sort by order field
  });

  // Initialize sections when data loads
  useEffect(() => {
    if (existingSections && existingSections.length > 0) {
      setSections(existingSections);
    }
  }, [existingSections]);

  const addSection = () => {
    const newSection: SectionForm = {
      title: "",
      description: "",
      accessLevel: "shared",
      isScoring: false,
      reportMapping: "",
      aiReportPrompt: "",
      order: sections.length + 1,
      questions: []
    };
    setSections([...sections, newSection]);
  };

  const updateSection = (index: number, field: keyof SectionForm, value: any) => {
    const updated = [...sections];
    updated[index] = { ...updated[index], [field]: value };
    setSections(updated);
  };

  const removeSection = (index: number) => {
    setSections(sections.filter((_, i) => i !== index));
  };

  const addQuestion = (sectionIndex: number) => {
    const newQuestion: QuestionForm = {
      text: "",
      type: "short_text",
      options: [],
      required: false,
      scoreValues: [],
      sortOrder: sections[sectionIndex].questions.length
    };
    
    const updated = [...sections];
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: [...updated[sectionIndex].questions, newQuestion]
    };
    
    setSections(updated);
  };

  const updateQuestion = (sectionIndex: number, questionIndex: number, field: keyof QuestionForm, value: any) => {
    const updated = [...sections];
    const question = { ...updated[sectionIndex].questions[questionIndex] };
    
    // Update the field first
    (question as any)[field] = value;
    
    // If changing question type to one that needs options, initialize them appropriately
    if (field === 'type' && (value === 'multiple_choice' || value === 'rating_scale' || value === 'checkbox')) {
      // Always set appropriate default options when changing to option-based types
      if (value === 'rating_scale') {
        question.options = ['1 - Poor', '2 - Fair', '3 - Good', '4 - Very Good', '5 - Excellent'];
        question.scoreValues = [1, 2, 3, 4, 5];
      } else if (value === 'multiple_choice') {
        question.options = ['Option A', 'Option B', 'Option C'];
        question.scoreValues = [1, 2, 3];
      } else if (value === 'checkbox') {
        question.options = ['Choice 1', 'Choice 2', 'Choice 3'];
        question.scoreValues = [1, 2, 3];
      }
    }
    
    // If changing away from option types, clear options
    if (field === 'type' && value !== 'multiple_choice' && value !== 'rating_scale' && value !== 'checkbox') {
      question.options = [];
      question.scoreValues = [];
    }
    
    // Create new questions array with updated question
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: updated[sectionIndex].questions.map((q, i) => 
        i === questionIndex ? question : q
      )
    };
    
    setSections(updated);
  };

  const removeQuestion = (sectionIndex: number, questionIndex: number) => {
    const updated = [...sections];
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: updated[sectionIndex].questions.filter((_, i) => i !== questionIndex)
    };
    setSections(updated);
  };

  const moveQuestionUp = async (sectionIndex: number, questionIndex: number) => {
    if (questionIndex === 0) return; // Can't move first question up
    
    console.log('Moving question up:', questionIndex, sections[sectionIndex].questions[questionIndex]?.text);
    
    const updated = [...sections];
    const questions = [...updated[sectionIndex].questions];
    const temp = questions[questionIndex];
    questions[questionIndex] = questions[questionIndex - 1];
    questions[questionIndex - 1] = temp;
    
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions
    };
    setSections(updated);
    
    // Auto-save the reordering if questions have IDs (existing questions)
    if (questions[questionIndex]?.id && questions[questionIndex - 1]?.id) {
      try {
        // Swap the sortOrder values of the two questions
        const currentQuestionNewOrder = questions[questionIndex - 1].sortOrder;
        const previousQuestionNewOrder = questions[questionIndex].sortOrder;
        
        // Update the local state with the swapped sortOrder values
        questions[questionIndex].sortOrder = currentQuestionNewOrder;
        questions[questionIndex - 1].sortOrder = previousQuestionNewOrder;
        
        // Update both questions' sort orders in the database
        await Promise.all([
          apiRequest(`/api/assessments/questions/${questions[questionIndex].id}`, "PATCH", {
            sortOrder: currentQuestionNewOrder
          }),
          apiRequest(`/api/assessments/questions/${questions[questionIndex - 1].id}`, "PATCH", {
            sortOrder: previousQuestionNewOrder
          })
        ]);
        
        // Small delay before refresh to avoid race conditions
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: [`/api/assessments/templates/${templateId}/sections`] });
        }, 200);
      } catch (error) {
        console.error('Failed to save question reorder:', error);
        toast({
          title: "Reorder Failed",
          description: "Could not save question order. Please try the Save Template button.",
          variant: "destructive",
        });
      }
    }
  };

  const moveQuestionDown = async (sectionIndex: number, questionIndex: number) => {
    const questions = sections[sectionIndex].questions;
    if (questionIndex === questions.length - 1) return; // Can't move last question down
    
    console.log('Moving question down:', questionIndex, questions[questionIndex]?.text);
    
    const updated = [...sections];
    const updatedQuestions = [...updated[sectionIndex].questions];
    const temp = updatedQuestions[questionIndex];
    updatedQuestions[questionIndex] = updatedQuestions[questionIndex + 1];
    updatedQuestions[questionIndex + 1] = temp;
    
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: updatedQuestions
    };
    setSections(updated);
    
    // Auto-save the reordering if questions have IDs (existing questions)
    if (updatedQuestions[questionIndex]?.id && updatedQuestions[questionIndex + 1]?.id) {
      try {
        // Swap the sortOrder values of the two questions
        const currentQuestionNewOrder = updatedQuestions[questionIndex + 1].sortOrder;
        const nextQuestionNewOrder = updatedQuestions[questionIndex].sortOrder;
        
        // Update the local state with the swapped sortOrder values
        updatedQuestions[questionIndex].sortOrder = currentQuestionNewOrder;
        updatedQuestions[questionIndex + 1].sortOrder = nextQuestionNewOrder;
        
        // Update both questions' sort orders in the database
        await Promise.all([
          apiRequest(`/api/assessments/questions/${updatedQuestions[questionIndex].id}`, "PATCH", {
            sortOrder: currentQuestionNewOrder
          }),
          apiRequest(`/api/assessments/questions/${updatedQuestions[questionIndex + 1].id}`, "PATCH", {
            sortOrder: nextQuestionNewOrder
          })
        ]);
        
        // Small delay before refresh to avoid race conditions
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: [`/api/assessments/templates/${templateId}/sections`] });
        }, 200);
      } catch (error) {
        console.error('Failed to save question reorder:', error);
        toast({
          title: "Reorder Failed",
          description: "Could not save question order. Please try the Save Template button.",
          variant: "destructive",
        });
      }
    }
  };

  const copyQuestion = (sectionIndex: number, questionIndex: number) => {
    const updated = [...sections];
    const originalQuestion = updated[sectionIndex].questions[questionIndex];
    const copiedQuestion: QuestionForm = {
      text: originalQuestion.text + " (Copy)",
      type: originalQuestion.type,
      options: [...originalQuestion.options],
      required: originalQuestion.required,
      scoreValues: [...originalQuestion.scoreValues],
      sortOrder: questionIndex + 1
    };
    
    const newQuestions = [...updated[sectionIndex].questions];
    newQuestions.splice(questionIndex + 1, 0, copiedQuestion);
    
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: newQuestions
    };
    setSections(updated);
  };

  const toggleSectionCollapse = (sectionIndex: number) => {
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(sectionIndex)) {
      newCollapsed.delete(sectionIndex);
    } else {
      newCollapsed.add(sectionIndex);
    }
    setCollapsedSections(newCollapsed);
  };

  const moveSectionUp = (sectionIndex: number) => {
    if (sectionIndex === 0) return; // Can't move first section up
    
    console.log('Moving section up:', sectionIndex, sections[sectionIndex]?.title);
    console.log('Current sections:', sections.map(s => ({title: s.title, order: s.order})));
    
    const newSections = [...sections];
    const temp = newSections[sectionIndex];
    newSections[sectionIndex] = newSections[sectionIndex - 1];
    newSections[sectionIndex - 1] = temp;
    
    // Update order values
    newSections[sectionIndex].order = sectionIndex;
    newSections[sectionIndex - 1].order = sectionIndex - 1;
    
    setSections(newSections);
    
    // Update collapsed state indices
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(sectionIndex)) {
      newCollapsed.delete(sectionIndex);
      newCollapsed.add(sectionIndex - 1);
    }
    if (newCollapsed.has(sectionIndex - 1)) {
      newCollapsed.delete(sectionIndex - 1);
      newCollapsed.add(sectionIndex);
    }
    setCollapsedSections(newCollapsed);
  };

  const moveSectionDown = (sectionIndex: number) => {
    if (sectionIndex === sections.length - 1) return; // Can't move last section down
    
    console.log('Moving section down:', sectionIndex, sections[sectionIndex]?.title);
    console.log('Current sections:', sections.map(s => ({title: s.title, order: s.order})));
    
    const newSections = [...sections];
    const temp = newSections[sectionIndex];
    newSections[sectionIndex] = newSections[sectionIndex + 1];
    newSections[sectionIndex + 1] = temp;
    
    // Update order values
    newSections[sectionIndex].order = sectionIndex;
    newSections[sectionIndex + 1].order = sectionIndex + 1;
    
    setSections(newSections);
    
    // Update collapsed state indices
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(sectionIndex)) {
      newCollapsed.delete(sectionIndex);
      newCollapsed.add(sectionIndex + 1);
    }
    if (newCollapsed.has(sectionIndex + 1)) {
      newCollapsed.delete(sectionIndex + 1);
      newCollapsed.add(sectionIndex);
    }
    setCollapsedSections(newCollapsed);
  };

  const addOption = (sectionIndex: number, questionIndex: number) => {
    const updated = [...sections];
    const question = { ...updated[sectionIndex].questions[questionIndex] };
    
    // Ensure options and scoreValues arrays exist
    if (!question.options) question.options = [];
    if (!question.scoreValues) question.scoreValues = [];
    
    question.options = [...question.options, `Option ${question.options.length + 1}`];
    question.scoreValues = [...question.scoreValues, question.scoreValues.length + 1];
    
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: updated[sectionIndex].questions.map((q, i) => 
        i === questionIndex ? question : q
      )
    };
    
    setSections(updated);
  };

  const updateOption = (sectionIndex: number, questionIndex: number, optionIndex: number, value: string) => {
    const updated = [...sections];
    const question = { ...updated[sectionIndex].questions[questionIndex] };
    question.options = [...question.options];
    question.options[optionIndex] = value;
    
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: updated[sectionIndex].questions.map((q, i) => 
        i === questionIndex ? question : q
      )
    };
    
    setSections(updated);
  };

  const updateScoreValue = (sectionIndex: number, questionIndex: number, optionIndex: number, value: number) => {
    const updated = [...sections];
    const question = { ...updated[sectionIndex].questions[questionIndex] };
    question.scoreValues = [...question.scoreValues];
    question.scoreValues[optionIndex] = value;
    
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: updated[sectionIndex].questions.map((q, i) => 
        i === questionIndex ? question : q
      )
    };
    
    setSections(updated);
  };

  const removeOption = (sectionIndex: number, questionIndex: number, optionIndex: number) => {
    const updated = [...sections];
    const question = { ...updated[sectionIndex].questions[questionIndex] };
    question.options = question.options.filter((_, i) => i !== optionIndex);
    question.scoreValues = question.scoreValues.filter((_, i) => i !== optionIndex);
    
    updated[sectionIndex] = {
      ...updated[sectionIndex],
      questions: updated[sectionIndex].questions.map((q, i) => 
        i === questionIndex ? question : q
      )
    };
    
    setSections(updated);
  };

  const saveTemplate = async () => {
    setIsSaving(true);
    const startTime = Date.now();
    const totalQuestions = sections.reduce((total, s) => total + s.questions.length, 0);
    
    // Add progress feedback
    toast({
      title: "Saving Template",
      description: `Processing ${sections.length} sections with ${totalQuestions} questions...`,
    });
    
    try {
      // First, handle deletions by comparing current state with original data
      for (const existingSection of existingSections) {
        const currentSection = sections.find(s => s.id === existingSection.id);
        
        if (currentSection) {
          // Section still exists, check for deleted questions
          for (const existingQuestion of existingSection.questions) {
            const currentQuestion = currentSection.questions.find(q => q.id === existingQuestion.id);
            
            if (!currentQuestion && existingQuestion.id) {
              // Question was deleted, remove it from database
              try {
                await apiRequest(`/api/assessments/questions/${existingQuestion.id}`, "DELETE");
              } catch (error) {
                // Silently handle deletion errors
              }
            }
          }
        }
      }

      // Process sections in parallel
      const sectionPromises = sections.map(async (section) => {
        const sectionData: InsertAssessmentSection = {
          templateId,
          title: section.title,
          description: section.description,
          accessLevel: section.accessLevel,
          isScoring: section.isScoring,
          reportMapping: section.reportMapping || null,
          aiReportPrompt: section.aiReportPrompt || null,
          sortOrder: section.order
        };

        let sectionId = section.id;
        if (section.id) {
          // Update existing section
          await apiRequest(`/api/assessments/sections/${section.id}`, "PATCH", sectionData);
        } else {
          // Create new section
          const response = await apiRequest(`/api/assessments/sections`, "POST", sectionData);
          const result = await response.json();
          sectionId = result.id;
        }

        // Process questions in parallel for this section
        const questionPromises = section.questions.map(async (question) => {
          const questionData: InsertAssessmentQuestion = {
            sectionId: sectionId!,
            questionText: question.text,
            questionType: question.type as any,
            isRequired: question.required,
            sortOrder: question.sortOrder !== undefined ? question.sortOrder : section.questions.indexOf(question)
          };

          let questionId = question.id;
          if (question.id) {
            // Update existing question
            await apiRequest(`/api/assessments/questions/${question.id}`, "PATCH", questionData);
            questionId = question.id;
          } else {
            // Create new question
            const response = await apiRequest(`/api/assessments/questions`, "POST", questionData);
            const result = await response.json();
            questionId = result.id;
          }

          // Save question options if the question type supports them
          if (question.type === 'multiple_choice' || question.type === 'rating_scale' || question.type === 'checkbox') {
            // Only proceed if we have a valid questionId
            if (!questionId) {
              throw new Error("Question ID is missing - cannot create options");
            }

            // Delete ALL existing options first with single API call
            try {
              await apiRequest(`/api/assessments/questions/${questionId}/options`, "DELETE");
            } catch (error) {
              // Ignore error if no options exist
            }

            // Create all new options in bulk
            const optionsData = question.options.map((optionText, optionIndex) => ({
              questionId: questionId,
              optionText: optionText,
              optionValue: (question.scoreValues[optionIndex] || 0).toString(),
              sortOrder: optionIndex
            }));

            if (optionsData.length > 0) {
              await apiRequest(`/api/assessments/question-options/bulk`, "POST", { options: optionsData });
            }
          }
        });

        await Promise.all(questionPromises);
      });

      await Promise.all(sectionPromises);

      queryClient.invalidateQueries({ queryKey: [`/api/assessments/templates/${templateId}/sections`] });
      
      const saveTime = ((Date.now() - startTime) / 1000).toFixed(1);
      toast({
        title: "Template Saved Successfully",
        description: `Saved ${sections.length} sections with ${totalQuestions} questions in ${saveTime}s`,
      });
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message || "Unable to save template. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getAccessLevelColor = (level: string): string => {
    switch (level) {
      case "therapist_only": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "client_only": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "shared": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Templates
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Template Builder</h1>
            <p className="text-muted-foreground">{template?.name}</p>
          </div>
        </div>
        <div className="flex space-x-2">
          <Button 
            variant={isPreviewMode ? "default" : "outline"} 
            onClick={() => setIsPreviewMode(!isPreviewMode)}
          >
            <Eye className="h-4 w-4 mr-2" />
            {isPreviewMode ? "Exit Preview" : "Preview"}
          </Button>
          {!isPreviewMode && (
            <Button onClick={addSection}>
              <Plus className="h-4 w-4 mr-2" />
              Add Section
            </Button>
          )}
          <Button onClick={saveTemplate} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving..." : "Save Template"}
          </Button>
        </div>
      </div>

      {/* Preview Mode Info */}
      {isPreviewMode && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Assessment Preview</h3>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            This is how your assessment will appear to users. You can see the layout and test the functionality.
          </p>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-6">
        {sections.map((section, sectionIndex) => (
          <Card key={section.id || `section-${sectionIndex}`} className={`border-l-4 ${isPreviewMode ? 'border-l-green-500' : 'border-l-blue-500'}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => toggleSectionCollapse(sectionIndex)}
                    className="p-1 h-6 w-6"
                  >
                    {collapsedSections.has(sectionIndex) ? (
                      <ChevronRight className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                  <CardTitle className="text-lg">
                    {section.title || `Section ${sectionIndex + 1}`}
                  </CardTitle>
                  {!isPreviewMode && (
                    <>
                      <Badge className={getAccessLevelColor(section.accessLevel)}>
                        {section.accessLevel}
                      </Badge>
                      {section.isScoring && (
                        <Badge variant="outline">Scoring Enabled</Badge>
                      )}
                    </>
                  )}
                  {collapsedSections.has(sectionIndex) && (
                    <span className="text-sm text-muted-foreground">
                      ({section.questions.length} question{section.questions.length !== 1 ? 's' : ''})
                    </span>
                  )}
                </div>
                {!isPreviewMode && (
                  <div className="flex items-center space-x-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => moveSectionUp(sectionIndex)}
                      disabled={sectionIndex === 0}
                      title="Move section up"
                      className="p-1 h-6 w-6"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => moveSectionDown(sectionIndex)}
                      disabled={sectionIndex === sections.length - 1}
                      title="Move section down"
                      className="p-1 h-6 w-6"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeSection(sectionIndex)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              {section.description && (
                <p className="text-sm text-muted-foreground mt-2">{section.description}</p>
              )}
            </CardHeader>
            {!collapsedSections.has(sectionIndex) && (
              <CardContent className="space-y-4">
              {/* Section Settings - Hide in preview mode */}
              {!isPreviewMode && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Section Title</Label>
                  <Input
                    value={section.title}
                    onChange={(e) => updateSection(sectionIndex, "title", e.target.value)}
                    placeholder="e.g., Presenting Symptoms"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Access Level</Label>
                  <Select value={section.accessLevel} onValueChange={(value) => updateSection(sectionIndex, "accessLevel", value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="therapist_only">Therapist Only</SelectItem>
                      <SelectItem value="client_only">Client Only</SelectItem>
                      <SelectItem value="shared">Shared</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={section.description}
                  onChange={(e) => updateSection(sectionIndex, "description", e.target.value)}
                  placeholder="Brief description of this section"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Report Mapping</Label>
                  <Select value={section.reportMapping} onValueChange={(value) => updateSection(sectionIndex, "reportMapping", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select report section..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="referral_reason">Referral Reason</SelectItem>
                      <SelectItem value="presenting_symptoms">Presenting Symptoms</SelectItem>
                      <SelectItem value="background_history">Background History</SelectItem>
                      <SelectItem value="objective_findings">Objective Findings</SelectItem>
                      <SelectItem value="mental_status_exam">Mental Status Exam</SelectItem>
                      <SelectItem value="risk_assessment">Risk Assessment</SelectItem>
                      <SelectItem value="treatment_recommendations">Treatment Recommendations</SelectItem>
                      <SelectItem value="goals_objectives">Goals & Objectives</SelectItem>
                      <SelectItem value="summary_impressions">Summary & Impressions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center space-x-2 pt-6">
                  <Switch
                    checked={section.isScoring}
                    onCheckedChange={(checked) => updateSection(sectionIndex, "isScoring", checked)}
                  />
                  <Label>Enable Scoring <span className="text-xs text-muted-foreground">(shows score values for all options)</span></Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label>AI Report Prompt (Optional)</Label>
                <Textarea
                  value={section.aiReportPrompt}
                  onChange={(e) => updateSection(sectionIndex, "aiReportPrompt", e.target.value)}
                  placeholder="Provide instructions for how this section should be analyzed and included in the AI-generated report..."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  This prompt will guide the AI when generating reports from this section's responses.
                </p>
              </div>

                </div>
              )}

              {!isPreviewMode && <Separator />}

              {/* Questions */}
              <div className="space-y-4">
                {!isPreviewMode && (
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Questions</h4>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => addQuestion(sectionIndex)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Question
                    </Button>
                  </div>
                )}

                {section.questions.map((question, questionIndex) => (
                  <Card key={question.id || `question-${sectionIndex}-${questionIndex}`} className="bg-gray-50 dark:bg-gray-800">
                    <CardContent className="p-4 space-y-3">
                      {!isPreviewMode && (
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">Question {questionIndex + 1}</span>
                          <div className="flex space-x-1">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => moveQuestionUp(sectionIndex, questionIndex)}
                              disabled={questionIndex === 0}
                              title="Move question up"
                              className="p-1 h-6 w-6"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => moveQuestionDown(sectionIndex, questionIndex)}
                              disabled={questionIndex === section.questions.length - 1}
                              title="Move question down"
                              className="p-1 h-6 w-6"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => copyQuestion(sectionIndex, questionIndex)}>
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => removeQuestion(sectionIndex, questionIndex)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Preview Mode: Show question as it appears to users */}
                      {isPreviewMode ? (
                        <div className="space-y-3">
                          <div className="flex items-start space-x-2">
                            <span className="text-sm font-medium text-muted-foreground mt-1">{questionIndex + 1}.</span>
                            <div className="flex-1">
                              <Label className="text-base font-medium">{question.text || "Question text not set"}</Label>
                              {question.required && <span className="text-red-500 ml-1">*</span>}
                            </div>
                          </div>
                          
                          {/* Question Input Based on Type */}
                          {question.type === "short_text" && (
                            <Input placeholder="Enter your answer..." disabled className="bg-white dark:bg-gray-700" />
                          )}
                          
                          {question.type === "long_text" && (
                            <Textarea placeholder="Enter your detailed answer..." rows={3} disabled className="bg-white dark:bg-gray-700" />
                          )}
                          
                          {question.type === "multiple_choice" && (
                            <div className="space-y-3">
                              {question.options && question.options.length > 0 ? (
                                question.options.map((option, optionIndex) => (
                                  <div key={optionIndex} className="flex items-center space-x-3 py-1">
                                    <input type="radio" name={`preview-${sectionIndex}-${questionIndex}`} disabled className="text-blue-600" />
                                    <Label className="text-sm">{option}</Label>
                                  </div>
                                ))
                              ) : (
                                <div className="text-center py-4 text-muted-foreground text-sm border-2 border-dashed border-gray-300 rounded">
                                  No options configured. Switch to edit mode to add options.
                                </div>
                              )}
                            </div>
                          )}
                          
                          {question.type === "checkbox" && (
                            <div className="space-y-3">
                              {question.options && question.options.length > 0 ? (
                                question.options.map((option, optionIndex) => (
                                  <div key={optionIndex} className="flex items-center space-x-3 py-1">
                                    <input type="checkbox" disabled className="text-blue-600" />
                                    <Label className="text-sm">{option}</Label>
                                  </div>
                                ))
                              ) : (
                                <div className="text-center py-4 text-muted-foreground text-sm border-2 border-dashed border-gray-300 rounded">
                                  No options configured. Switch to edit mode to add options.
                                </div>
                              )}
                            </div>
                          )}
                          
                          {question.type === "rating_scale" && (
                            <div className="space-y-3">
                              {question.options && question.options.length > 0 ? (
                                <div className="flex space-x-4 overflow-x-auto py-2">
                                  {question.options.map((option, optionIndex) => (
                                    <div key={optionIndex} className="flex flex-col items-center space-y-2 min-w-0">
                                      <input type="radio" name={`preview-rating-${sectionIndex}-${questionIndex}`} disabled className="text-blue-600" />
                                      <Label className="text-xs text-center break-words">{option}</Label>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-center py-4 text-muted-foreground text-sm border-2 border-dashed border-gray-300 rounded">
                                  No rating scale options configured. Switch to edit mode to add options.
                                </div>
                              )}
                            </div>
                          )}
                          
                          {question.type === "date" && (
                            <Input type="date" disabled className="bg-white dark:bg-gray-700" />
                          )}
                          
                          {question.type === "number" && (
                            <Input type="number" placeholder="Enter a number..." disabled className="bg-white dark:bg-gray-700" />
                          )}
                        </div>
                      ) : (
                        // Edit Mode: Show editing interface
                        <div className="space-y-3">

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Question Text</Label>
                          <Textarea
                            value={question.text}
                            onChange={(e) => updateQuestion(sectionIndex, questionIndex, "text", e.target.value)}
                            placeholder="Enter your question"
                            rows={2}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Question Type</Label>
                          <Select value={question.type} onValueChange={(value) => updateQuestion(sectionIndex, questionIndex, "type", value)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="short_text">Short Text</SelectItem>
                              <SelectItem value="long_text">Long Text</SelectItem>
                              <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                              <SelectItem value="rating_scale">Rating Scale</SelectItem>
                              <SelectItem value="checkbox">Checkbox</SelectItem>
                              <SelectItem value="date">Date</SelectItem>
                              <SelectItem value="number">Number</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={question.required}
                          onCheckedChange={(checked) => updateQuestion(sectionIndex, questionIndex, "required", checked)}
                        />
                        <Label>Required</Label>
                      </div>


                      
                      {/* Options for multiple choice, rating, and checkbox */}
                      {(question.type === "multiple_choice" || question.type === "rating_scale" || question.type === "checkbox") && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>
                              {question.type === "multiple_choice" && "Answer Choices (select one)"}
                              {question.type === "checkbox" && "Checkbox Options (select multiple)"}
                              {question.type === "rating_scale" && "Rating Scale Values"}
                              <span className="text-xs text-muted-foreground block">Each option can have a score value for assessment calculations</span>
                            </Label>
                            <Button variant="outline" size="sm" onClick={() => addOption(sectionIndex, questionIndex)}>
                              <Plus className="h-4 w-4 mr-1" />
                              Add Option
                            </Button>
                          </div>
                          {question.options && question.options.length > 0 ? question.options.map((option, optionIndex) => (
                            <div key={optionIndex} className="flex items-center space-x-2">
                              <div className="text-xs text-muted-foreground w-8">{optionIndex + 1}.</div>
                              <Input
                                value={option}
                                onChange={(e) => updateOption(sectionIndex, questionIndex, optionIndex, e.target.value)}
                                placeholder={`Option ${optionIndex + 1}`}
                                className="flex-1"
                              />
                              <div className="flex items-center space-x-1">
                                <Label className="text-xs">Score:</Label>
                                <Input
                                  type="number"
                                  value={question.scoreValues[optionIndex] || 0}
                                  onChange={(e) => updateScoreValue(sectionIndex, questionIndex, optionIndex, parseInt(e.target.value) || 0)}
                                  placeholder="0"
                                  className="w-16"
                                  min="0"
                                  step="1"
                                />
                              </div>
                              <Button variant="ghost" size="sm" onClick={() => removeOption(sectionIndex, questionIndex, optionIndex)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )) : (
                            <div className="text-center py-4 text-muted-foreground text-sm">
                              No options added yet. Click "Add Option" to create choices.
                            </div>
                          )}
                        </div>
                      )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}

                {(!section.questions || section.questions.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    No questions added yet. Click "Add Question" to get started.
                  </div>
                )}

              </div>
              </CardContent>
            )}
          </Card>
        ))}

        {sections.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <p className="text-muted-foreground mb-4">
                No sections created yet. Add your first section to start building the assessment.
              </p>
              <Button onClick={addSection}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Section
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}