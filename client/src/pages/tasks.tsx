import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// UI Components & Icons
import { 
  Plus, 
  Search, 
  Filter, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  User, 
  Calendar,
  ChevronDown,
  Check,
  ArrowUpDown,
  Edit,
  Trash2,
  Eye,
  AlertTriangle,
  Target,
  TrendingUp,
  Users,
  ClipboardList
} from "lucide-react";

// Utils & Types
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { Task, Client, User as UserType } from "@shared/schema";

// Components
import { TaskComments } from "@/components/task-management/task-comments";

interface TaskWithDetails extends Task {
  assignedTo?: UserType;
  client: Client;
}

interface TasksQueryResult {
  tasks: TaskWithDetails[];
  total: number;
  totalPages: number;
}

interface TaskStats {
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  overdueTasks: number;
  highPriorityTasks: number;
  urgentTasks: number;
}

// ===== FORM VALIDATION SCHEMA =====
// This schema defines what data is required and allowed for creating/editing tasks
const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),                    // Task name - required field
  description: z.string().optional(),                               // Optional detailed description
  clientId: z.number().min(1, "Client is required"),               // Links task to a specific client - required
  assignedToId: z.number().optional().nullable(),                  // Which therapist/staff member handles this task (can be null for unassigned)
  priority: z.enum(["low", "medium", "high", "urgent"]),          // Task importance level
  status: z.enum(["pending", "in_progress", "completed", "overdue"]), // Current task state
  dueDate: z.string().optional(),                                  // When task should be completed (HTML date input format)
});

type TaskFormData = z.infer<typeof taskFormSchema>;

// ===== UTILITY FUNCTIONS =====
const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
    case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'low': return 'bg-green-100 text-green-800 border-green-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-800 border-green-200';
    case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'overdue': return 'bg-red-100 text-red-800 border-red-200';
    case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const formatDate = (dateString: string | null) => {
  if (!dateString) return 'No due date';
  return new Date(dateString).toLocaleDateString();
};

