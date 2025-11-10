import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, FileText, CheckCircle2, Clock, AlertCircle, HelpCircle, ChevronDown, Play, Eye } from "lucide-react";
import { Link, useLocation } from "wouter";
import { formatDateDisplay } from "@/lib/datetime";
import { useToast } from "@/hooks/use-toast";

interface FormTemplate {
  id: number;
  name: string;
  category: string;
  description?: string;
}

interface FormAssignment {
  id: number;
  templateId: number;
  clientId: number;
  status: string;
  assignedAt: Date;
  completedAt?: Date;
  reviewedAt?: Date;
  template?: FormTemplate;
}

export default function PortalForms() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const { data: assignments = [], isLoading } = useQuery<FormAssignment[]>({
    queryKey: ["/api/portal/forms/assignments"],
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="bg-gray-100 text-gray-800">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
      case "in_progress":
        return (
          <Badge variant="default" className="bg-blue-100 text-blue-800">
            <AlertCircle className="w-3 h-3 mr-1" />
            In Progress
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="default" className="bg-green-100 text-green-800">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case "reviewed":
        return (
          <Badge variant="default" className="bg-purple-100 text-purple-800">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Reviewed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getCategoryBadge = (category: string) => {
    const categoryColors: Record<string, string> = {
      'consent': 'bg-blue-100 text-blue-800',
      'intake': 'bg-purple-100 text-purple-800',
      'assessment': 'bg-green-100 text-green-800',
      'treatment': 'bg-orange-100 text-orange-800',
      'release': 'bg-pink-100 text-pink-800',
      'other': 'bg-gray-100 text-gray-800',
    };
    const colorClass = categoryColors[category.toLowerCase()] || categoryColors.other;
    return <Badge variant="outline" className={colorClass}>{category}</Badge>;
  };

  const handleFormAction = (assignment: FormAssignment) => {
    setLocation(`/portal/forms/${assignment.id}`);
  };

  const getActionButton = (assignment: FormAssignment) => {
    if (assignment.status === "completed" || assignment.status === "reviewed") {
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleFormAction(assignment)}
          data-testid={`button-view-${assignment.id}`}
        >
          <Eye className="w-4 h-4 mr-2" />
          View
        </Button>
      );
    } else if (assignment.status === "in_progress") {
      return (
        <Button
          size="sm"
          onClick={() => handleFormAction(assignment)}
          data-testid={`button-continue-${assignment.id}`}
        >
          <Play className="w-4 h-4 mr-2" />
          Continue
        </Button>
      );
    } else {
      return (
        <Button
          size="sm"
          onClick={() => handleFormAction(assignment)}
          data-testid={`button-start-${assignment.id}`}
        >
          <Play className="w-4 h-4 mr-2" />
          Start
        </Button>
      );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/portal/dashboard">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Clinical Forms</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Loading forms...</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
          <Link href="/portal/dashboard">
            <Button variant="outline" size="sm" data-testid="button-back" className="text-xs sm:text-sm">
              <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Back to </span>Dashboard
            </Button>
          </Link>
        </div>

        {/* Help Section */}
        <Collapsible
          open={isHelpOpen}
          onOpenChange={setIsHelpOpen}
          className="mb-6"
        >
          <Card className="border-purple-200 bg-purple-50">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-purple-100 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-purple-600" />
                    <CardTitle className="text-base">How to Complete Your Forms</CardTitle>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-purple-600 transition-transform ${isHelpOpen ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                  <div>
                    <p className="font-medium text-sm">📋 View Your Forms</p>
                    <p className="text-xs text-gray-600">All forms assigned by your therapist appear below. Each form shows its status: Pending (not started), In Progress (started but not finished), or Completed.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                  <div>
                    <p className="font-medium text-sm">✍️ Fill Out Forms</p>
                    <p className="text-xs text-gray-600">Click "Start" to begin a new form or "Continue" to resume an incomplete one. Your progress is saved automatically as you fill out each section.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                  <div>
                    <p className="font-medium text-sm">✅ Sign & Submit</p>
                    <p className="text-xs text-gray-600">Once you've completed all required fields, you'll be asked to provide an electronic signature. After signing, the form will be submitted to your therapist for review.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</div>
                  <div>
                    <p className="font-medium text-sm">👁️ Review Completed Forms</p>
                    <p className="text-xs text-gray-600">Click "View" on any completed form to see your responses and signature. You can download a PDF copy for your records.</p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-purple-100 rounded-lg">
                  <p className="text-xs text-purple-900">
                    <strong>💡 Important:</strong> All information you provide is confidential and HIPAA-protected. You can save your progress and return later—your responses are automatically saved. Contact your therapist if you have questions about any form.
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Main Content */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-purple-600" />
                  Clinical Forms
                </CardTitle>
                <CardDescription className="mt-1.5">
                  Complete forms assigned by your therapist
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {assignments.length > 0 ? (
              <div className="space-y-4">
                {assignments.map((assignment) => (
                  <Card key={assignment.id} data-testid={`card-form-${assignment.id}`} className="border-l-4 border-l-purple-500">
                    <CardContent className="p-4 sm:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="font-semibold text-base sm:text-lg text-gray-900">
                              {assignment.template?.name || "Unknown Form"}
                            </h3>
                            {assignment.template?.category && getCategoryBadge(assignment.template.category)}
                            {getStatusBadge(assignment.status)}
                          </div>
                          {assignment.template?.description && (
                            <p className="text-sm text-gray-600 mb-3">
                              {assignment.template.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm text-gray-500">
                            <span>Assigned {formatDateDisplay(assignment.assignedAt)}</span>
                            {assignment.completedAt && (
                              <span>• Completed {formatDateDisplay(assignment.completedAt)}</span>
                            )}
                            {assignment.reviewedAt && (
                              <span>• Reviewed {formatDateDisplay(assignment.reviewedAt)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          {getActionButton(assignment)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-lg">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No forms assigned yet</p>
                <p className="text-gray-400 text-sm mt-1">
                  Forms assigned by your therapist will appear here
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
