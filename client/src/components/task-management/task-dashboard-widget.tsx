import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// UI Components & Icons
import { 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  User, 
  Calendar,
  Plus,
  ArrowRight,
  Target,
  TrendingUp
} from "lucide-react";

// Utils & Types
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { Task, Client, User as UserType } from "@shared/schema";

interface TaskWithDetails extends Task {
  assignedTo?: UserType;
  client: Client;
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

// Utils & Shared Functions
import { getPriorityColor, getStatusColor, formatDate } from "@/lib/task-utils";

// ===== TASK DASHBOARD WIDGET =====
export default function TaskDashboardWidget() {
  const [, setLocation] = useLocation();

  // Fetch task statistics
  const { data: taskStats } = useQuery<TaskStats>({
    queryKey: ["/api/tasks/stats"],
  });

  // Fetch recent tasks
  const { data: recentTasks = [] } = useQuery<TaskWithDetails[]>({
    queryKey: ["/api/tasks/recent"],
  });

  // Fetch upcoming tasks
  const { data: upcomingTasks = [] } = useQuery<TaskWithDetails[]>({
    queryKey: ["/api/tasks/upcoming"],
  });

  return (
    <div className="space-y-6">
      {/* Task Statistics Overview */}
      {taskStats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Task Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{taskStats.pendingTasks}</div>
                <p className="text-sm text-slate-600">Pending</p>
              </div>
              <div className="text-center p-3 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">{taskStats.inProgressTasks}</div>
                <p className="text-sm text-slate-600">In Progress</p>
              </div>
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{taskStats.overdueTasks}</div>
                <p className="text-sm text-slate-600">Overdue</p>
              </div>
              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">{taskStats.urgentTasks}</div>
                <p className="text-sm text-slate-600">Urgent</p>
              </div>
            </div>
            
            <div className="mt-4 flex gap-3">
              <Button onClick={() => setLocation("/tasks")} className="flex-1">
                <Target className="w-4 h-4 mr-2" />
                View All Tasks
              </Button>
              <Button variant="outline" onClick={() => setLocation("/tasks")}>
                <Plus className="w-4 h-4 mr-2" />
                New Task
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Tasks
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation("/tasks")}
            >
              View All
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentTasks.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              <Clock className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p>No recent tasks</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTasks.map((task) => (
                <div 
                  key={task.id} 
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 cursor-pointer"
                  onClick={() => setLocation("/tasks")}
                >
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{task.title}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span 
                        className="text-xs text-slate-600 hover:text-primary cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocation(`/clients/${task.client.id}`);
                        }}
                      >
                        {task.client.fullName}
                      </span>
                      {task.dueDate && (
                        <span className="text-xs text-slate-500">
                          Due: {formatDate(task.dueDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge className={cn("text-xs", getPriorityColor(task.priority))}>
                      {task.priority}
                    </Badge>
                    <Badge className={cn("text-xs", getStatusColor(task.status))}>
                      {task.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Upcoming Due Dates
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation("/tasks")}
            >
              View All
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingTasks.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p>No upcoming deadlines</p>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingTasks.map((task) => (
                <div 
                  key={task.id} 
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 cursor-pointer"
                  onClick={() => setLocation("/tasks")}
                >
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{task.title}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span 
                        className="text-xs text-slate-600 hover:text-primary cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocation(`/clients/${task.client.id}`);
                        }}
                      >
                        {task.client.fullName}
                      </span>
                      {task.assignedTo && (
                        <span className="text-xs text-slate-500">
                          Assigned to {task.assignedTo.fullName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={cn("text-xs", getPriorityColor(task.priority))}>
                      {task.priority}
                    </Badge>
                    <div className="text-xs text-slate-600 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(task.dueDate)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}