// ===== TASK FORM COMPONENT =====
function TaskForm({ task, onSuccess }: { task?: TaskWithDetails; onSuccess: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task?.title || "",
      description: task?.description || "",
      clientId: task?.clientId || 0,
      assignedToId: task?.assignedToId || 0,
      priority: task?.priority || "medium",
      status: task?.status || "pending",
      dueDate: task?.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : "",
    },
  });

  // ===== DATA FETCHING =====
  // Fetch all clients to populate the "Assign to Client" dropdown
  // This loads client list when component mounts and caches the result
  const { data: clientsData, isLoading: clientsLoading } = useQuery({
    queryKey: ["/api/clients"],                                     // Cache key for React Query
  });

  // Fetch all therapists/staff to populate the "Assigned To" dropdown
  // This shows who can be responsible for completing the task
  const { data: therapists = [] } = useQuery({
    queryKey: ["/api/therapists"],                                  // Cache key for therapist list
  });

  // Fetch task title options from system settings
  const { data: taskTitleOptions } = useQuery({
    queryKey: ["/api/system-options/categories", 31],               // Task Titles category ID
  });

  // ===== TASK CREATION WORKFLOW =====
  // This mutation handles creating new tasks when form is submitted
  const createTaskMutation = useMutation({
    mutationFn: async (data: TaskFormData) => {
      // Step 1: Send task data to backend API endpoint
      const response = await apiRequest("/api/tasks", "POST", data);
      // Step 2: Parse the response (returns the created task with ID)
      return response.json();
    },
    onSuccess: () => {
      // Step 3: When task creation succeeds:
      toast({ title: "Task created successfully!" });              // Show success message to user
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }); // Refresh task list to show new task
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] }); // Update task statistics counters
      onSuccess();                                                  // Close the form dialog
    },
    onError: (error: any) => {
      // Step 4: If task creation fails, show error message
      toast({ title: "Error creating task", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: (data: TaskFormData) => apiRequest(`/api/tasks/${task?.id}`, "PUT", data),
    onSuccess: () => {
      toast({ title: "Task updated successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Error updating task", variant: "destructive" });
    },
  });

  // ===== FORM SUBMISSION HANDLER =====
  // This function runs when user clicks "Create Task" or "Update Task" button
  const onSubmit = (data: TaskFormData) => {
    // Step 1: Transform form data into database-compatible format
    const taskData = {
      ...data,                                                      // Copy all form fields
      // Step 2: Clean up text fields (remove empty strings, use undefined instead)
      description: data.description && data.description.trim() ? 
        data.description.trim() : undefined,                       // Only save description if it has actual content
      // Step 3: Convert date string to Date object (required by database schema)
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined, // Convert "2025-07-13" to Date object
      // Step 4: Set completion timestamp for completed tasks
      completedAt: data.status === 'completed' ? new Date() : undefined, // Auto-timestamp when marked complete
    };

    // Step 5: Choose create or update based on whether we're editing existing task
    if (task) {
      updateTaskMutation.mutate(taskData);                         // Update existing task
    } else {
      createTaskMutation.mutate(taskData);                         // Create new task
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                  placeholder="Or enter custom task title..." 
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
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Enter task description..." 
                  className="min-h-[100px]"
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ===== CLIENT AND ASSIGNMENT SELECTION ===== */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CLIENT SELECTION DROPDOWN */}
          {/* This dropdown shows all clients and lets user choose which client this task is for */}
          <FormField
            control={form.control}
            name="clientId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Client</FormLabel>
                <Select 
                  onValueChange={(value) => field.onChange(parseInt(value))}  // Convert string ID to number for database
                  value={field.value?.toString() || ""}                      // Convert number ID to string for Select component
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={clientsLoading ? "Loading clients..." : "Select client..."} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {clientsLoading ? (
                      // Show loading state while fetching clients
                      <SelectItem value="loading" disabled>
                        Loading clients...
                      </SelectItem>
                    ) : Array.isArray(clientsData?.clients) && clientsData.clients.length > 0 ? (
                      // Map through all clients and create dropdown options
                      clientsData.clients.map((client: Client) => (
                        <SelectItem key={client.id} value={client.id.toString()}>
                          {client.fullName} ({client.clientId})              {/* Show name and ID for easy identification */}
                        </SelectItem>
                      ))
                    ) : (
                      // Show message if no clients are available
                      <SelectItem value="no-clients" disabled>
                        No clients available
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* STAFF ASSIGNMENT DROPDOWN */}
          {/* This dropdown shows all therapists/staff and lets user assign task to someone */}
          <FormField
            control={form.control}
            name="assignedToId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Assigned To</FormLabel>
                <Select 
                  onValueChange={(value) => field.onChange(value === "unassigned" ? null : parseInt(value))} // Handle "unassigned" as null
                  value={field.value ? field.value.toString() : "unassigned"}  // Show "unassigned" if no value
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select assignee..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>    {/* Option for tasks not assigned to anyone */}
                    {Array.isArray(therapists) && therapists.map((therapist: UserType) => (
                      <SelectItem key={therapist.id} value={therapist.id.toString()}>
                        {therapist.fullName}                                   {/* Show therapist/staff member names */}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
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

        <div className="flex gap-3">
          <Button 
            type="submit" 
            disabled={createTaskMutation.isPending || updateTaskMutation.isPending}
          >
            {createTaskMutation.isPending || updateTaskMutation.isPending 
              ? "Saving..." 
              : task ? "Update Task" : "Create Task"
            }
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ===== TASK CARD COMPONENT =====
function TaskCard({ task, onEdit, onDelete, onViewComments }: { 
  task: TaskWithDetails; 
  onEdit: (task: TaskWithDetails) => void; 
  onDelete: (taskId: number) => void;
  onViewComments: (task: TaskWithDetails) => void;
}) {
  const [, setLocation] = useLocation();

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="font-semibold text-lg text-slate-900 mb-1">{task.title}</h3>
            <p className="text-slate-600 text-sm line-clamp-2">{task.description || "No description"}</p>
          </div>
          
          <div className="flex gap-2 ml-4">
            <Button variant="ghost" size="sm" onClick={() => onViewComments(task)} title="View Comments">
              <ClipboardList className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onEdit(task)} title="Edit Task">
              <Edit className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(task.id)} title="Delete Task">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <Badge className={cn("text-xs", getPriorityColor(task.priority))}>
              {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
            </Badge>
            <Badge className={cn("text-xs", getStatusColor(task.status))}>
              {task.status.replace('_', ' ').charAt(0).toUpperCase() + task.status.replace('_', ' ').slice(1)}
            </Badge>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-600">
            <div className="flex items-center gap-1">
              <User className="w-4 h-4" />
              <span 
                className="hover:text-primary cursor-pointer"
                onClick={() => setLocation(`/clients/${task.client.id}`)}
              >
                {task.client.fullName}
              </span>
            </div>
            
            {task.dueDate && (
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                <span>{formatDate(task.dueDate)}</span>
              </div>
            )}
          </div>

          {task.assignedTo && (
            <div className="flex items-center gap-1 text-sm text-slate-600">
              <Target className="w-4 h-4" />
              <span>Assigned to {task.assignedTo.fullName}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ===== MAIN TASKS PAGE COMPONENT =====
export default function TasksPage() {
  const [activeTab, setActiveTab] = useState("active");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskWithDetails | null>(null);
  const [selectedTaskForComments, setSelectedTaskForComments] = useState<TaskWithDetails | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // ===== REACT QUERY SETUP =====
  const { data: tasksData, isLoading } = useQuery<TasksQueryResult>({
    queryKey: [
      "/api/tasks", 
      { 
        page, 
        search: search || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        assignedToId: assigneeFilter !== 'all' ? (assigneeFilter === 'unassigned' ? '' : assigneeFilter) : undefined,
        includeCompleted: activeTab === "all"
      }
    ],
  });

  const { data: taskStats } = useQuery<TaskStats>({
    queryKey: ["/api/tasks/stats"],
  });

  const { data: therapists = [] } = useQuery({
    queryKey: ["/api/therapists"],
  });

  // ===== API MUTATIONS =====
  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: number) => apiRequest(`/api/tasks/${taskId}`, "DELETE"),
    onSuccess: () => {
      toast({ title: "Task deleted successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
    },
    onError: () => {
      toast({ title: "Error deleting task", variant: "destructive" });
    },
  });

  // ===== EVENT HANDLERS =====
  const handleEdit = (task: TaskWithDetails) => {
    setEditingTask(task);
  };

  const handleDelete = (taskId: number) => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTaskMutation.mutate(taskId);
    }
  };

  const handleViewComments = (task: TaskWithDetails) => {
    setSelectedTaskForComments(task);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setPage(1);
  };

  const tasks = tasksData?.tasks || [];
  const totalPages = tasksData?.totalPages || 1;

  return (
    <div className="container mx-auto px-4 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Task Management</h1>
          <p className="text-slate-600 mt-1">Manage and track all client-related tasks</p>
        </div>
        
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setLocation("/tasks/history")}>
            <Clock className="w-4 h-4 mr-2" />
            View History
          </Button>
          
          <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Task
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create New Task</DialogTitle>
                <DialogDescription>
                  Create a new task and assign it to a client and therapist.
                </DialogDescription>
              </DialogHeader>
              <TaskForm onSuccess={() => setShowCreateModal(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Task Statistics Dashboard */}
      {taskStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{taskStats.totalTasks}</div>
              <p className="text-sm text-slate-600">Total Tasks</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{taskStats.pendingTasks}</div>
              <p className="text-sm text-slate-600">Pending</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{taskStats.inProgressTasks}</div>
              <p className="text-sm text-slate-600">In Progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{taskStats.completedTasks}</div>
              <p className="text-sm text-slate-600">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{taskStats.overdueTasks}</div>
              <p className="text-sm text-slate-600">Overdue</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">{taskStats.highPriorityTasks}</div>
              <p className="text-sm text-slate-600">High Priority</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-700">{taskStats.urgentTasks}</div>
              <p className="text-sm text-slate-600">Urgent</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  placeholder="Search tasks, clients..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <div className="flex gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>

              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priority</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>

              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assignees</SelectItem>
                  {Array.isArray(therapists) && therapists.map((therapist: UserType) => (
                    <SelectItem key={therapist.id} value={therapist.id.toString()}>
                      {therapist.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Task Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList>
          <TabsTrigger value="active">Active Tasks</TabsTrigger>
          <TabsTrigger value="all">All Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-slate-600">Loading tasks...</p>
              </div>
            </div>
          ) : tasks.length === 0 ? (
            <Card className="p-8 text-center">
              <ClipboardList className="h-12 w-12 mx-auto text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No tasks found</h3>
              <p className="text-slate-600 mb-4">
                {search || statusFilter || priorityFilter || assigneeFilter
                  ? "No tasks match your current filters."
                  : "Create your first task to get started."}
              </p>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Task
              </Button>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onViewComments={handleViewComments}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  
                  <span className="flex items-center px-4 py-2 text-sm text-slate-600">
                    Page {page} of {totalPages}
                  </span>

                  <Button
                    variant="outline"
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Task Modal */}
      <Dialog open={!!editingTask} onOpenChange={() => setEditingTask(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          {editingTask && (
            <TaskForm 
              task={editingTask} 
              onSuccess={() => setEditingTask(null)} 
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Task Comments Modal */}
      <Dialog open={!!selectedTaskForComments} onOpenChange={() => setSelectedTaskForComments(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Task Comments & Progress</DialogTitle>
            <DialogDescription>
              Track progress and communicate with team members about this task.
            </DialogDescription>
          </DialogHeader>
          {selectedTaskForComments && (
            <TaskComments 
              taskId={selectedTaskForComments.id}
              taskTitle={selectedTaskForComments.title}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}