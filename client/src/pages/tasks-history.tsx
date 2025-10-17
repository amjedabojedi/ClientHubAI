/**
 * Task History Page
 * 
 * This page provides a historical view of all tasks in the system with advanced filtering capabilities.
 * 
 * Key Features:
 * - View all tasks with historical data
 * - Filter by status, priority, and assignee
 * - Tab-based views (All, Completed, Overdue, Recent)
 * - Search functionality
 * - Pagination for large datasets
 * - Client-linked tasks with breadcrumb navigation back to tasks-history page
 * 
 * Components:
 * - TaskCard (shared): Reusable task display component with consistent styling across the app
 * 
 * Data Flow:
 * - Fetches tasks from /api/tasks with includeCompleted=true to show all historical data
 * - Client-side filtering for tab-based views and search
 * - All dates displayed in America/New_York timezone
 */

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

// Components
import { TaskCard, type TaskWithDetails } from "@/components/tasks/task-card";

interface TasksQueryResult {
  tasks: TaskWithDetails[];
  total: number;
  totalPages: number;
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
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
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
              <div className="mb-6 space-y-4">
                {filteredTasks.map((task: TaskWithDetails) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    fromPage="tasks-history"
                    onEdit={() => {}}
                    onDelete={() => {}}
                    onViewComments={() => {}}
                    onViewTask={() => {}}
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
    </div>
  );
}