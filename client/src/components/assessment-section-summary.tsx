import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, AlertCircle, Edit, FileText } from "lucide-react";

interface AssessmentQuestion {
  id: number;
  questionText: string;
  questionType: string;
  isRequired: boolean;
}

interface AssessmentSection {
  id: number;
  title: string;
  description?: string;
  questions: AssessmentQuestion[];
}

interface AssessmentSectionSummaryProps {
  sections: AssessmentSection[];
  responses: Record<number, any>;
  onEditSection: (sectionIndex: number) => void;
  onGenerateReport: () => void;
  isGenerating?: boolean;
}

export function AssessmentSectionSummary({
  sections,
  responses,
  onEditSection,
  onGenerateReport,
  isGenerating = false
}: AssessmentSectionSummaryProps) {
  
  const getSectionProgress = (section: AssessmentSection) => {
    const totalQuestions = section.questions.length;
    const answeredQuestions = section.questions.filter(q => {
      const response = responses[q.id];
      return response?.responseText || 
             (response?.selectedOptions && response.selectedOptions.length > 0) ||
             response?.ratingValue !== null;
    }).length;
    
    const requiredQuestions = section.questions.filter(q => q.isRequired).length;
    const answeredRequired = section.questions.filter(q => {
      if (!q.isRequired) return false; // Only count required questions
      const response = responses[q.id];
      return response?.responseText || 
             (response?.selectedOptions && response.selectedOptions.length > 0) ||
             response?.ratingValue !== null;
    }).length;
    
    const isComplete = answeredRequired === requiredQuestions;
    const percentage = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0;
    
    return {
      total: totalQuestions,
      answered: answeredQuestions,
      required: requiredQuestions,
      answeredRequired,
      isComplete,
      percentage
    };
  };

  const getOverallProgress = () => {
    let totalQuestions = 0;
    let answeredQuestions = 0;
    let totalRequired = 0;
    let answeredRequired = 0;
    
    sections.forEach(section => {
      const progress = getSectionProgress(section);
      totalQuestions += progress.total;
      answeredQuestions += progress.answered;
      totalRequired += progress.required;
      answeredRequired += progress.answeredRequired;
    });
    
    const allRequiredComplete = answeredRequired === totalRequired;
    const overallPercentage = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0;
    
    return {
      totalQuestions,
      answeredQuestions,
      totalRequired,
      answeredRequired,
      allRequiredComplete,
      overallPercentage
    };
  };

  const overall = getOverallProgress();

  return (
    <div className="space-y-6">
      {/* Overall Summary Header */}
      <Card className="border-2 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              <span>Assessment Summary</span>
            </div>
            {overall.allRequiredComplete ? (
              <Badge className="bg-green-500">
                <CheckCircle className="w-4 h-4 mr-1" />
                Complete
              </Badge>
            ) : (
              <Badge variant="outline" className="border-orange-500 text-orange-700 dark:text-orange-400">
                <AlertCircle className="w-4 h-4 mr-1" />
                Incomplete
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium">Overall Progress</span>
              <span className="text-slate-600 dark:text-slate-400">
                {overall.answeredQuestions} of {overall.totalQuestions} questions
              </span>
            </div>
            <Progress value={overall.overallPercentage} className="h-2" />
          </div>
          
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-sm">
              <span className="font-medium">Required Questions: </span>
              <span className={overall.allRequiredComplete ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400"}>
                {overall.answeredRequired} of {overall.totalRequired} completed
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section Cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Sections ({sections.length})
        </h3>
        
        <div className="grid gap-4">
          {sections.map((section, index) => {
            const progress = getSectionProgress(section);
            
            return (
              <Card 
                key={section.id} 
                className={`transition-all ${
                  progress.isComplete 
                    ? 'border-green-200 dark:border-green-800' 
                    : 'border-slate-200 dark:border-slate-700'
                }`}
                data-testid={`card-section-${section.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="text-slate-500 dark:text-slate-400 font-normal">
                          Section {index + 1}:
                        </span>
                        {section.title}
                      </CardTitle>
                      {section.description && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                          {section.description}
                        </p>
                      )}
                    </div>
                    
                    {progress.isComplete ? (
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-orange-500 dark:text-orange-400 flex-shrink-0" />
                    )}
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-3">
                  {/* Progress Bar */}
                  <div>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                      <span>Progress</span>
                      <span>{progress.answered} / {progress.total} questions</span>
                    </div>
                    <Progress value={progress.percentage} className="h-1.5" />
                  </div>
                  
                  {/* Stats */}
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex gap-4">
                      <span className="text-slate-600 dark:text-slate-400">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {progress.answered}
                        </span> answered
                      </span>
                      {progress.required > 0 && (
                        <span className={progress.answeredRequired === progress.required 
                          ? "text-green-600 dark:text-green-400" 
                          : "text-orange-600 dark:text-orange-400"
                        }>
                          <span className="font-medium">
                            {progress.answeredRequired}/{progress.required}
                          </span> required
                        </span>
                      )}
                    </div>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditSection(index)}
                      data-testid={`button-edit-section-${section.id}`}
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Section
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4 border-t">
        <Button
          variant="outline"
          onClick={() => onEditSection(0)}
          className="flex-1"
          data-testid="button-review-all"
        >
          <Edit className="w-4 h-4 mr-2" />
          Review All Sections
        </Button>
        
        <Button
          onClick={onGenerateReport}
          disabled={!overall.allRequiredComplete || isGenerating}
          className="flex-1 bg-blue-600 hover:bg-blue-700"
          data-testid="button-generate-report"
        >
          <FileText className="w-4 h-4 mr-2" />
          {isGenerating ? 'Generating...' : 'Generate Report'}
        </Button>
      </div>
      
      {!overall.allRequiredComplete && (
        <div className="text-sm text-orange-600 dark:text-orange-400 text-center">
          Please complete all required questions before generating the report
        </div>
      )}
    </div>
  );
}
