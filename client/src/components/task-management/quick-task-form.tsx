import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// UI Components & Icons
import { Plus, CheckSquare, ChevronDown, Check } from "lucide-react";

// Utils
import { cn } from "@/lib/utils";

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
      assignedToId: defaultAssigneeId || undefined,
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
  const { data: taskTitleOptions } = useQuery({
    queryKey: ["/api/system-options/categories", 31],
  });

  const createTaskMutation = useMutation({
    mutationFn: (data: QuickTaskFormData) => {
      const taskData = {
        ...data,
        clientId,
        status: 'pending' as const,
        assignedToId: data.assignedToId || undefined,
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
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "w-full justify-between",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value || "Select a task title..."}
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0">
                        <Command>
                          <CommandInput placeholder="Search task titles..." />
                          <CommandList>
                            <CommandEmpty>No task titles found.</CommandEmpty>
                            <CommandGroup>
                              {taskTitleOptions?.options?.map((option: any) => (
                                <CommandItem
                                  key={option.id}
                                  onSelect={() => {
                                    field.onChange(option.optionLabel);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      field.value === option.optionLabel
                                        ? "opacity-100"
                                        : "opacity-0"
                                    )}
                                  />
                                  {option.optionLabel}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
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
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "w-full justify-between",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? 
                              field.value.charAt(0).toUpperCase() + field.value.slice(1) 
                              : "Select priority..."
                            }
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0">
                        <Command>
                          <CommandInput placeholder="Search priority..." />
                          <CommandList>
                            <CommandEmpty>No priority found.</CommandEmpty>
                            <CommandGroup>
                              {["low", "medium", "high", "urgent"].map((priority) => (
                                <CommandItem
                                  key={priority}
                                  onSelect={() => {
                                    field.onChange(priority);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      field.value === priority
                                        ? "opacity-100"
                                        : "opacity-0"
                                    )}
                                  />
                                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          className={cn(
                            "w-full justify-between",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? 
                            therapists?.find((therapist: UserType) => therapist.id === field.value)?.fullName || "Select assignee..." 
                            : "Unassigned"
                          }
                          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0">
                      <Command>
                        <CommandInput placeholder="Search staff..." />
                        <CommandList>
                          <CommandEmpty>No staff found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              onSelect={() => {
                                field.onChange(0);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  !field.value || field.value === 0 ? "opacity-100" : "opacity-0"
                                )}
                              />
                              Unassigned
                            </CommandItem>
                            {therapists?.map((therapist: UserType) => (
                              <CommandItem
                                key={therapist.id}
                                onSelect={() => {
                                  field.onChange(therapist.id);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    field.value === therapist.id
                                      ? "opacity-100"
                                      : "opacity-0"
                                  )}
                                />
                                {therapist.fullName}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
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