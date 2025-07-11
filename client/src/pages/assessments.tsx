import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Filter, FileText, Users, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AssessmentTemplate, AssessmentAssignment } from "@shared/schema";

interface AssessmentTemplateWithDetails extends AssessmentTemplate {
  createdBy: {
    id: number;
    fullName: string;
  };
  sectionsCount: number;
}

interface AssessmentAssignmentWithDetails extends AssessmentAssignment {
  template: AssessmentTemplate;
  client: {
    id: number;
    clientId: string;
    firstName: string;
    lastName: string;
  };
  assignedBy: {
    id: number;
    fullName: string;
  };
}

export default function AssessmentsPage() {
  const [activeTab, setActiveTab] = useState("templates");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch assessment templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery<AssessmentTemplateWithDetails[]>({
    queryKey: ["/api/assessments/templates"],
  });

  // Fetch assessment assignments
  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<AssessmentAssignmentWithDetails[]>({
    queryKey: ["/api/assessments/assignments"],
  });

  // Filter templates
  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Filter assignments
  const filteredAssignments = assignments.filter(assignment => {
    const matchesSearch = assignment.template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         `${assignment.client.firstName} ${assignment.client.lastName}`.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: "secondary",
      client_in_progress: "outline",
      waiting_for_therapist: "default",
      therapist_completed: "secondary",
      completed: "default"
    } as const;

    const labels = {
      pending: "Pending",
      client_in_progress: "In Progress",
      waiting_for_therapist: "Waiting for Review",
      therapist_completed: "Therapist Complete",
      completed: "Completed"
    };

    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"}>
        {labels[status as keyof typeof labels] || status}
      </Badge>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case "client_in_progress":
        return <AlertTriangle className="h-4 w-4 text-blue-600" />;
      case "waiting_for_therapist":
        return <AlertTriangle className="h-4 w-4 text-orange-600" />;
      case "therapist_completed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Assessments</h1>
          <p className="text-muted-foreground">
            Manage assessment templates and track client assessment progress
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates or assignments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="clinical">Clinical</SelectItem>
            <SelectItem value="psychological">Psychological</SelectItem>
            <SelectItem value="behavioral">Behavioral</SelectItem>
            <SelectItem value="cognitive">Cognitive</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="templates">
            <FileText className="h-4 w-4 mr-2" />
            Templates ({filteredTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="assignments">
            <Users className="h-4 w-4 mr-2" />
            Active Assignments ({filteredAssignments.length})
          </TabsTrigger>
        </TabsList>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-4">
          {templatesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-3 bg-gray-200 rounded w-full"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/3"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map((template) => (
                <Card key={template.id} className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <CardTitle className="text-lg">{template.name}</CardTitle>
                        <CardDescription className="line-clamp-2">
                          {template.description}
                        </CardDescription>
                      </div>
                      <Badge variant={template.isStandardized ? "default" : "secondary"}>
                        {template.isStandardized ? "Standard" : "Custom"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Category</span>
                        <span className="capitalize">{template.category}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Sections</span>
                        <span>{template.sectionsCount}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Created by</span>
                        <span>{template.createdBy.fullName}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Version</span>
                        <span>{template.version}</span>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button variant="outline" size="sm" className="flex-1">
                          Edit
                        </Button>
                        <Button size="sm" className="flex-1">
                          Assign
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!templatesLoading && filteredTemplates.length === 0 && (
            <Card className="p-8 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No templates found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || selectedCategory !== "all" 
                  ? "No templates match your current filters." 
                  : "Create your first assessment template to get started."}
              </p>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* Assignments Tab */}
        <TabsContent value="assignments" className="space-y-4">
          {assignmentsLoading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="flex justify-between">
                      <div className="space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                      </div>
                      <div className="h-6 bg-gray-200 rounded w-20"></div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAssignments.map((assignment) => (
                <Card key={assignment.id} className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(assignment.status)}
                          <CardTitle className="text-lg">{assignment.template.name}</CardTitle>
                        </div>
                        <CardDescription>
                          Assigned to: {assignment.client.firstName} {assignment.client.lastName} ({assignment.client.clientId})
                        </CardDescription>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          <span>Assigned by: {assignment.assignedBy.fullName}</span>
                          <span>Due: {assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : "No due date"}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {getStatusBadge(assignment.status)}
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm">
                            View
                          </Button>
                          <Button size="sm">
                            Manage
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}

          {!assignmentsLoading && filteredAssignments.length === 0 && (
            <Card className="p-8 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No active assignments</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery 
                  ? "No assignments match your current search." 
                  : "No clients have been assigned assessments yet."}
              </p>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Assign Assessment
              </Button>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}