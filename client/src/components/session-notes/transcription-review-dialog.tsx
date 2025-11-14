import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TranscriptionData {
  rawTranscription: string;
  mappedFields: {
    sessionFocus?: string;
    symptoms?: string;
    shortTermGoals?: string;
    intervention?: string;
    progress?: string;
    remarks?: string;
    recommendations?: string;
  };
}

interface FieldSelection {
  selected: boolean;
  mergeMode: 'append' | 'replace';
  editedValue: string;
}

interface TranscriptionReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transcriptionData: TranscriptionData | null;
  currentFieldValues: {
    sessionFocus?: string;
    symptoms?: string;
    shortTermGoals?: string;
    intervention?: string;
    progress?: string;
    remarks?: string;
    recommendations?: string;
  };
  onApply: (selectedFields: {
    [key: string]: { value: string; mergeMode: 'append' | 'replace' };
  }) => void;
  onDiscard: () => void;
}

const FIELD_LABELS: { [key: string]: string } = {
  sessionFocus: "Session Focus",
  symptoms: "Symptoms",
  shortTermGoals: "Short-term Goals",
  intervention: "Interventions",
  progress: "Progress",
  remarks: "Clinical Remarks",
  recommendations: "Recommendations"
};

export function TranscriptionReviewDialog({
  open,
  onOpenChange,
  transcriptionData,
  currentFieldValues,
  onApply,
  onDiscard
}: TranscriptionReviewDialogProps) {
  const { toast } = useToast();
  
  // Initialize field selections
  const [fieldSelections, setFieldSelections] = useState<{ [key: string]: FieldSelection }>({});

  // Initialize selections when transcription data changes
  useEffect(() => {
    if (transcriptionData?.mappedFields) {
      const initialSelections: { [key: string]: FieldSelection } = {};
      
      Object.keys(transcriptionData.mappedFields).forEach((fieldKey) => {
        const aiValue = transcriptionData.mappedFields[fieldKey as keyof typeof transcriptionData.mappedFields];
        const currentValue = currentFieldValues[fieldKey as keyof typeof currentFieldValues];
        
        if (aiValue) {
          initialSelections[fieldKey] = {
            selected: true, // Auto-select all fields with AI suggestions
            mergeMode: currentValue ? 'append' : 'replace', // Default to append if existing content
            editedValue: aiValue
          };
        }
      });
      
      setFieldSelections(initialSelections);
    }
  }, [transcriptionData, currentFieldValues]);

  const handleToggleField = (fieldKey: string) => {
    setFieldSelections(prev => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        selected: !prev[fieldKey]?.selected
      }
    }));
  };

  const handleMergeModeChange = (fieldKey: string, mode: 'append' | 'replace') => {
    setFieldSelections(prev => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        mergeMode: mode
      }
    }));
  };

  const handleEditValue = (fieldKey: string, value: string) => {
    setFieldSelections(prev => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        editedValue: value
      }
    }));
  };

  const handleApply = () => {
    const selectedFields: { [key: string]: { value: string; mergeMode: 'append' | 'replace' } } = {};
    
    Object.keys(fieldSelections).forEach((fieldKey) => {
      const selection = fieldSelections[fieldKey];
      if (selection.selected && selection.editedValue) {
        selectedFields[fieldKey] = {
          value: selection.editedValue,
          mergeMode: selection.mergeMode
        };
      }
    });

    if (Object.keys(selectedFields).length === 0) {
      toast({
        title: "No fields selected",
        description: "Please select at least one field to apply",
        variant: "destructive"
      });
      return;
    }

    onApply(selectedFields);
    onOpenChange(false);
  };

  const handleCopyTranscript = () => {
    if (transcriptionData?.rawTranscription) {
      navigator.clipboard.writeText(transcriptionData.rawTranscription);
      toast({
        title: "Copied!",
        description: "Transcript copied to clipboard"
      });
    }
  };

  const selectedCount = Object.values(fieldSelections).filter(s => s.selected).length;
  const totalFields = Object.keys(fieldSelections).length;

  if (!transcriptionData) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Review Voice Transcription
          </DialogTitle>
          <DialogDescription>
            Review the AI-generated field mappings and choose which ones to apply to your session note
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="fields" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="fields">
              Structured Fields ({selectedCount}/{totalFields} selected)
            </TabsTrigger>
            <TabsTrigger value="transcript">Full Transcript</TabsTrigger>
          </TabsList>

          <TabsContent value="fields" className="flex-1 overflow-hidden">
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-4">
                {Object.keys(transcriptionData.mappedFields).map((fieldKey) => {
                  const aiValue = transcriptionData.mappedFields[fieldKey as keyof typeof transcriptionData.mappedFields];
                  const currentValue = currentFieldValues[fieldKey as keyof typeof currentFieldValues];
                  const selection = fieldSelections[fieldKey];

                  if (!aiValue) return null;

                  return (
                    <Card key={fieldKey} className={selection?.selected ? "border-blue-500" : ""}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={selection?.selected || false}
                              onCheckedChange={() => handleToggleField(fieldKey)}
                              data-testid={`checkbox-field-${fieldKey}`}
                            />
                            <CardTitle className="text-sm font-medium">
                              {FIELD_LABELS[fieldKey] || fieldKey}
                            </CardTitle>
                          </div>
                          {currentValue && (
                            <Badge variant="outline" className="text-xs">
                              Has existing content
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Current Value */}
                        {currentValue && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Current Value:</Label>
                            <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-900 rounded text-sm border">
                              {currentValue}
                            </div>
                          </div>
                        )}

                        {/* AI Suggested Value (Editable) */}
                        <div>
                          <Label className="text-xs text-muted-foreground">AI Suggestion:</Label>
                          <Textarea
                            value={selection?.editedValue || aiValue}
                            onChange={(e) => handleEditValue(fieldKey, e.target.value)}
                            className="mt-1 min-h-[80px]"
                            placeholder="AI suggested content..."
                            data-testid={`textarea-${fieldKey}`}
                          />
                        </div>

                        {/* Merge Mode Selection */}
                        {currentValue && selection?.selected && (
                          <div>
                            <Label className="text-xs text-muted-foreground mb-2 block">
                              How to apply:
                            </Label>
                            <RadioGroup
                              value={selection.mergeMode}
                              onValueChange={(value) => handleMergeModeChange(fieldKey, value as 'append' | 'replace')}
                            >
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="append" id={`${fieldKey}-append`} />
                                <Label htmlFor={`${fieldKey}-append`} className="font-normal cursor-pointer">
                                  Append (add to existing content)
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="replace" id={`${fieldKey}-replace`} />
                                <Label htmlFor={`${fieldKey}-replace`} className="font-normal cursor-pointer">
                                  Replace (overwrite existing content)
                                </Label>
                              </div>
                            </RadioGroup>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="transcript" className="flex-1 overflow-hidden">
            <Card className="h-[500px]">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Full Transcription</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyTranscript}
                    data-testid="button-copy-transcript"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </Button>
                </div>
                <CardDescription className="text-xs">
                  Raw transcript from voice recording
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[380px]">
                  <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded text-sm whitespace-pre-wrap border">
                    {transcriptionData.rawTranscription}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {selectedCount > 0 ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                {selectedCount} field{selectedCount !== 1 ? 's' : ''} ready to apply
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                No fields selected
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onDiscard();
                onOpenChange(false);
              }}
              data-testid="button-discard"
            >
              Discard
            </Button>
            <Button
              onClick={handleApply}
              disabled={selectedCount === 0}
              data-testid="button-apply-selected"
            >
              Apply Selected ({selectedCount})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
