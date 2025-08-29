import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

// Icons
import { UserCheck, Calendar, Users, Plus, Edit3, Trash2, Shield, User } from "lucide-react";

// Form Handling
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// Types
import type { SupervisorAssignment } from "@shared/schema";

// Utils
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Form Schema
const supervisorAssignmentSchema = z.object({
  supervisorId: z.number().min(1, "Supervisor is required"),
  therapistId: z.number().min(1, "Therapist is required"),
  requiredMeetingFrequency: z.enum(["weekly", "bi-weekly", "monthly"], {
    required_error: "Meeting frequency is required",
  }),
  notes: z.string().optional(),
});

type SupervisorAssignmentFormData = z.infer<typeof supervisorAssignmentSchema>;

export default function SupervisorAssignments() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<SupervisorAssignment | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all supervisor assignments
  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ["/api/supervisor-assignments"],
  });

  // Fetch users to populate supervisor and therapist dropdowns
  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
  });

  // Filter users by role
  const supervisors = users.filter((user: User) => user.role === "supervisor");
  const therapists = users.filter((user: User) => user.role === "therapist");

  // Create supervisor assignment mutation
  const createAssignmentMutation = useMutation({
    mutationFn: (data: SupervisorAssignmentFormData) => 
      apiRequest("/api/supervisor-assignments", "POST", data),
    onSuccess: () => {
      toast({ title: "Supervisor assignment created successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/supervisor-assignments"] });
      setIsCreateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error creating assignment",
        description: error.message || "Failed to create supervisor assignment",
        variant: "destructive",
      });
    },
  });

  // Delete supervisor assignment mutation
  const deleteAssignmentMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/supervisor-assignments/${id}`, "DELETE"),
    onSuccess: () => {
      toast({ title: "Supervisor assignment removed successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/supervisor-assignments"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error removing assignment",
        description: error.message || "Failed to remove supervisor assignment",
        variant: "destructive",
      });
    },
  });

  // Form setup
  const form = useForm<SupervisorAssignmentFormData>({
    resolver: zodResolver(supervisorAssignmentSchema),
    defaultValues: {
      supervisorId: 0,
      therapistId: 0,
      requiredMeetingFrequency: "bi-weekly",
      notes: "",
    },
  });

  const onSubmit = (data: SupervisorAssignmentFormData) => {
    createAssignmentMutation.mutate(data);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "Not set";
    return new Date(dateString).toLocaleDateString();
  };

  const getFrequencyBadgeColor = (frequency: string) => {
    switch (frequency) {
      case "weekly": return "bg-red-100 text-red-800";
      case "bi-weekly": return "bg-yellow-100 text-yellow-800";
      case "monthly": return "bg-green-100 text-green-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">Loading supervisor assignments...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UserCheck className="w-8 h-8" />
            Supervisor Assignments
          </h1>
          <p className="text-muted-foreground">
            Manage supervisor-therapist relationships and supervision schedules
          </p>
        </div>

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Assign Supervisor
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Supervisor Assignment</DialogTitle>
              <DialogDescription>
                Assign a supervisor to oversee a therapist's clinical work
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="supervisorId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supervisor</FormLabel>
                      <Select 
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        value={field.value ? field.value.toString() : ""}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select supervisor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {supervisors.filter(supervisor => supervisor.id && supervisor.id.toString().trim() !== '').map((supervisor) => (
                            <SelectItem key={supervisor.id} value={supervisor.id.toString()}>
                              <div className="flex items-center gap-2">
                                <Shield className="w-4 h-4" />
                                {supervisor.fullName} ({supervisor.username})
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="therapistId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Therapist</FormLabel>
                      <Select 
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        value={field.value ? field.value.toString() : ""}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select therapist" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {therapists.filter(therapist => therapist.id && therapist.id.toString().trim() !== '').map((therapist) => (
                            <SelectItem key={therapist.id} value={therapist.id.toString()}>
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4" />
                                {therapist.fullName} ({therapist.username})
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requiredMeetingFrequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Meeting Frequency</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select frequency" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes (Optional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field} 
                          placeholder="Additional supervision notes..."
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button 
                    type="button" 
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createAssignmentMutation.isPending}
                  >
                    {createAssignmentMutation.isPending ? "Creating..." : "Create Assignment"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {assignments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Supervisor Assignments</h3>
            <p className="text-muted-foreground text-center mb-6">
              Create supervisor assignments to establish clinical oversight relationships
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create First Assignment
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {assignments.map((assignment: any) => (
            <Card key={assignment.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-blue-600" />
                      <span>{assignment.supervisorName || "Unknown Supervisor"}</span>
                    </div>
                    <span className="text-muted-foreground">supervises</span>
                    <div className="flex items-center gap-2">
                      <User className="w-5 h-5 text-green-600" />
                      <span>{assignment.therapistName || "Unknown Therapist"}</span>
                    </div>
                  </CardTitle>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove Supervisor Assignment</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to remove this supervisor assignment? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => deleteAssignmentMutation.mutate(assignment.id)}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Remove Assignment
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardHeader>

              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Meeting Frequency</span>
                    </div>
                    <Badge className={getFrequencyBadgeColor(assignment.requiredMeetingFrequency)}>
                      {assignment.requiredMeetingFrequency || "Not set"}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Last Meeting</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(assignment.lastMeetingDate)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Next Meeting</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(assignment.nextMeetingDate)}
                    </p>
                  </div>
                </div>

                {assignment.notes && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      <strong>Notes:</strong> {assignment.notes}
                    </p>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
                  <p>Assigned on {formatDate(assignment.assignedDate)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}