import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// UI Components & Icons
import { 
  History, 
  Search, 
  Calendar, 
  User, 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  ArrowLeft,
  Filter,
  Target,
  MessageSquare
} from "lucide-react";

// Utils & Types
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { Task, Client, User as UserType } from "@shared/schema";

interface TaskWithDetails extends Task {
  assignedTo?: UserType;
  client: Client;
  commentCount?: number;
  recentComments?: Array<{
    id: number;
    content: string;
    createdAt: string;
    author: {
      id: number;
      fullName: string;
    };
  }>;
}

interface TasksQueryResult {
  tasks: TaskWithDetails[];
  total: number;
  totalPages: number;
}

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
  if (!dateString) return 'N/A';
  // Format date consistently across the app
  return format(new Date(String(dateString)), 'MMM dd, yyyy');
};

const formatDateTime = (dateString: string | null) => {
  if (!dateString) return 'N/A';
  return format(new Date(String(dateString)), "MMM dd, yyyy 'at' h:mm a");
};

// ===== TASK HISTORY ITEM COMPONENT =====
function TaskHistoryItem({ task }: { task: TaskWithDetails }) {
  const [, setLocation] = useLocation();

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {/* Status indicator dot */}
          <div className={cn(
            "w-3 h-3 rounded-full",
            task.status === 'completed' ? 'bg-green-500' :
            task.status === 'in_progress' ? 'bg-blue-500' :
            task.status === 'overdue' ? 'bg-red-500' :
            'bg-yellow-500'
          )}></div>
          
          {/* Task details */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-slate-900">{task.title}</h4>
              <span className="text-slate-300">•</span>
              <Badge 
                variant="outline"
                className={cn(
                  task.priority === 'urgent' ? 'bg-red-50 text-red-700 border-red-200' :
                  task.priority === 'high' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                  task.priority === 'medium' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                  'bg-green-50 text-green-700 border-green-200'
                )}
              >
                {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
              </Badge>
              <Badge 
                variant="outline"
                className={cn(
                  task.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
                  task.status === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                  task.status === 'overdue' ? 'bg-red-50 text-red-700 border-red-200' :
                  'bg-yellow-50 text-yellow-700 border-yellow-200'
                )}
              >
                {task.status.replace('_', ' ').charAt(0).toUpperCase() + task.status.replace('_', ' ').slice(1)}
              </Badge>
            </div>
            
            <div className="text-sm space-y-1">
              <p className="text-slate-600">
                <span 
                  className="hover:text-primary cursor-pointer font-medium"
                  onClick={() => setLocation(`/clients/${task.client.id}?from=tasks-history`)}
                >
                  {task.client.fullName}
                </span>
                {task.dueDate && (
                  <span className="text-slate-500 ml-2">
                    <Calendar className="w-3 h-3 inline mr-1" />
                    {formatInTimeZone(new Date(task.dueDate), 'America/New_York', 'MMM d, yyyy')}
                  </span>
                )}
                {task.assignedTo && (
                  <span className="text-slate-500 ml-2">
                    <Target className="w-3 h-3 inline mr-1" />
                    {task.assignedTo.fullName}
                  </span>
                )}
              </p>
              
              {task.description && (
                <>
                  <div className="border-t border-slate-200 my-2"></div>
                  <p className="text-slate-600 italic">{task.description}</p>
                </>
              )}
              
              <div className="flex items-center gap-4 text-xs text-slate-500 mt-2">
                <span>Created: {formatInTimeZone(new Date(task.createdAt), 'America/New_York', 'MMM d, yyyy')}</span>
                {task.completedAt && (
                  <span className="text-green-600">Completed: {formatInTimeZone(new Date(task.completedAt), 'America/New_York', 'MMM d, yyyy')}</span>
                )}
              </div>
              
              {(task.commentCount !== undefined && task.commentCount > 0) && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <MessageSquare className="w-3 h-3" />
                    <span className="font-semibold">Comments:</span>
                    <span>{task.commentCount}</span>
                  </div>
                  
                  {task.recentComments && task.recentComments.length > 0 && (
                    <div className="ml-4 space-y-2">
                      {task.recentComments.map((comment) => (
                        <div key={comment.id} className="text-xs border-l-2 border-slate-300 pl-2">
                          <div className="text-slate-600 italic">"{comment.content}"</div>
                          <div className="text-slate-500 mt-0.5">{comment.author.fullName}, {formatInTimeZone(new Date(comment.createdAt), 'America/New_York', 'MMM d, yyyy')}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== MAIN TASK HISTORY PAGE =====
export default function TaskHistoryPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Fetch tasks with history (including completed)
  const { data: tasksData, isLoading } = useQuery<TasksQueryResult>({
    queryKey: [
      "/api/tasks", 
      { 
        page, 
        search, 
        status: statusFilter, 
        priority: priorityFilter, 
        assignedToId: assigneeFilter, 
        includeCompleted: true // Always include completed tasks in history
      }
    ] as const,
    queryFn: async ({ queryKey }) => {
      const [url, params] = queryKey as [string, {
        page: number;
        search: string;
        status: string;
        priority: string;
        assignedToId: string;
        includeCompleted: boolean;
      }];
      const searchParams = new URLSearchParams();
      
      if (params.page) searchParams.set('page', params.page.toString());
      if (params.search) searchParams.set('search', params.search);
      if (params.status && params.status !== 'all') searchParams.set('status', params.status);
      if (params.priority && params.priority !== 'all') searchParams.set('priority', params.priority);
      if (params.assignedToId && params.assignedToId !== 'all') {
        searchParams.set('assignedToId', params.assignedToId === 'unassigned' ? '' : params.assignedToId);
      }
      searchParams.set('includeCompleted', 'true');
      
      const fullUrl = searchParams.toString() ? `${url}?${searchParams.toString()}` : url;
      const response = await apiRequest(fullUrl, "GET");
      return response.json() as Promise<TasksQueryResult>;
    },
  });

  const { data: therapists = [] } = useQuery({
    queryKey: ["/api/therapists"],
    queryFn: () => apiRequest("/api/therapists", "GET"),
  });

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setPage(1);
  };

  const tasks = tasksData?.tasks || [];
  const totalPages = tasksData?.totalPages || 1;

  // Filter tasks by tab
  const filteredTasks = tasks.filter((task: TaskWithDetails) => {
    switch (activeTab) {
      case "completed":
        return task.status === "completed";
      case "overdue":
        return task.status === "overdue";
      case "recent":
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        return new Date(String(task.createdAt)) >= lastWeek;
      default:
        return true;
    }
  });

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation("/tasks")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Tasks
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <History className="w-8 h-8" />
              Task History
            </h1>
            <p className="text-slate-600 mt-1">Complete history of all tasks and their progress</p>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  placeholder="Search task history..."
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
                  {Array.isArray(therapists) && therapists.filter((therapist: UserType) => therapist.id && therapist.id.toString().trim() !== '').map((therapist: UserType) => (
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

      {/* History Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All Tasks</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
          <TabsTrigger value="recent">Recent</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-slate-600">Loading task history...</p>
              </div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <Card className="p-8 text-center">
              <History className="h-12 w-12 mx-auto text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No task history found</h3>
              <p className="text-slate-600 mb-4">
                {search || statusFilter || priorityFilter || assigneeFilter
                  ? "No tasks match your current filters."
                  : "No tasks have been created yet."}
              </p>
              <Button onClick={() => setLocation("/tasks")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Tasks
              </Button>
            </Card>
          ) : (
            <>
              <div className="mb-6">
                {filteredTasks.map((task: TaskWithDetails) => (
                  <TaskHistoryItem key={task.id} task={task} />
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
    </div>
  );
}