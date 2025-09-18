import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
  Activity,
  AlertCircle,
  MoreVertical,
  Check,
  X,
  UserX,
  Edit3
} from "lucide-react";

// Utils & Types
import { cn } from "@/lib/utils";
import type { Client, Task, User as UserType } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  service?: {
    id: number;
    serviceCode: string;
    serviceName: string;
    duration: number;
    baseRate: string;
  };
}

interface OverdueSessionWithDetails {
  id: number;
  clientId: number;
  therapistId: number;
  sessionDate: string;
  status: string;
  client: Client;
  therapist: UserType;
  daysOverdue: number;
}

// Utils & Shared Functions
import { getPriorityColor, getStatusColor, formatDate, formatTime } from "@/lib/task-utils";
import { useAuth } from "@/hooks/useAuth";

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskWithDetails | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: "", description: "", onConfirm: () => {} });
  
  const { user } = useAuth();
  const { toast } = useToast();

  // Session action mutations
  const updateSessionMutation = useMutation({
    mutationFn: async ({ sessionId, data }: { sessionId: number; data: any }) => {
      return apiRequest(`/api/sessions/${sessionId}`, "PUT", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/overdue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({
        title: "Session updated",
        description: "Session status has been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update session. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Action handlers
  const handleCompleteSession = (sessionId: number) => {
    setConfirmDialog({
      isOpen: true,
      title: "Mark Session as Completed",
      description: "Are you sure you want to mark this session as completed?",
      onConfirm: () => {
        updateSessionMutation.mutate({
          sessionId,
          data: { status: "completed" }
        });
        setConfirmDialog({ ...confirmDialog, isOpen: false });
      }
    });
  };

  const handleNoShowSession = (sessionId: number) => {
    setConfirmDialog({
      isOpen: true,
      title: "Mark Session as No-Show",
      description: "Are you sure you want to mark this session as cancelled due to no-show?",
      onConfirm: () => {
        updateSessionMutation.mutate({
          sessionId,
          data: { status: "cancelled", notes: "No-show" }
        });
        setConfirmDialog({ ...confirmDialog, isOpen: false });
      }
    });
  };

  const handleCancelSession = (sessionId: number) => {
    setConfirmDialog({
      isOpen: true,
      title: "Cancel Session",
      description: "Are you sure you want to cancel this session?",
      onConfirm: () => {
        updateSessionMutation.mutate({
          sessionId,
          data: { status: "cancelled" }
        });
        setConfirmDialog({ ...confirmDialog, isOpen: false });
      }
    });
  };

  // Check if user can edit this session (role-based)
  const canEditSession = (session: OverdueSessionWithDetails) => {
    const userRole = (user?.role || '').toLowerCase();
    const userId = user?.id;
    
    // Accept both "admin" and "administrator" role names
    if (userRole === "admin" || userRole === "administrator") return true;
    
    // Therapists can only edit THEIR OWN assigned sessions
    if (userRole === "therapist") {
      const uid = userId != null ? Number(userId) : undefined;
      const tid = session.therapistId != null ? Number(session.therapistId) : undefined;
      if (uid != null && tid != null && uid === tid) return true;
    }
    
    if (userRole === "supervisor") {
      // Supervisors can edit sessions for their supervised therapists
      // Full supervisor assignment check would be implemented here
      return true;
    }
    return false;
  };

  // Data Fetching
  const { data: clientStats } = useQuery<DashboardStats>({
    queryKey: ["/api/clients/stats", { currentUserId: user?.id, currentUserRole: user?.role }],
    enabled: !!user && !!user?.id,
    queryFn: async () => {
      const userId = user?.id;
      const userRole = (user?.role || '').toLowerCase();
      const params = new URLSearchParams();
      if (userId) params.append('currentUserId', userId.toString());
      if (userRole) params.append('currentUserRole', userRole);
      
      const response = await fetch(`/api/clients/stats?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
  });

  const { data: taskStats } = useQuery<TaskStats>({
    queryKey: ["/api/tasks/stats", { currentUserId: user?.user?.id || user?.id, currentUserRole: user?.user?.role || user?.role }],
    enabled: !!user && !!user?.id,
    queryFn: async () => {
      const userId = user?.id;
      const userRole = (user?.role || '').toLowerCase();
      const params = new URLSearchParams();
      if (userId) params.append('currentUserId', userId.toString());
      if (userRole) params.append('currentUserRole', userRole);
      
      const response = await fetch(`/api/tasks/stats?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch task stats');
      return response.json();
    },
  });

  const { data: recentTasks = [] } = useQuery<TaskWithDetails[]>({
    queryKey: ["/api/tasks/recent", { currentUserId: user?.user?.id || user?.id, currentUserRole: user?.user?.role || user?.role }],
    enabled: !!user && !!user?.id,
    queryFn: async () => {
      const userId = user?.id;
      const userRole = (user?.role || '').toLowerCase();
      const params = new URLSearchParams();
      if (userId) params.append('currentUserId', userId.toString());
      if (userRole) params.append('currentUserRole', userRole);
      
      const response = await fetch(`/api/tasks/recent?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch recent tasks');
      return response.json();
    },
  });

  const { data: upcomingTasks = [] } = useQuery<TaskWithDetails[]>({
    queryKey: ["/api/tasks/upcoming", { currentUserId: user?.user?.id || user?.id, currentUserRole: user?.user?.role || user?.role }],
    enabled: !!user && !!user?.id,
    queryFn: async () => {
      const userId = user?.id;
      const userRole = (user?.role || '').toLowerCase();
      const params = new URLSearchParams();
      if (userId) params.append('currentUserId', userId.toString());
      if (userRole) params.append('currentUserRole', userRole);
      
      const response = await fetch(`/api/tasks/upcoming?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch upcoming tasks');
      return response.json();
    },
  });

  const { data: overdueSessions = [] } = useQuery<OverdueSessionWithDetails[]>({
    queryKey: ["/api/sessions/overdue", { 
      limit: '5',
      currentUserId: user?.id, 
      currentUserRole: (user?.role || '').toLowerCase()
    }],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!user && !!user?.id,
  });

  // Get all sessions for dashboard (using a 3-month range for performance)
  const { data: allSessionsData, isLoading: sessionsLoading, error: sessionsError } = useQuery<{
    sessions: SessionWithDetails[];
    total: number;
  }>({
    queryKey: ["/api/sessions", { 
      limit: 100,
      startDate: new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().split('T')[0],
      endDate: new Date(new Date().setMonth(new Date().getMonth() + 2)).toISOString().split('T')[0],
      currentUserId: user?.id,
      currentUserRole: (user?.role || '').toLowerCase(),
    }],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!user && !!user?.id,
    staleTime: 0, // Always fetch fresh data
  });

  const allSessions = allSessionsData?.sessions || [];
  const today = new Date().toISOString().split('T')[0];

  // Recent Sessions = Past completed sessions only
  const recentSessions = allSessions
    .filter(session => {
      const sessionDate = session.sessionDate.split('T')[0];
      return sessionDate < today && session.status === 'completed';
    })
    .sort((a, b) => new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime())
    .slice(0, 5);

  // Upcoming Sessions = Future scheduled sessions only
  const upcomingSessions = allSessions
    .filter(session => {
      const sessionDate = session.sessionDate.split('T')[0];
      return sessionDate >= today && ['scheduled', 'confirmed'].includes(session.status);
    })
    .sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime())
    .slice(0, 5);

  // Today's sessions for today's count metric
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
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 ${
        user?.role === 'admin' || user?.role === 'supervisor' 
          ? 'lg:grid-cols-4' 
          : 'lg:grid-cols-3'
      }`}>
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

        {/* Assessment Templates - Only show for admin/supervisor */}
        {(user?.role === 'admin' || user?.role === 'supervisor') && (
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
        )}
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
            {/* Only show Assign Assessment for admin/supervisor */}
            {(user?.role === 'admin' || user?.role === 'supervisor') && (
              <Button 
                className="h-12 justify-start" 
                variant="outline"
                onClick={() => setLocation("/assessments")}
              >
                <FileText className="w-4 h-4 mr-2" />
                Assign Assessment
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sessions Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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
                  View All
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <div className="text-center py-6 text-slate-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-300 mx-auto mb-2"></div>
                  <p>Loading sessions...</p>
                </div>
              ) : sessionsError ? (
                <div className="text-center py-6 text-red-500">
                  <Calendar className="w-8 h-8 mx-auto mb-2 text-red-300" />
                  <p>Error loading sessions</p>
                </div>
              ) : recentSessions.length === 0 ? (
                <div className="text-center py-6 text-slate-500">
                  <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p>No recent completed sessions</p>
                  <p className="text-xs text-slate-400 mt-1">Completed sessions will appear here</p>
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
                        <h4 className="font-medium text-sm">{session.client?.fullName}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-xs text-slate-600">
                            {formatDate(session.sessionDate)}
                          </span>
                          {session.service?.serviceCode && (
                            <>
                              <span className="text-xs text-slate-400">•</span>
                              <span className="text-xs text-slate-600 font-mono">
                                {session.service.serviceCode}
                              </span>
                            </>
                          )}
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

          {/* Upcoming Sessions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-blue-500" />
                  Upcoming Sessions
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setLocation("/scheduling")}
                >
                  View Schedule
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <div className="text-center py-6 text-slate-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-300 mx-auto mb-2"></div>
                  <p>Loading sessions...</p>
                </div>
              ) : sessionsError ? (
                <div className="text-center py-6 text-red-500">
                  <Calendar className="w-8 h-8 mx-auto mb-2 text-red-300" />
                  <p>Error loading sessions</p>
                </div>
              ) : upcomingSessions.length === 0 ? (
                <div className="text-center py-6 text-slate-500">
                  <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p>No upcoming sessions</p>
                  <p className="text-xs text-slate-400 mt-1">Schedule new sessions to see them here</p>
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
                  {upcomingSessions.map((session) => (
                    <div 
                      key={session.id} 
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-blue-50 cursor-pointer"
                      onClick={() => setLocation("/scheduling")}
                    >
                      <div className="flex-1">
                        <h4 className="font-medium text-sm">{session.client?.fullName}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-xs text-slate-600">
                            {formatDate(session.sessionDate)}
                          </span>
                          {session.service?.serviceCode && (
                            <>
                              <span className="text-xs text-slate-400">•</span>
                              <span className="text-xs text-slate-600 font-mono">
                                {session.service.serviceCode}
                              </span>
                            </>
                          )}
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

        {/* Tasks and Overdue Sessions Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Recent Tasks */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-green-500" />
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
                          <span className="text-xs text-slate-600">{task.client?.fullName || 'No client'}</span>
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

          {/* Overdue Sessions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  Overdue Sessions
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setLocation("/scheduling")}
                >
                  View All
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overdueSessions.length === 0 ? (
                <div className="text-center py-6 text-slate-500">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p>No overdue sessions</p>
                  <p className="text-xs text-slate-400 mt-1">Great! All sessions are up to date</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {overdueSessions.slice(0, 5).map((session) => (
                    <div 
                      key={session.id} 
                      className="flex items-center justify-between p-3 border rounded-lg border-red-200 hover:bg-red-50"
                    >
                      <div 
                        className="flex-1 cursor-pointer"
                        onClick={() => setLocation("/scheduling")}
                      >
                        <h4 className="font-medium text-sm">{session.client?.fullName}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-slate-600">
                            with {session.therapist?.fullName}
                          </span>
                          <span className="text-xs text-red-600 font-medium">
                            • {session.daysOverdue} days overdue
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-xs text-slate-600">
                            {formatDate(session.sessionDate)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="text-xs bg-red-100 text-red-800 border-red-200">
                          {session.status}
                        </Badge>
                        
                        {canEditSession(session) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 w-8 p-0 relative z-10 hover:bg-slate-100 focus:bg-slate-100"
                                data-testid={`button-actions-session-${session.id}`}
                              >
                                <MoreVertical className="h-4 w-4 text-slate-600" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="z-[9999] min-w-[200px]">
                              <DropdownMenuItem 
                                onClick={() => handleCompleteSession(session.id)}
                                data-testid={`button-complete-session-${session.id}`}
                                className="cursor-pointer"
                              >
                                <Check className="mr-2 h-4 w-4 text-green-600" />
                                Mark Completed
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleNoShowSession(session.id)}
                                data-testid={`button-noshow-session-${session.id}`}
                                className="cursor-pointer"
                              >
                                <UserX className="mr-2 h-4 w-4 text-orange-600" />
                                No-Show (Cancel)
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleCancelSession(session.id)}
                                data-testid={`button-cancel-session-${session.id}`}
                                className="cursor-pointer"
                              >
                                <X className="mr-2 h-4 w-4 text-red-600" />
                                Cancel Session
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => setLocation("/scheduling")}
                                data-testid={`button-reschedule-session-${session.id}`}
                                className="cursor-pointer"
                              >
                                <Edit3 className="mr-2 h-4 w-4 text-blue-600" />
                                Reschedule
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
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
                  <p className="text-xs text-slate-600 mb-2">{task.client?.fullName || 'No client'}</p>
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
                <p className="text-xs text-slate-600 mb-2">Client: {editingTask.client?.fullName || 'No client'}</p>
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

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog.isOpen} onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, isOpen: open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDialog.onConfirm}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}