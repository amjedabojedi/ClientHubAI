import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";

// Icons
import { 
  CalendarDays, 
  Clock, 
  Plus, 
  Users, 
  Filter, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  User,
  MapPin,
  FileText,
  Edit,
  Trash2,
  Eye,
  Upload,
  Home,
  ArrowLeft
} from "lucide-react";

// Utils and Hooks
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

// Session form schema
const sessionFormSchema = z.object({
  clientId: z.number().min(1, "Client is required"),
  therapistId: z.number().min(1, "Therapist is required"),
  sessionDate: z.string().min(1, "Date is required"),
  sessionTime: z.string().min(1, "Time is required"),
  sessionType: z.enum(["assessment", "psychotherapy", "consultation"]),
  duration: z.number().min(15, "Duration must be at least 15 minutes").max(180, "Duration cannot exceed 3 hours"),
  room: z.string().optional(),
  notes: z.string().optional(),
});

type SessionFormData = z.infer<typeof sessionFormSchema>;

interface Session {
  id: number;
  clientId: number;
  therapistId: number;
  sessionDate: string;
  sessionType: string;
  status: string;
  duration: number;
  notes?: string;
  room?: string;
  therapist: {
    id: number;
    fullName: string;
  };
  client?: {
    id: number;
    fullName: string;
  };
}

