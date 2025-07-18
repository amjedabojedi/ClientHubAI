import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// UI Components & Icons
import { Plus, CheckSquare } from "lucide-react";

// Utils & Types
import { apiRequest } from "@/lib/queryClient";
import type { User as UserType } from "@shared/schema";

// ===== FORM SCHEMA =====
const quickTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  assignedToId: z.number().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  dueDate: z.string().optional(),
});

type QuickTaskFormData = z.infer<typeof quickTaskSchema>;

interface QuickTaskFormProps {
  clientId: number;
  clientName: string;
  defaultAssigneeId?: number;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export default function QuickTaskForm({ 
  clientId, 
  clientName, 
  defaultAssigneeId, 
  trigger,
  onSuccess 
}: QuickTaskFormProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<QuickTaskFormData>({
    resolver: zodResolver(quickTaskSchema),
    defaultValues: {
      title: "",
      description: "",
      assignedToId: defaultAssigneeId || 0,
      priority: "medium",
      dueDate: "",
    },
  });

  // Fetch therapists for assignment
  const { data: therapists = [] } = useQuery({
    queryKey: ["/api/therapists"],
    queryFn: () => apiRequest("/api/therapists", "GET"),
  });

  // Fetch task title options from system settings
  const { data: taskTitleOptions = [] } = useQuery({
    queryKey: ["/api/system-options/categories", 31],
  });

  const createTaskMutation = useMutation({
    mutationFn: (data: QuickTaskFormData) => {
      const taskData = {
        ...data,
        clientId,
        status: 'pending' as const,
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : undefined,
      };
      return apiRequest("/api/tasks", "POST", taskData);
    },
    onSuccess: () => {
      toast({ title: "Task created successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "tasks"] });
      form.reset();
      setOpen(false);
      onSuccess?.();
    },
    onError: () => {
      toast({ title: "Error creating task", variant: "destructive" });
    },
  });

  const onSubmit = (data: QuickTaskFormData) => {
    createTaskMutation.mutate(data);
  };

  const defaultTrigger = (
    <Button variant="outline" size="sm">
      <Plus className="w-4 h-4 mr-2" />
      Add Task
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5" />
            Create Task for {clientName}
          </DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Title</FormLabel>
                  <div className="space-y-2">
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a task title..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {taskTitleOptions?.options?.map((option: any) => (
                          <SelectItem key={option.id} value={option.optionLabel}>
                            {option.optionLabel}
                          </SelectItem>
                        )) || []}
                      </SelectContent>
                    </Select>
                    <Input 
                      placeholder="Or enter custom title..." 
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Additional details..." 
                      className="min-h-[80px]"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="assignedToId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assign To</FormLabel>
                  <Select 
                    onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} 
                    value={field.value?.toString() || ""}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select assignee..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {Array.isArray(therapists) && therapists.map((therapist: UserType) => (
                        <SelectItem key={therapist.id} value={therapist.id.toString()}>
                          {therapist.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3 pt-4">
              <Button 
                type="submit" 
                disabled={createTaskMutation.isPending}
                className="flex-1"
              >
                {createTaskMutation.isPending ? "Creating..." : "Create Task"}
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}