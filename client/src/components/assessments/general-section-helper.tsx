import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, Lightbulb, FileText } from "lucide-react";

export function GeneralSectionHelper() {
  return (
    <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-600" />
          <CardTitle className="text-sm text-blue-800 dark:text-blue-200">
            General Report Sections
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <FileText className="h-3 w-3 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-blue-800 dark:text-blue-200">
                <strong>How General Sections Work:</strong> These sections synthesize information from ALL assessment responses to create professional clinical documentation.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Lightbulb className="h-3 w-3 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-blue-700 dark:text-blue-300">
                <strong>To create a general section:</strong>
              </p>
              <ol className="list-decimal list-inside ml-2 space-y-1 text-blue-600 dark:text-blue-400">
                <li>Choose a "Report Section Type" above</li>
                <li>Add specific AI instructions</li>
                <li>Leave questions empty (no questions needed)</li>
                <li>The AI will generate this section from all assessment data</li>
              </ol>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <div>
            <p className="font-medium text-blue-800 dark:text-blue-200">Popular General Sections:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              <Badge variant="outline" className="text-xs">Clinical Summary</Badge>
              <Badge variant="outline" className="text-xs">Risk Assessment</Badge>
              <Badge variant="outline" className="text-xs">Intervention Plan</Badge>
              <Badge variant="outline" className="text-xs">Diagnostic Impressions</Badge>
            </div>
          </div>
        </div>

        <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded text-xs">
          <p className="text-blue-800 dark:text-blue-200">
            <strong>Example AI Instruction:</strong> "Generate comprehensive risk assessment based on all responses, focusing on suicide risk, self-harm, substance use, and safety factors. Use clinical language suitable for documentation."
          </p>
        </div>
      </CardContent>
    </Card>
  );
}