export default function SchedulingPage() {
  // Routing
  const [, setLocation] = useLocation();
  
  // State
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("month");
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [isEditSessionModalOpen, setIsEditSessionModalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTherapist, setSelectedTherapist] = useState<string>("all");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showMySessionsOnly, setShowMySessionsOnly] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // URL Parameters for client pre-filling
  const urlParams = new URLSearchParams(window.location.search);
  const clientIdFromUrl = urlParams.get('clientId');
  const clientNameFromUrl = urlParams.get('clientName');
  const therapistIdFromUrl = urlParams.get('therapistId');
  const therapistNameFromUrl = urlParams.get('therapistName');
  
  // Fetch sessions for the selected date range
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["/api/sessions", selectedDate.toISOString().split('T')[0], viewMode],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Fetch clients and therapists for dropdowns
  const { data: clients = [] } = useQuery({
    queryKey: ["/api/clients"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: therapists = [] } = useQuery({
    queryKey: ["/api/therapists"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const form = useForm<SessionFormData>({
    resolver: zodResolver(sessionFormSchema),
    defaultValues: {
      clientId: clientIdFromUrl ? parseInt(clientIdFromUrl) : undefined,
      therapistId: therapistIdFromUrl ? parseInt(therapistIdFromUrl) : undefined,
      sessionType: "psychotherapy",
      duration: 60,
      sessionDate: "",
      sessionTime: "",
      room: "",
      notes: "",
    },
  });

  // Auto-open scheduling modal when navigating from client page
  React.useEffect(() => {
    if (clientIdFromUrl) {
      setIsNewSessionModalOpen(true);
      form.setValue('clientId', parseInt(clientIdFromUrl));
      if (therapistIdFromUrl) {
        form.setValue('therapistId', parseInt(therapistIdFromUrl));
      }
      if (clientNameFromUrl) {
        setSearchQuery(decodeURIComponent(clientNameFromUrl));
      }
    }
  }, [clientIdFromUrl, clientNameFromUrl, therapistIdFromUrl, form]);

  const createSessionMutation = useMutation({
    mutationFn: (data: SessionFormData) => {
      const sessionDateTime = new Date(`${data.sessionDate}T${data.sessionTime}`);
      return apiRequest("/api/sessions", "POST", {
        ...data,
        sessionDate: sessionDateTime.toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({
        title: "Success",
        description: "Session scheduled successfully",
      });
      setIsNewSessionModalOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to schedule session",
        variant: "destructive",
      });
    },
  });

  // Event Handlers
  const onSubmit = (data: SessionFormData) => {
    createSessionMutation.mutate(data);
  };

  // Utility Functions
  const getStatusColor = (status: string): string => {
    const statusColors = {
      'scheduled': 'bg-blue-100 text-blue-800',
      'completed': 'bg-green-100 text-green-800',
      'cancelled': 'bg-red-100 text-red-800',
      'no_show': 'bg-yellow-100 text-yellow-800'
    };
    return statusColors[status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800';
  };

  const getSessionTypeColor = (type: string): string => {
    const typeColors = {
      'assessment': 'bg-purple-100 text-purple-800',
      'psychotherapy': 'bg-green-100 text-green-800',
      'consultation': 'bg-blue-100 text-blue-800'
    };
    return typeColors[type as keyof typeof typeColors] || 'bg-gray-100 text-gray-800';
  };

  const getTimeSlots = (): string[] => {
    const slots: string[] = [];
    for (let hour = 8; hour <= 18; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        slots.push(time);
      }
    }
    return slots;
  };

  const getInitials = (name: string): string => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  // Session Filtering and Data Processing
  const filteredSessions = useMemo(() => {
    let filtered = sessions;
    
    if (searchQuery) {
      filtered = filtered.filter((session: Session) =>
        session.client?.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.therapist.fullName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    if (selectedTherapist && selectedTherapist !== "all") {
      filtered = filtered.filter((session: Session) =>
        session.therapistId.toString() === selectedTherapist
      );
    }
    
    return filtered;
  }, [sessions, searchQuery, selectedTherapist]);

  const getTodaysSessions = (): Session[] => {
    const today = selectedDate.toISOString().split('T')[0];
    return filteredSessions.filter((session: Session) => 
      session.sessionDate.split('T')[0] === today
    );
  };

  const getMonthSessions = (): Session[] => {
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    
    return filteredSessions.filter((session: Session) => {
      const sessionDate = new Date(session.sessionDate);
      return sessionDate >= monthStart && sessionDate <= monthEnd;
    });
  };

  const getSessionsForDate = (date: Date): Session[] => {
    const dateStr = date.toISOString().split('T')[0];
    return filteredSessions.filter((session: Session) => 
      session.sessionDate.split('T')[0] === dateStr
    );
  };

  // Navigation Functions
  const navigateMonth = (direction: 'prev' | 'next'): void => {
    setCurrentMonth(prev => {
      const newMonth = new Date(prev);
      if (direction === 'prev') {
        newMonth.setMonth(prev.getMonth() - 1);
      } else {
        newMonth.setMonth(prev.getMonth() + 1);
      }
      return newMonth;
    });
  };

  const goToToday = (): void => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(today);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center space-x-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setLocation("/")}
                className="flex items-center space-x-2"
              >
                <Home className="w-4 h-4" />
                <span>Home</span>
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Scheduling & Calendar</h1>
                <p className="text-slate-600 mt-1">Manage appointments and sessions across your practice</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <Search className="w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search clients or therapists..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-64"
                />
              </div>
              <Select value={selectedTherapist} onValueChange={setSelectedTherapist}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All Therapists" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Therapists</SelectItem>
                  {therapists?.map((therapist: any) => (
                    <SelectItem key={therapist.id} value={therapist.id.toString()}>
                      {therapist.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center space-x-1 bg-slate-100 rounded-lg p-1">
                <Button
                  variant={viewMode === "day" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("day")}
                >
                  Day
                </Button>
                <Button
                  variant={viewMode === "week" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("week")}
                >
                  Week
                </Button>
                <Button
                  variant={viewMode === "month" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("month")}
                >
                  Month
                </Button>
              </div>
              <Button variant="outline">
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
              <Dialog open={isNewSessionModalOpen} onOpenChange={(open) => {
                setIsNewSessionModalOpen(open);
                if (open && clientIdFromUrl) {
                  // Auto-open modal if coming from client page
                  form.setValue('clientId', parseInt(clientIdFromUrl));
                  // Also set search to show the client name for clarity
                  if (clientNameFromUrl) {
                    setSearchQuery(decodeURIComponent(clientNameFromUrl));
                  }
                }
              }}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    {clientNameFromUrl ? `Schedule for ${decodeURIComponent(clientNameFromUrl)}` : 'New Session'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Schedule New Session</DialogTitle>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="clientId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Client</FormLabel>
                              <Select 
                                onValueChange={(value) => field.onChange(parseInt(value))}
                                value={field.value?.toString()}
                                disabled={!!clientIdFromUrl}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select client" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {clients.clients?.map((client: any) => (
                                    <SelectItem key={client.id} value={client.id.toString()}>
                                      {client.fullName}
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
                                value={field.value?.toString()}
                                disabled={!!therapistIdFromUrl}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select therapist" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {therapists?.map((therapist: any) => (
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
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="sessionDate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Date</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="date"
                                  min={new Date().toISOString().split('T')[0]}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="sessionTime"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Time</FormLabel>
                              <Select onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select time" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {getTimeSlots().map((time) => (
                                    <SelectItem key={time} value={time}>
                                      {time}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="sessionType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Session Type</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="assessment">Assessment</SelectItem>
                                  <SelectItem value="psychotherapy">Psychotherapy</SelectItem>
                                  <SelectItem value="consultation">Consultation</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="duration"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Duration (minutes)</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="number"
                                  min={15}
                                  max={180}
                                  step={15}
                                  onChange={(e) => field.onChange(parseInt(e.target.value))}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="room"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Room (optional)</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Room number or name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="notes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Notes (optional)</FormLabel>
                            <FormControl>
                              <Textarea {...field} placeholder="Session notes or special instructions" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="flex justify-end space-x-4 pt-4">
                        <Button type="button" variant="outline" onClick={() => setIsNewSessionModalOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={createSessionMutation.isPending}>
                          {createSessionMutation.isPending ? "Scheduling..." : "Schedule Session"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {viewMode === "month" ? (
          /* Month View */
          <div className="space-y-6">
            {/* Month Navigation */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Button variant="outline" size="sm" onClick={() => navigateMonth('prev')}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-xl font-semibold">
                  {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h2>
                <Button variant="outline" size="sm" onClick={() => navigateMonth('next')}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={goToToday}>
                  Today
                </Button>
              </div>
              <div className="text-sm text-slate-600">
                {getMonthSessions().length} sessions this month
              </div>
            </div>

            {/* Calendar Grid */}
            <Card>
              <CardContent className="p-6">
                <div className="grid grid-cols-7 gap-1">
                  {/* Day Headers */}
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="p-2 text-center text-sm font-medium text-slate-600">
                      {day}
                    </div>
                  ))}
                  
                  {/* Calendar Days */}
                  {Array.from({ length: 42 }, (_, i) => {
                    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
                    const startOfCalendar = new Date(startOfMonth);
                    startOfCalendar.setDate(startOfCalendar.getDate() - startOfMonth.getDay());
                    
                    const currentDate = new Date(startOfCalendar);
                    currentDate.setDate(currentDate.getDate() + i);
                    
                    const isCurrentMonth = currentDate.getMonth() === currentMonth.getMonth();
                    const isToday = currentDate.toDateString() === new Date().toDateString();
                    const isSelected = currentDate.toDateString() === selectedDate.toDateString();
                    const sessionsForDay = getSessionsForDate(currentDate);
                    
                    return (
                      <div
                        key={i}
                        className={`
                          min-h-[120px] p-2 border border-slate-100 cursor-pointer hover:bg-slate-50
                          ${!isCurrentMonth ? 'bg-slate-50 text-slate-400' : ''}
                          ${isToday ? 'bg-blue-50 border-blue-200' : ''}
                          ${isSelected ? 'ring-2 ring-blue-500' : ''}
                        `}
                        onClick={() => setSelectedDate(currentDate)}
                      >
                        <div className={`text-sm font-medium mb-1 ${isToday ? 'text-blue-600' : ''}`}>
                          {currentDate.getDate()}
                        </div>
                        <div className="space-y-1">
                          {sessionsForDay.slice(0, 3).map((session: Session) => (
                            <div
                              key={session.id}
                              className={`
                                text-xs p-1 rounded cursor-pointer truncate
                                ${getSessionTypeColor(session.sessionType)} hover:shadow-sm
                              `}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedSession(session);
                                setIsEditSessionModalOpen(true);
                              }}
                            >
                              {new Date(session.sessionDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {session.client?.fullName}
                            </div>
                          ))}
                          {sessionsForDay.length > 3 && (
                            <div className="text-xs text-slate-500 text-center">
                              +{sessionsForDay.length - 3} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Day/Week View */
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Calendar Sidebar */}
            <div className="lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <CalendarDays className="w-5 h-5" />
                    <span>Calendar</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    className="rounded-md border"
                  />
                </CardContent>
              </Card>

              {/* Today's Summary */}
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Clock className="w-5 h-5" />
                    <span>Today's Sessions</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {getTodaysSessions().length === 0 ? (
                    <p className="text-slate-600 text-sm">No sessions scheduled for today</p>
                  ) : (
                    <div className="space-y-3">
                      {getTodaysSessions().slice(0, 5).map((session: Session) => (
                        <div key={session.id} className="border border-slate-100 rounded-lg p-3 hover:bg-slate-50">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-sm">
                              {new Date(session.sessionDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <Badge className={`${getStatusColor(session.status)} text-xs`} variant="secondary">
                              {session.status}
                            </Badge>
                          </div>
                          <div className="flex items-center space-x-3 mb-2">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="bg-blue-100 text-blue-600 text-xs">
                                {getInitials(session.client?.fullName || 'UC')}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-blue-600">
                                {session.client?.fullName || 'Unknown Client'}
                              </p>
                              <p className="text-xs text-slate-600">
                                with {session.therapist.fullName}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 text-xs text-slate-600">
                            <MapPin className="w-3 h-3" />
                            <span>{session.sessionType} • {session.duration}min</span>
                            {session.room && <span>• Room {session.room}</span>}
                          </div>
                          <div className="flex space-x-1 mt-3">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="flex-1 text-xs h-7"
                              onClick={() => window.location.href = `/clients/${session.clientId}`}
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              View Client
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="text-xs h-7 px-2"
                              onClick={() => {
                                setSelectedSession(session);
                                setIsEditSessionModalOpen(true);
                              }}
                            >
                              <Edit className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Stats */}
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Users className="w-5 h-5" />
                    <span>Quick Stats</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Today</span>
                    <span className="font-medium">{getTodaysSessions().length} sessions</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">This Month</span>
                    <span className="font-medium">{getMonthSessions().length} sessions</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Completed</span>
                    <span className="font-medium text-green-600">
                      {filteredSessions.filter((s: Session) => s.status === 'completed').length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Upcoming</span>
                    <span className="font-medium text-blue-600">
                      {filteredSessions.filter((s: Session) => s.status === 'scheduled').length}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Schedule View */}
            <div className="lg:col-span-3">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      {selectedDate.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </CardTitle>
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center space-x-2">
                        <Switch 
                          checked={showMySessionsOnly}
                          onCheckedChange={setShowMySessionsOnly}
                        />
                        <span className="text-sm text-slate-600">My Sessions Only</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-slate-600">Loading schedule...</p>
                    </div>
                  </div>
                ) : getTodaysSessions().length === 0 ? (
                  <div className="text-center py-12">
                    <CalendarDays className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">No sessions scheduled</h3>
                    <p className="text-slate-600 mb-4">Schedule your first appointment for this day.</p>
                    <Button onClick={() => setIsNewSessionModalOpen(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Schedule Session
                    </Button>
                  </div>
                  ) : (
                    <div className="space-y-4">
                      {getTodaysSessions()
                        .sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime())
                        .map((session: Session) => (
                          <div
                            key={session.id}
                            className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center space-x-4 flex-1">
                                <div className="text-center">
                                  <p className="font-semibold text-lg">
                                    {new Date(session.sessionDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                  <p className="text-xs text-slate-600">{session.duration}min</p>
                                </div>
                                
                                <Avatar className="w-12 h-12">
                                  <AvatarFallback className="bg-blue-100 text-blue-600">
                                    {getInitials(session.client?.fullName || 'UC')}
                                  </AvatarFallback>
                                </Avatar>
                                
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <h3 className="font-medium text-blue-600">
                                      {session.client?.fullName || 'Unknown Client'}
                                    </h3>
                                    <Badge className={getStatusColor(session.status)} variant="secondary">
                                      {session.status}
                                    </Badge>
                                  </div>
                                  <div className="space-y-1 text-sm text-slate-600">
                                    <div className="flex items-center space-x-2">
                                      <User className="w-4 h-4" />
                                      <span>Therapist: {session.therapist.fullName}</span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <FileText className="w-4 h-4" />
                                      <span>{session.sessionType}</span>
                                      <Badge className={getSessionTypeColor(session.sessionType)} variant="secondary">
                                        {session.sessionType}
                                      </Badge>
                                    </div>
                                    {session.room && (
                                      <div className="flex items-center space-x-2">
                                        <MapPin className="w-4 h-4" />
                                        <span>Room: {session.room}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex flex-col space-y-2">
                                <div className="flex space-x-2">
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => window.location.href = `/clients/${session.clientId}`}
                                  >
                                    <Eye className="w-4 h-4 mr-2" />
                                    View Client
                                  </Button>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => {
                                      setSelectedSession(session);
                                      setIsEditSessionModalOpen(true);
                                    }}
                                  >
                                    <Edit className="w-4 h-4 mr-2" />
                                    Edit
                                  </Button>
                                </div>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="text-blue-600 hover:text-blue-700"
                                  onClick={() => {
                                    form.setValue('clientId', session.clientId);
                                    form.setValue('therapistId', session.therapistId);
                                    setIsNewSessionModalOpen(true);
                                  }}
                                >
                                  <Plus className="w-4 h-4 mr-2" />
                                  Schedule Another
                                </Button>
                              </div>
                            </div>
                            
                            {session.notes && (
                              <div className="mt-4 p-3 bg-slate-50 rounded-md">
                                <div className="flex items-center space-x-2 mb-2">
                                  <FileText className="w-4 h-4 text-slate-600" />
                                  <p className="text-sm font-medium text-slate-700">Session Notes:</p>
                                </div>
                                <p className="text-sm text-slate-600">{session.notes}</p>
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
        
        {/* Edit Session Modal */}
        {selectedSession && (
          <Dialog open={isEditSessionModalOpen} onOpenChange={setIsEditSessionModalOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Session Details & Actions</DialogTitle>
              </DialogHeader>
              <div className="space-y-6">
                <div className="flex items-center space-x-4 p-4 bg-slate-50 rounded-lg">
                  <Avatar className="w-16 h-16">
                    <AvatarFallback className="bg-blue-100 text-blue-600 text-lg">
                      {getInitials(selectedSession.client?.fullName || 'UC')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-blue-600">
                      {selectedSession.client?.fullName || 'Unknown Client'}
                    </h3>
                    <p className="text-slate-600">with {selectedSession.therapist.fullName}</p>
                    <div className="flex items-center space-x-4 mt-2 text-sm text-slate-600">
                      <span>
                        {new Date(selectedSession.sessionDate).toLocaleDateString()} at{' '}
                        {new Date(selectedSession.sessionDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <Badge className={getSessionTypeColor(selectedSession.sessionType)} variant="secondary">
                        {selectedSession.sessionType}
                      </Badge>
                      <Badge className={getStatusColor(selectedSession.status)} variant="secondary">
                        {selectedSession.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Duration</label>
                    <p className="text-sm text-slate-600">{selectedSession.duration} minutes</p>
                  </div>
                  {selectedSession.room && (
                    <div>
                      <label className="text-sm font-medium text-slate-700">Room</label>
                      <p className="text-sm text-slate-600">{selectedSession.room}</p>
                    </div>
                  )}
                </div>

                {selectedSession.notes && (
                  <div>
                    <label className="text-sm font-medium text-slate-700">Session Notes</label>
                    <div className="mt-1 p-3 bg-slate-50 rounded-md">
                      <p className="text-sm text-slate-600">{selectedSession.notes}</p>
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-4 border-t">
                  <div className="flex space-x-2">
                    <Button 
                      variant="outline"
                      onClick={() => window.location.href = `/clients/${selectedSession.clientId}`}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Full Client Profile
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => {
                        form.setValue('clientId', selectedSession.clientId);
                        form.setValue('therapistId', selectedSession.therapistId);
                        setIsEditSessionModalOpen(false);
                        setIsNewSessionModalOpen(true);
                      }}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Schedule Another Session
                    </Button>
                  </div>
                  <div className="flex space-x-2">
                    <Button variant="outline" onClick={() => setIsEditSessionModalOpen(false)}>
                      Close
                    </Button>
                    <Button variant="destructive">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Cancel Session
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}