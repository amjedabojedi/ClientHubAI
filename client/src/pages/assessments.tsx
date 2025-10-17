import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDateDisplay } from "@/lib/datetime";

// UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// Icons
import { Plus, Search, Filter, FileText, Users, Clock, CheckCircle, AlertTriangle, Settings, Edit, Trash2 } from "lucide-react";

// Hooks & Utils
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

// Components
import { CreateTemplateModal } from "@/components/assessments/create-template-modal";
import { EditTemplateModal } from "@/components/assessments/edit-template-modal";
import { TemplateBuilder } from "@/components/assessments/template-builder";
import { AssignAssessmentModal } from "@/components/assessments/assign-assessment-modal";

// Types
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<AssessmentTemplate | null>(null);
  const [assigningTemplate, setAssigningTemplate] = useState<AssessmentTemplate | null>(null);
  const [showManageModal, setShowManageModal] = useState(false);
  const [managingAssignment, setManagingAssignment] = useState<AssessmentAssignmentWithDetails | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

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

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: number) => {
      return apiRequest(`/api/assessments/templates/${templateId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments/templates"] });
      toast({
        title: "Success",
        description: "Assessment template deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete assessment template",
        variant: "destructive",
      });
    },
  });

  // Assignment management mutations
  const updateAssignmentStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest(`/api/assessments/assignments/${id}`, "PATCH", { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments/assignments"] });
      toast({
        title: "Success",
        description: "Assignment status updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update assignment status",
        variant: "destructive"
      });
    }
  });

  const updateAssignmentDueDateMutation = useMutation({
    mutationFn: async ({ id, dueDate }: { id: number; dueDate: string }) => {
      return apiRequest(`/api/assessments/assignments/${id}`, "PATCH", { dueDate: dueDate || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments/assignments"] });
      toast({
        title: "Success",
        description: "Assignment due date updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update assignment due date",
        variant: "destructive"
      });
    }
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/assessments/assignments/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments/assignments"] });
      setShowManageModal(false);
      setManagingAssignment(null);
      toast({
        title: "Success",
        description: "Assignment deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete assignment",
        variant: "destructive"
      });
    }
  });

  const handleEditTemplate = (template: AssessmentTemplate) => {
    setEditingTemplate(template);
    setShowEditModal(true);
  };

  const handleDeleteTemplate = async (templateId: number) => {
    await deleteTemplateMutation.mutateAsync(templateId);
  };

  // Assignment management handlers
  const handleUpdateAssignmentStatus = (assignmentId: number, status: string) => {
    updateAssignmentStatusMutation.mutate({ id: assignmentId, status });
  };

  const handleUpdateAssignmentDueDate = (assignmentId: number, dueDate: string) => {
    updateAssignmentDueDateMutation.mutate({ id: assignmentId, dueDate });
  };

  const handleDeleteAssignment = (assignmentId: number) => {
    deleteAssignmentMutation.mutate(assignmentId);
  };

  const handleAssignTemplate = (template: AssessmentTemplate) => {
    setAssigningTemplate(template);
    setShowAssignModal(true);
  };

  // Show template builder if a template is selected
  if (selectedTemplateId) {
    return (
      <TemplateBuilder 
        templateId={selectedTemplateId} 
        onBack={() => setSelectedTemplateId(null)} 
      />
    );
  }

  return (
    <div className="container mx-auto py-12 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Assessments</h1>
          <p className="text-slate-600 mt-1">
            Manage assessment templates and track client assessment progress
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
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
                      <div className="flex items-center space-x-2">
                        <Badge variant={template.isStandardized ? "default" : "secondary"}>
                          {template.isStandardized ? "Standard" : "Custom"}
                        </Badge>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleEditTemplate(template)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the template "{template.name}" and all its data. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteTemplate(template.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
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
                        <span>{template.sectionsCount || 0}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Created by</span>
                        <span>{template.createdBy?.fullName || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Version</span>
                        <span>{template.version}</span>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setSelectedTemplateId(template.id)}
                          className="flex-1"
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Build
                        </Button>
                        <Button 
                          size="sm" 
                          className="flex-1"
                          onClick={() => handleAssignTemplate(template)}
                        >
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
              <Button onClick={() => setShowCreateModal(true)}>
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
                          <span>Due: {assignment.dueDate ? formatDateDisplay(assignment.dueDate) : "No due date"}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {getStatusBadge(assignment.status)}
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              if (assignment.status === 'completed') {
                                navigate(`/assessments/${assignment.id}/report`);
                              } else {
                                navigate(`/assessments/${assignment.id}/complete`);
                              }
                            }}
                          >
                            {assignment.status === 'completed' ? 'View Report' : 'Complete'}
                          </Button>
                          <Button 
                            size="sm"
                            onClick={() => {
                              setManagingAssignment(assignment);
                              setShowManageModal(true);
                            }}
                          >
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
              <Button onClick={() => setShowAssignModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Assign Assessment
              </Button>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <CreateTemplateModal 
        open={showCreateModal} 
        onOpenChange={setShowCreateModal} 
      />
      <EditTemplateModal 
        open={showEditModal} 
        onOpenChange={setShowEditModal} 
        template={editingTemplate}
      />
      <AssignAssessmentModal
        open={showAssignModal}
        onOpenChange={(open) => {
          setShowAssignModal(open);
          if (!open) {
            setAssigningTemplate(null);
          }
        }}
        template={assigningTemplate || undefined}
      />

      {/* Assignment Management Modal */}
      <Dialog open={showManageModal} onOpenChange={setShowManageModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Assignment</DialogTitle>
          </DialogHeader>
          
          {managingAssignment && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Assessment</Label>
                <p className="text-sm text-muted-foreground">{managingAssignment.template.name}</p>
              </div>
              
              <div>
                <Label className="text-sm font-medium">Client</Label>
                <p className="text-sm text-muted-foreground">
                  {managingAssignment.client.firstName} {managingAssignment.client.lastName} ({managingAssignment.client.clientId})
                </p>
              </div>
              
              <div>
                <Label className="text-sm font-medium">Status</Label>
                <Select 
                  value={managingAssignment.status} 
                  onValueChange={(value) => {
                    // Update assignment status
                    handleUpdateAssignmentStatus(managingAssignment.id, value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label className="text-sm font-medium">Due Date</Label>
                <Input
                  type="date"
                  value={managingAssignment.dueDate ? managingAssignment.dueDate.split('T')[0] : ''}
                  onChange={(e) => {
                    // Update assignment due date
                    handleUpdateAssignmentDueDate(managingAssignment.id, e.target.value);
                  }}
                />
              </div>
            </div>
          )}
          
          <DialogFooter className="gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                if (managingAssignment) {
                  handleDeleteAssignment(managingAssignment.id);
                }
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Assignment
            </Button>
            
            <Button variant="outline" onClick={() => setShowManageModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}