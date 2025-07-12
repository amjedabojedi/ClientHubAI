import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, GripVertical, Save, ArrowLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AssessmentTemplate, AssessmentSection, AssessmentQuestion, InsertAssessmentSection, InsertAssessmentQuestion } from "@shared/schema";

interface TemplateBuilderProps {
  templateId: number;
  onBack: () => void;
}

interface QuestionForm {
  id?: number;
  text: string;
  type: "short_text" | "long_text" | "multiple_choice" | "rating_scale" | "checkbox";
  options: string[];
  required: boolean;
  scoreValues: number[];
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch template details and existing sections
  const { data: template } = useQuery({
    queryKey: [`/api/assessments/templates/${templateId}`],
  });

  const { data: existingSections = [] } = useQuery({
    queryKey: [`/api/assessments/templates/${templateId}/sections`],
    select: (data: any[]) => data.map((section: any) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      accessLevel: section.accessLevel,
      isScoring: section.isScoring,
      reportMapping: section.reportMapping,
      aiReportPrompt: section.aiReportPrompt || "",
      order: section.order,
      questions: section.questions?.map((q: any) => ({
        id: q.id,
        text: q.questionText,
        type: q.questionType,
        options: q.options || [],
        required: q.isRequired,
        scoreValues: q.scoreValues || []
      })) || []
    }))
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
    console.log('Adding question to section:', sectionIndex);
    const newQuestion: QuestionForm = {
      text: "",
      type: "short_text",
      options: [],
      required: false,
      scoreValues: []
    };
    const updated = [...sections];
    updated[sectionIndex].questions.push(newQuestion);
    console.log('Updated sections:', updated);
    setSections(updated);
  };

  const updateQuestion = (sectionIndex: number, questionIndex: number, field: keyof QuestionForm, value: any) => {
    const updated = [...sections];
    const question = updated[sectionIndex].questions[questionIndex];
    
    // If changing question type to one that needs options, initialize them
    if (field === 'type' && (value === 'multiple_choice' || value === 'rating_scale' || value === 'checkbox')) {
      if (!question.options || question.options.length === 0) {
        question.options = ['Option 1', 'Option 2'];
        question.scoreValues = [1, 2];
      }
    }
    
    // If changing away from option types, clear options
    if (field === 'type' && value !== 'multiple_choice' && value !== 'rating_scale' && value !== 'checkbox') {
      question.options = [];
      question.scoreValues = [];
    }
    
    updated[sectionIndex].questions[questionIndex] = {
      ...question,
      [field]: value
    };
    setSections(updated);
  };

  const removeQuestion = (sectionIndex: number, questionIndex: number) => {
    const updated = [...sections];
    updated[sectionIndex].questions.splice(questionIndex, 1);
    setSections(updated);
  };

  const copyQuestion = (sectionIndex: number, questionIndex: number) => {
    const updated = [...sections];
    const originalQuestion = updated[sectionIndex].questions[questionIndex];
    const copiedQuestion: QuestionForm = {
      text: originalQuestion.text + " (Copy)",
      type: originalQuestion.type,
      options: [...originalQuestion.options],
      required: originalQuestion.required,
      scoreValues: [...originalQuestion.scoreValues]
    };
    updated[sectionIndex].questions.splice(questionIndex + 1, 0, copiedQuestion);
    setSections(updated);
  };

  const addOption = (sectionIndex: number, questionIndex: number) => {
    const updated = [...sections];
    const question = updated[sectionIndex].questions[questionIndex];
    
    // Initialize arrays if they don't exist
    if (!question.options) question.options = [];
    if (!question.scoreValues) question.scoreValues = [];
    
    const optionNumber = question.options.length + 1;
    question.options.push(`Option ${optionNumber}`);
    question.scoreValues.push(optionNumber);
    setSections(updated);
  };

  const updateOption = (sectionIndex: number, questionIndex: number, optionIndex: number, value: string) => {
    const updated = [...sections];
    updated[sectionIndex].questions[questionIndex].options[optionIndex] = value;
    setSections(updated);
  };

  const updateScoreValue = (sectionIndex: number, questionIndex: number, optionIndex: number, value: number) => {
    const updated = [...sections];
    updated[sectionIndex].questions[questionIndex].scoreValues[optionIndex] = value;
    setSections(updated);
  };

  const removeOption = (sectionIndex: number, questionIndex: number, optionIndex: number) => {
    const updated = [...sections];
    const question = updated[sectionIndex].questions[questionIndex];
    question.options.splice(optionIndex, 1);
    question.scoreValues.splice(optionIndex, 1);
    setSections(updated);
  };

  const saveTemplate = async () => {
    setIsSaving(true);
    try {
      // Save sections and questions
      for (const section of sections) {
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
          const result = await apiRequest(`/api/assessments/sections`, "POST", sectionData);
          sectionId = result.id;
        }

        // Save questions for this section
        for (const question of section.questions) {
          const questionData: InsertAssessmentQuestion = {
            sectionId: sectionId!,
            questionText: question.text,
            questionType: question.type as any,
            isRequired: question.required,
            sortOrder: section.questions.indexOf(question)
          };

          if (question.id) {
            // Update existing question
            await apiRequest(`/api/assessments/questions/${question.id}`, "PATCH", questionData);
          } else {
            // Create new question
            await apiRequest(`/api/assessments/questions`, "POST", questionData);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: [`/api/assessments/templates/${templateId}/sections`] });
      toast({
        title: "Success",
        description: "Template sections and questions saved successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save template",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getAccessLevelColor = (level: string) => {
    switch (level) {
      case "therapist_only": return "bg-blue-100 text-blue-800";
      case "client_only": return "bg-green-100 text-green-800";
      case "shared": return "bg-purple-100 text-purple-800";
      default: return "bg-gray-100 text-gray-800";
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
          <Button onClick={addSection}>
            <Plus className="h-4 w-4 mr-2" />
            Add Section
          </Button>
          <Button onClick={saveTemplate} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving..." : "Save Template"}
          </Button>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {sections.map((section, sectionIndex) => (
          <Card key={sectionIndex} className="border-l-4 border-l-blue-500">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                  <CardTitle className="text-lg">
                    {section.title || `Section ${sectionIndex + 1}`}
                  </CardTitle>
                  <Badge className={getAccessLevelColor(section.accessLevel)}>
                    {section.accessLevel}
                  </Badge>
                  {section.isScoring && (
                    <Badge variant="outline">Scoring Enabled</Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeSection(sectionIndex)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Section Settings */}
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
                  <Label>Enable Scoring</Label>
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

              <Separator />

              {/* Questions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Questions</h4>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={(e) => {
                      e.preventDefault();
                      console.log('Add Question button clicked for section:', sectionIndex);
                      addQuestion(sectionIndex);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Question
                  </Button>
                </div>

                {section.questions.map((question, questionIndex) => (
                  <Card key={questionIndex} className="bg-gray-50">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">Question {questionIndex + 1}</span>
                        <div className="flex space-x-1">
                          <Button variant="ghost" size="sm" onClick={() => copyQuestion(sectionIndex, questionIndex)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => removeQuestion(sectionIndex, questionIndex)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

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
                              Options {section.isScoring && <span className="text-xs text-muted-foreground">(with scores)</span>}
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
                              {section.isScoring && (
                                <div className="flex items-center space-x-1">
                                  <Label className="text-xs">Score:</Label>
                                  <Input
                                    type="number"
                                    value={question.scoreValues[optionIndex] || 0}
                                    onChange={(e) => updateScoreValue(sectionIndex, questionIndex, optionIndex, parseInt(e.target.value) || 0)}
                                    placeholder="0"
                                    className="w-16"
                                  />
                                </div>
                              )}
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
                    </CardContent>
                  </Card>
                ))}

                {section.questions.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No questions added yet. Click "Add Question" to get started.
                  </div>
                )}
              </div>
            </CardContent>
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