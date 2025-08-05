import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Icons
import { 
  Users, 
  Calendar, 
  ClipboardList, 
  FileText, 
  Plus,
  Clock,
  CheckCircle,
  CheckSquare,
  AlertTriangle,
  TrendingUp,
  User,
  CalendarDays,
  Target,
  Activity
} from "lucide-react";

// Utils & Types
import { cn } from "@/lib/utils";
import type { Client, Task, User as UserType } from "@shared/schema";

// Components
import AddClientModal from "@/components/client-management/add-client-modal";
import EditClientModal from "@/components/client-management/edit-client-modal";

interface DashboardStats {
  totalClients: number;
  activeClients: number;
  inactiveClients: number;
  pendingClients: number;
}

interface TaskStats {
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  overdueTasks: number;
  urgentTasks: number;
}

interface TaskWithDetails extends Task {
  assignedTo?: UserType;
  client: Client;
}

interface SessionWithDetails {
  id: number;
  clientId: number;
  sessionDate: string;
  sessionTime: string;
  status: string;
  client: Client;
  therapist?: UserType;
}

// Utils & Shared Functions
import { getPriorityColor, getStatusColor, formatDate, formatTime } from "@/lib/task-utils";

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskWithDetails | null>(null);

  // Data Fetching
  const { data: clientStats } = useQuery<DashboardStats>({
    queryKey: ["/api/clients/stats"],
  });

  const { data: taskStats } = useQuery<TaskStats>({
    queryKey: ["/api/tasks/stats"],
  });

  const { data: recentTasks = [] } = useQuery<TaskWithDetails[]>({
    queryKey: ["/api/tasks/recent"],
  });

  const { data: upcomingTasks = [] } = useQuery<TaskWithDetails[]>({
    queryKey: ["/api/tasks/upcoming"],
  });

  // Get all sessions and filter for today in the frontend
  const { data: allSessions = [] } = useQuery<SessionWithDetails[]>({
    queryKey: ["/api/sessions"],
  });

  // Get recent sessions (last 10) instead of just today's
  const recentSessions = allSessions
    .sort((a, b) => new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime())
    .slice(0, 10);
  
  // Also keep today's sessions for today's count metric
  const today = new Date().toISOString().split('T')[0];
  const todaySessions = allSessions.filter(session => 
    session.sessionDate.split('T')[0] === today
  );

  return (
    <div className="container mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Practice Dashboard</h1>
        <p className="text-slate-600 mt-1">Overview of your therapy practice management system</p>
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Active Clients */}
        <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setShowAddClientModal(true)}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Active Clients</p>
                <p className="text-2xl font-bold text-blue-600">{clientStats?.activeClients || 0}</p>
                <p className="text-xs text-slate-500 mt-1">Click to add new client</p>
              </div>
              <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Today's Sessions */}
        <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setShowScheduleModal(true)}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Today's Sessions</p>
                <p className="text-2xl font-bold text-green-600">{todaySessions.length}</p>
                <p className="text-xs text-slate-500 mt-1">Click to schedule session</p>
              </div>
              <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Calendar className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pending Tasks */}
        <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setShowCreateTaskModal(true)}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Pending Tasks</p>
                <p className="text-2xl font-bold text-orange-600">{taskStats?.pendingTasks || 0}</p>
                <p className="text-xs text-slate-500 mt-1">Click to create new task</p>
              </div>
              <div className="h-12 w-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <ClipboardList className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Assessment Templates */}
        <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setLocation("/assessments")}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Assessments</p>
                <p className="text-2xl font-bold text-purple-600">
                  {clientStats?.pendingClients || 0}
                </p>
                <p className="text-xs text-slate-500 mt-1">Pending assignments</p>
              </div>
              <div className="h-12 w-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <FileText className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Button 
              className="h-12 justify-start" 
              variant="outline"
              onClick={() => setShowScheduleModal(true)}
            >
              <Calendar className="w-4 h-4 mr-2" />
              Schedule Session
            </Button>
            <Button 
              className="h-12 justify-start" 
              variant="outline"
              onClick={() => setShowAddClientModal(true)}
            >
              <Users className="w-4 h-4 mr-2" />
              Add New Client
            </Button>
            <Button 
              className="h-12 justify-start" 
              variant="outline"
              onClick={() => setShowCreateTaskModal(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Task
            </Button>
            <Button 
              className="h-12 justify-start" 
              variant="outline"
              onClick={() => setLocation("/assessments")}
            >
              <FileText className="w-4 h-4 mr-2" />
              Assign Assessment
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Activity Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Recent Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Recent Tasks
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setLocation("/tasks")}
              >
                View All
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentTasks.length === 0 ? (
              <div className="text-center py-6 text-slate-500">
                <ClipboardList className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p>No recent tasks</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => setLocation("/tasks")}
                >
                  Create First Task
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentTasks.slice(0, 5).map((task) => (
                  <div 
                    key={task.id} 
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 cursor-pointer"
                    onClick={() => setEditingTask(task)}
                  >
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">{task.title}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-slate-600">{task.client.fullName}</span>
                        <Badge className={cn("text-xs", getPriorityColor(task.priority))}>
                          {task.priority}
                        </Badge>
                      </div>
                    </div>
                    <Badge className={cn("text-xs", getStatusColor(task.status))}>
                      {task.status.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Sessions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5" />
                Recent Sessions
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setLocation("/scheduling")}
              >
                View All Sessions
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentSessions.length === 0 ? (
              <div className="text-center py-6 text-slate-500">
                <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p>No sessions found</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => setShowScheduleModal(true)}
                >
                  Schedule Session
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentSessions.slice(0, 5).map((session) => (
                  <div 
                    key={session.id} 
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 cursor-pointer"
                    onClick={() => setLocation("/scheduling")}
                  >
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">{session.client.fullName}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span className="text-xs text-slate-600">
                          {formatDate(session.sessionDate)}
                        </span>
                      </div>
                    </div>
                    <Badge className={cn("text-xs", getStatusColor(session.status))}>
                      {session.status.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Deadlines */}
      {upcomingTasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Upcoming Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {upcomingTasks.slice(0, 6).map((task) => (
                <div 
                  key={task.id} 
                  className="p-4 border rounded-lg hover:bg-slate-50 cursor-pointer"
                  onClick={() => setEditingTask(task)}
                >
                  <h4 className="font-medium text-sm mb-1">{task.title}</h4>
                  <p className="text-xs text-slate-600 mb-2">{task.client.fullName}</p>
                  <div className="flex items-center justify-between">
                    <Badge className={cn("text-xs", getPriorityColor(task.priority))}>
                      {task.priority}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      {task.dueDate ? formatDate(task.dueDate) : 'No due date'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal Dialogs */}
      
      {/* Add Client Modal */}
      <AddClientModal 
        isOpen={showAddClientModal} 
        onClose={() => setShowAddClientModal(false)} 
      />

      {/* Create Task Modal */}
      <Dialog open={showCreateTaskModal} onOpenChange={setShowCreateTaskModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
            <DialogDescription>
              Quick access to task creation
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600 mb-4">
              Click below to open the full task management page to create a new task.
            </p>
            <Button 
              onClick={() => {
                setShowCreateTaskModal(false);
                setLocation("/tasks");
              }}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Open Task Management
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Task Modal */}
      {editingTask && (
        <Dialog open={!!editingTask} onOpenChange={() => setEditingTask(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Task</DialogTitle>
              <DialogDescription>
                View and edit task details
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="mb-4">
                <h4 className="font-medium text-sm mb-2">{editingTask.title}</h4>
                <p className="text-xs text-slate-600 mb-2">Client: {editingTask.client.fullName}</p>
                <p className="text-xs text-slate-500">{editingTask.description}</p>
              </div>
              <Button 
                onClick={() => {
                  setEditingTask(null);
                  setLocation("/tasks");
                }}
                className="w-full"
              >
                <CheckSquare className="w-4 h-4 mr-2" />
                Open Task Management
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Schedule Session Modal */}
      <Dialog open={showScheduleModal} onOpenChange={setShowScheduleModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Session</DialogTitle>
            <DialogDescription>
              Quick access to scheduling calendar
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600 mb-4">
              Click below to open the full scheduling calendar to book a new session.
            </p>
            <Button 
              onClick={() => {
                setShowScheduleModal(false);
                setLocation("/scheduling");
              }}
              className="w-full"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Open Scheduling Calendar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}