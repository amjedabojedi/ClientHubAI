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
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
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
  ArrowLeft,
  CheckCircle,
  X,
  AlertCircle
} from "lucide-react";

// Utils and Hooks
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

// Components
import SessionBulkUploadModal from "@/components/session-management/session-bulk-upload-modal";

// Utility function to parse UTC date strings without timezone shift
const parseSessionDate = (dateString: string): Date => {
  // If date is already in YYYY-MM-DD format, add time to avoid timezone issues
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(dateString + 'T12:00:00');
  }
  // If date includes time but is UTC, add noon time to avoid midnight timezone shifts
  if (dateString.includes('T00:00:00')) {
    return new Date(dateString.replace('T00:00:00', 'T12:00:00'));
  }
  return new Date(dateString);
};

// Additional type definitions for better type safety
interface Service {
  id: number;
  code: string;
  name: string;
  duration: number;
  baseRate: number;
}

interface ClientData {
  id: number;
  fullName: string;
  clientId: string;
}

interface TherapistData {
  id: number;
  fullName: string;
}

interface RoomData {
  id: number;
  roomNumber: string;
  roomName: string;
}

// Session form schema
const sessionFormSchema = z.object({
  clientId: z.number().min(1, "Client is required"),
  therapistId: z.number().min(1, "Therapist is required"),
  sessionDate: z.string().min(1, "Date is required"),
  sessionTime: z.string().min(1, "Time is required"),
  serviceId: z.number().min(1, "Service is required"),
  roomId: z.number().min(1, "Room is required"),
  sessionType: z.enum(["assessment", "psychotherapy", "consultation"]),
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
  serviceId: number;
  roomId: number;
  notes?: string;
  calculatedRate?: number;
  therapist: {
    id: number;
    fullName: string;
  };
  client?: {
    id: number;
    fullName: string;
    clientId: string;
    client_id: string;
    referenceNumber: string;
    reference_number: string;
  };
  service?: {
    id: number;
    serviceName: string;
    serviceCode: string;
    duration: number;
    baseRate: number;
  };
  room?: {
    id: number;
    roomNumber: string;
    roomName: string;
  };
}

export default function SchedulingPage() {
  const { user } = useAuth();
  // Routing
  const [, setLocation] = useLocation();
  
  // State
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<"day" | "week" | "month" | "list">("month");
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [isEditSessionModalOpen, setIsEditSessionModalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTherapist, setSelectedTherapist] = useState<string>("all");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showMySessionsOnly, setShowMySessionsOnly] = useState(false);
  const [isSchedulingFromExistingSession, setIsSchedulingFromExistingSession] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // URL Parameters for client pre-filling
  const urlParams = new URLSearchParams(window.location.search);
  const clientIdFromUrl = urlParams.get('clientId');
  const clientNameFromUrl = urlParams.get('clientName');
  const therapistIdFromUrl = urlParams.get('therapistId');
  const therapistNameFromUrl = urlParams.get('therapistName');
  
  // Fetch sessions for the selected date range
  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: [`/api/sessions/${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}/month`, { currentUserId: user?.id, currentUserRole: user?.role }],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // State for sessions list filters
  const [sessionsFilters, setSessionsFilters] = useState({
    page: 1,
    limit: 50,
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
    therapistId: 'all',
    status: 'all',
    serviceCode: 'all',
    clientId: ''
  });

  // Fetch all sessions for list view with pagination
  const { data: allSessionsData } = useQuery<{
    sessions: Session[];
    total: number;
    totalPages: number;
    currentPage: number;
    limit: number;
    appliedFilters: any;
  }>({
    queryKey: ["/api/sessions", { 
      currentUserId: user?.id, 
      currentUserRole: user?.role,
      ...sessionsFilters
    }],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: viewMode === "list"
  });

  const allSessions = allSessionsData?.sessions || [];

  // Fetch clients and therapists for dropdowns
  const { data: clients = { clients: [], total: 0 } } = useQuery<{ clients: ClientData[]; total: number }>({
    queryKey: ["/api/clients"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: therapists = [] } = useQuery<TherapistData[]>({
    queryKey: ["/api/therapists"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Fetch services for booking
  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["/api/services"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Fetch rooms for booking
  const { data: rooms = [] } = useQuery<RoomData[]>({
    queryKey: ["/api/rooms"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Initialize form before queries that depend on it
  const form = useForm<SessionFormData>({
    resolver: zodResolver(sessionFormSchema),
    defaultValues: {
      clientId: clientIdFromUrl ? parseInt(clientIdFromUrl) : undefined,
      therapistId: therapistIdFromUrl ? parseInt(therapistIdFromUrl) : undefined,
      sessionType: "psychotherapy",
      sessionDate: "",
      sessionTime: "",
      serviceId: undefined,
      roomId: undefined,
      notes: "",
    },
  });

  // Room availability based on selected date/time
  const [selectedDateTimeForRooms, setSelectedDateTimeForRooms] = useState<{date: string, time: string} | null>(null);
  const { data: availableRooms = [] } = useQuery({
    queryKey: ["/api/rooms/availability", selectedDateTimeForRooms],
    queryFn: () => {
      if (!selectedDateTimeForRooms) return [];
      const { date, time } = selectedDateTimeForRooms;
      const selectedService = (services as Service[]).find((s: Service) => s.id === form.watch('serviceId'));
      if (!selectedService) return [];
      
      const startTime = time;
      const endTime = new Date(new Date(`${date}T${startTime}`).getTime() + selectedService.duration * 60000)
        .toTimeString().slice(0, 5);
      
      return fetch(`/api/rooms/availability?date=${date}&startTime=${startTime}&endTime=${endTime}`)
        .then(res => res.json());
    },
    enabled: !!selectedDateTimeForRooms && !!form.watch('serviceId'),
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

  // Watch for date/time changes to update room availability
  const watchedDate = form.watch('sessionDate');
  const watchedTime = form.watch('sessionTime');
  
  React.useEffect(() => {
    if (watchedDate && watchedTime) {
      setSelectedDateTimeForRooms({ date: watchedDate, time: watchedTime });
    }
  }, [watchedDate, watchedTime]);

  const createSessionMutation = useMutation({
    mutationFn: (data: SessionFormData) => {
      const sessionDateTime = new Date(`${data.sessionDate}T${data.sessionTime}`);
      const sessionData = {
        ...data,
        sessionDate: sessionDateTime.toISOString(),
      };
      
      if (editingSessionId) {
        return apiRequest(`/api/sessions/${editingSessionId}`, "PUT", sessionData);
      } else {
        return apiRequest("/api/sessions", "POST", sessionData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}/month`] });
      toast({
        title: "Success",
        description: editingSessionId ? "Session updated successfully" : "Session scheduled successfully",
      });
      setIsNewSessionModalOpen(false);
      setEditingSessionId(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || (editingSessionId ? "Failed to update session" : "Failed to schedule session"),
        variant: "destructive",
      });
    },
  });

  // Session Status Update Mutation with Billing Integration
  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: number; status: string }) => {
      return apiRequest(`/api/sessions/${sessionId}/status`, "PUT", { status });
    },
    onSuccess: (data, variables) => {
      // Invalidate all session-related queries
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}/month`] });
      
      // Update the selected session state to reflect the change
      if (selectedSession) {
        setSelectedSession({ ...selectedSession, status: variables.status as any });
      }
      
      toast({
        title: "Success",
        description: "Session status updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update session status",
        variant: "destructive",
      });
    },
  });

  // Event Handlers
  const onSubmit = (data: SessionFormData) => {
    createSessionMutation.mutate(data);
  };

  const updateSessionStatus = (sessionId: number, status: string) => {
    updateSessionMutation.mutate({ sessionId, status });
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

  // Bulk update function to mark all scheduled sessions as completed
  const handleBulkUpdateToCompleted = async () => {
    try {
      const scheduledSessions = filteredSessions.filter(session => 
        session.status.toLowerCase() === 'scheduled'
      );

      if (scheduledSessions.length === 0) {
        toast({
          title: "No scheduled sessions found",
          description: "There are no sessions with 'scheduled' status to update.",
          variant: "default"
        });
        return;
      }

      toast({
        title: "Updating sessions...",
        description: `Processing ${scheduledSessions.length} sessions. Please wait...`,
        variant: "default"
      });

      // Process sessions in batches to avoid overwhelming the server
      const batchSize = 10;
      let updatedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < scheduledSessions.length; i += batchSize) {
        const batch = scheduledSessions.slice(i, i + batchSize);
        
        const batchResults = await Promise.allSettled(
          batch.map(session => 
            apiRequest(`/api/sessions/${session.id}`, "PUT", { status: "completed" })
          )
        );

        // Count successful and failed updates
        batchResults.forEach(result => {
          if (result.status === 'fulfilled') {
            updatedCount++;
          } else {
            failedCount++;
            // Failed to update session - error handled by toast
          }
        });

        // Small delay between batches to prevent overwhelming
        if (i + batchSize < scheduledSessions.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Refresh the sessions data
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}/month`] });

      if (failedCount === 0) {
        toast({
          title: "Sessions updated successfully",
          description: `${updatedCount} sessions marked as completed`,
          variant: "default"
        });
      } else {
        toast({
          title: "Partial update completed",
          description: `${updatedCount} sessions updated, ${failedCount} failed. Check console for details.`,
          variant: "default"
        });
      }

    } catch (error) {
      // Error updating sessions - handled by toast
      toast({
        title: "Error updating sessions",
        description: "Failed to update sessions. Please try again.",
        variant: "destructive"
      });
    }
  };

  // Session Filtering and Data Processing
  const filteredSessions = useMemo(() => {
    // Use the appropriate sessions data based on view mode
    const currentSessions = viewMode === "list" ? allSessions : sessions;
    let filtered = currentSessions;
    
    if (searchQuery) {
      filtered = filtered.filter((session: Session) =>
        (session.client?.fullName || session.clientName)?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (session.therapist?.fullName || session.therapistName)?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    if (selectedTherapist && selectedTherapist !== "all") {
      filtered = filtered.filter((session: Session) =>
        session.therapistId.toString() === selectedTherapist
      );
    }
    
    return filtered;
  }, [sessions, allSessions, searchQuery, selectedTherapist, viewMode]);

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
      const sessionDate = parseSessionDate(session.sessionDate);
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
              <SearchableSelect
                value={selectedTherapist}
                onValueChange={setSelectedTherapist}
                options={[
                  { value: "all", label: "All Therapists" },
                  ...(therapists?.map((therapist: any) => ({
                    value: therapist.id.toString(),
                    label: therapist.fullName
                  })) || [])
                ]}
                placeholder="All Therapists"
                searchPlaceholder="Search therapists..."
                className="w-48"
              />
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
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                >
                  All Sessions
                </Button>
              </div>
              <SessionBulkUploadModal
                trigger={
                  <Button variant="outline">
                    <Upload className="w-4 h-4 mr-2" />
                    Import
                  </Button>
                }
              />
              {viewMode === "list" && (
                <Button 
                  onClick={handleBulkUpdateToCompleted}
                  variant="outline"
                  className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Mark All Scheduled as Completed
                </Button>
              )}
              <Dialog open={isNewSessionModalOpen} onOpenChange={(open) => {
                setIsNewSessionModalOpen(open);
                if (!open) {
                  // Reset state when modal is closed
                  setIsSchedulingFromExistingSession(false);
                  setEditingSessionId(null);
                  form.reset();
                }
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
                    <DialogTitle>{editingSessionId ? "Edit Session" : "Schedule New Session"}</DialogTitle>
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
                              <FormControl>
                                <SearchableSelect
                                  value={field.value?.toString() || ""}
                                  onValueChange={(value) => field.onChange(parseInt(value))}
                                  options={clients.clients?.map((client: any) => ({
                                    value: client.id.toString(),
                                    label: client.fullName
                                  })) || []}
                                  placeholder="Select client"
                                  searchPlaceholder="Search clients..."
                                  disabled={!!clientIdFromUrl || isSchedulingFromExistingSession}
                                />
                              </FormControl>
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
                              <FormControl>
                                <SearchableSelect
                                  value={field.value?.toString() || ""}
                                  onValueChange={(value) => field.onChange(parseInt(value))}
                                  options={therapists?.map((therapist: any) => ({
                                    value: therapist.id.toString(),
                                    label: therapist.fullName
                                  })) || []}
                                  placeholder="Select therapist"
                                  searchPlaceholder="Search therapists..."
                                  disabled={!!therapistIdFromUrl || isSchedulingFromExistingSession}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="sessionDate"
                          render={({ field }) => {
                            const today = new Date().toISOString().split('T')[0];
                            const currentValue = field.value;
                            const isPastDate = currentValue && currentValue < today;
                            
                            return (
                              <FormItem>
                                <FormLabel>Date</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="date"
                                    className={isPastDate ? "border-orange-300 bg-orange-50" : ""}
                                  />
                                </FormControl>
                                {isPastDate && (
                                  <p className="text-orange-600 text-xs mt-1">
                                    📅 This session is scheduled in the past
                                  </p>
                                )}
                                <FormMessage />
                              </FormItem>
                            );
                          }}
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
                          name="serviceId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Service</FormLabel>
                              <FormControl>
                                <SearchableSelect
                                  value={field.value?.toString() || ""}
                                  onValueChange={(value) => field.onChange(parseInt(value))}
                                  options={services?.map((service) => ({
                                    value: service.id.toString(),
                                    label: `${service.serviceName} - $${service.baseRate} (${service.duration}min)`
                                  })) || []}
                                  placeholder="Select service"
                                  searchPlaceholder="Search services..."
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="roomId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Room</FormLabel>
                            <Select onValueChange={(value) => field.onChange(parseInt(value))}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select room" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {rooms?.map((room) => (
                                  <SelectItem key={room.id} value={room.id.toString()}>
                                    Room {room.roomNumber} - {room.roomName}
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
                          {createSessionMutation.isPending ? 
                            (editingSessionId ? "Updating..." : "Scheduling...") : 
                            (editingSessionId ? "Update Session" : "Schedule Session")
                          }
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {viewMode === "month" ? (
          /* Month View */
          (<div className="space-y-6">
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
                          min-h-[140px] p-2 border border-slate-100 cursor-pointer hover:bg-slate-50
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
                          {sessionsForDay.slice(0, 5).map((session: Session) => (
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
                              {new Date(session.sessionDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {session.client?.fullName || session.clientName}
                            </div>
                          ))}
                          {sessionsForDay.length > 5 && (
                            <div 
                              className="text-xs text-slate-500 text-center cursor-pointer hover:text-slate-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedDate(currentDate);
                                setViewMode("day");
                              }}
                            >
                              +{sessionsForDay.length - 5} more (click to view all)
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>)
        ) : viewMode === "list" ? (
          /* All Sessions List View */
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">All Sessions</h2>
              <div className="text-sm text-slate-600">
                {allSessionsData?.total || 0} total sessions (showing {allSessions.length})
              </div>
            </div>

            {/* Filters Section */}
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Start Date</label>
                    <Input
                      type="date"
                      value={sessionsFilters.startDate}
                      onChange={(e) => setSessionsFilters(prev => ({ ...prev, startDate: e.target.value, page: 1 }))}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">End Date</label>
                    <Input
                      type="date"
                      value={sessionsFilters.endDate}
                      onChange={(e) => setSessionsFilters(prev => ({ ...prev, endDate: e.target.value, page: 1 }))}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Therapist</label>
                    <Select 
                      value={sessionsFilters.therapistId} 
                      onValueChange={(value) => setSessionsFilters(prev => ({ ...prev, therapistId: value, page: 1 }))}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="All Therapists" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Therapists</SelectItem>
                        {therapists.map((therapist) => (
                          <SelectItem key={therapist.id} value={therapist.id.toString()}>
                            {therapist.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Status</label>
                    <Select 
                      value={sessionsFilters.status} 
                      onValueChange={(value) => setSessionsFilters(prev => ({ ...prev, status: value, page: 1 }))}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="All Statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                        <SelectItem value="no_show">No Show</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Service Code</label>
                    <Select 
                      value={sessionsFilters.serviceCode} 
                      onValueChange={(value) => setSessionsFilters(prev => ({ ...prev, serviceCode: value, page: 1 }))}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="All Services" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Services</SelectItem>
                        {services.map((service: any) => (
                          <SelectItem key={service.id} value={service.serviceCode}>
                            {service.serviceCode} - {service.serviceName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Per Page</label>
                    <Select 
                      value={sessionsFilters.limit.toString()} 
                      onValueChange={(value) => setSessionsFilters(prev => ({ ...prev, limit: parseInt(value), page: 1 }))}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setSessionsFilters({
                        page: 1,
                        limit: 50,
                        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
                        endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
                        therapistId: 'all',
                        status: 'all',
                        serviceCode: 'all',
                        clientId: ''
                      })}
                      className="text-sm"
                    >
                      Reset Filters
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-slate-600">Loading sessions...</p>
                    </div>
                  </div>
                ) : allSessions.length === 0 ? (
                  <div className="text-center py-12">
                    <CalendarDays className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">No sessions found</h3>
                    <p className="text-slate-600 mb-4">No sessions match your current filters.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {allSessions.map((session: Session) => (
                        <div
                          key={session.id}
                          className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors cursor-pointer"
                          onClick={() => {
                            setSelectedSession(session);
                            setIsEditSessionModalOpen(true);
                          }}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-4 flex-1">
                              <div className="text-center">
                                <p className="font-semibold text-lg">
                                  {new Date(session.sessionDate).toLocaleDateString()}
                                </p>
                                <p className="text-sm text-slate-600">
                                  {new Date(session.sessionDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                              
                              <Avatar className="w-12 h-12">
                                <AvatarFallback className="bg-blue-100 text-blue-600">
                                  {getInitials(session.client?.fullName || session.clientName || 'UC')}
                                </AvatarFallback>
                              </Avatar>
                              
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-1">
                                  <h3 className="font-medium text-blue-600">
                                    {session.client?.fullName || session.clientName || 'Unknown Client'}
                                  </h3>
                                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-mono">
                                    {session.client?.referenceNumber || session.client?.reference_number || session.clientId || 'No Ref#'}
                                  </span>
                                  <Badge className={getStatusColor(session.status)} variant="secondary">
                                    {session.status}
                                  </Badge>
                                </div>
                                <div className="space-y-1 text-sm text-slate-600">
                                  <div className="flex items-center space-x-2">
                                    <User className="w-4 h-4" />
                                    <span>Therapist: {session.therapist?.fullName || session.therapist?.full_name || session.therapistName || 'Unassigned'}</span>
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
                                      <span>Room: {(session.room as any)?.roomNumber || session.room}</span>
                                    </div>
                                  )}
                                  {session.service && (
                                    <div className="flex items-center space-x-2">
                                      <span className="text-xs bg-slate-100 px-2 py-1 rounded">
                                        {session.service.serviceCode} - ${session.service.baseRate}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex flex-col space-y-2">
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.location.href = `/clients/${session.clientId}`;
                                }}
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                View Client
                              </Button>
                            </div>
                          </div>
                          
                          {session.notes && (
                            <div className="mt-4 p-3 bg-slate-50 rounded-md">
                              <p className="text-sm text-slate-600">{session.notes}</p>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pagination Controls */}
            {allSessionsData && allSessionsData.totalPages > 1 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-600">
                      Showing {((allSessionsData.currentPage - 1) * allSessionsData.limit) + 1} to{' '}
                      {Math.min(allSessionsData.currentPage * allSessionsData.limit, allSessionsData.total)} of{' '}
                      {allSessionsData.total} sessions
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSessionsFilters(prev => ({ ...prev, page: prev.page - 1 }))}
                        disabled={allSessionsData.currentPage <= 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Previous
                      </Button>
                      <span className="px-3 py-1 text-sm bg-slate-100 rounded">
                        Page {allSessionsData.currentPage} of {allSessionsData.totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSessionsFilters(prev => ({ ...prev, page: prev.page + 1 }))}
                        disabled={allSessionsData.currentPage >= allSessionsData.totalPages}
                      >
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          /* Day/Week View */
          (<div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
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
                                {getInitials(session.client?.fullName || session.clientName || 'UC')}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-blue-600">
                                {session.client?.fullName || session.clientName || 'Unknown Client'}
                              </p>
                              <p className="text-xs text-slate-600">
                                with {session.therapist?.fullName || session.therapistName || 'Unassigned'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 text-xs text-slate-600">
                            <MapPin className="w-3 h-3" />
                            <span>{session.sessionType} • {(session.service as any)?.duration || 60}min</span>
                            {session.room && <span>• Room {session.room.roomNumber}</span>}
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
                                  <p className="text-xs text-slate-600">{(session.service as any)?.duration || 60}min</p>
                                </div>
                                
                                <Avatar className="w-12 h-12">
                                  <AvatarFallback className="bg-blue-100 text-blue-600">
                                    {getInitials(session.client?.fullName || session.clientName || 'UC')}
                                  </AvatarFallback>
                                </Avatar>
                                
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <h3 className="font-medium text-blue-600">
                                      {session.client?.fullName || session.clientName || 'Unknown Client'}
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
                                        <span>Room: {session.room ? `${session.room.roomNumber} - ${session.room.roomName}` : 'TBD'}</span>
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
          </div>)
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
                  {selectedSession.service && (
                    <div>
                      <label className="text-sm font-medium text-slate-700">Service</label>
                      <p className="text-sm text-slate-600">
                        {selectedSession.service.serviceName} ({selectedSession.service.serviceCode})
                      </p>
                      <p className="text-xs text-slate-500">
                        {selectedSession.service.duration} min - ${selectedSession.service.baseRate}
                      </p>
                    </div>
                  )}
                  {selectedSession.room && (
                    <div>
                      <label className="text-sm font-medium text-slate-700">Room</label>
                      <p className="text-sm text-slate-600">
                        {selectedSession.room.roomName} ({selectedSession.room.roomNumber})
                      </p>
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

                {/* Status Change Section */}
                <div className="pt-4 border-t">
                  <label className="text-sm font-medium text-slate-700 mb-3 block">Change Session Status</label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button 
                      variant={selectedSession.status === 'completed' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateSessionStatus(selectedSession.id, 'completed')}
                      className={`text-sm px-3 py-2 h-9 ${selectedSession.status === 'completed' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Completed
                    </Button>
                    <Button 
                      variant={selectedSession.status === 'scheduled' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateSessionStatus(selectedSession.id, 'scheduled')}
                      className={`text-sm px-3 py-2 h-9 ${selectedSession.status === 'scheduled' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                    >
                      <CalendarDays className="w-4 h-4 mr-2" />
                      Scheduled
                    </Button>
                    <Button 
                      variant={selectedSession.status === 'cancelled' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateSessionStatus(selectedSession.id, 'cancelled')}
                      className={`text-sm px-3 py-2 h-9 ${selectedSession.status === 'cancelled' ? 'bg-red-600 hover:bg-red-700' : ''}`}
                    >
                      <X className="w-4 h-4 mr-2" />
                      Cancelled
                    </Button>
                    <Button 
                      variant={selectedSession.status === 'no_show' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateSessionStatus(selectedSession.id, 'no_show')}
                      className={`text-sm px-3 py-2 h-9 ${selectedSession.status === 'no_show' ? 'bg-yellow-600 hover:bg-yellow-700' : ''}`}
                    >
                      <AlertCircle className="w-4 h-4 mr-2" />
                      No-Show
                    </Button>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <div className="grid grid-cols-2 gap-2">
                    <Button 
                      variant="outline"
                      onClick={() => window.location.href = `/clients/${selectedSession.clientId}`}
                      className="text-sm px-3 py-2 h-9"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Client Profile
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => {
                        // Pre-fill the form with current session data for editing
                        try {
                          form.setValue('clientId', selectedSession.clientId);
                          form.setValue('therapistId', selectedSession.therapistId);
                          form.setValue('serviceId', selectedSession.serviceId);
                          form.setValue('roomId', selectedSession.roomId);
                          form.setValue('sessionType', selectedSession.sessionType as any);
                          
                          // Better date/time parsing
                          const sessionDate = new Date(selectedSession.sessionDate);
                          form.setValue('sessionDate', sessionDate.toISOString().split('T')[0]);
                          
                          // Format time properly to HH:MM
                          const hours = sessionDate.getHours().toString().padStart(2, '0');
                          const minutes = sessionDate.getMinutes().toString().padStart(2, '0');
                          form.setValue('sessionTime', `${hours}:${minutes}`);
                          
                          form.setValue('notes', selectedSession.notes || '');
                          setEditingSessionId(selectedSession.id);
                          setIsSchedulingFromExistingSession(true);
                          setIsEditSessionModalOpen(false);
                          setIsNewSessionModalOpen(true);
                        } catch (error) {

                        }
                      }}
                      className="text-sm px-3 py-2 h-9"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit This Session
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => {
                        form.setValue('clientId', selectedSession.clientId);
                        form.setValue('therapistId', selectedSession.therapistId);
                        setIsSchedulingFromExistingSession(true);
                        setIsEditSessionModalOpen(false);
                        setIsNewSessionModalOpen(true);
                      }}
                      className="text-sm px-3 py-2 h-9"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Schedule Another Session
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setIsEditSessionModalOpen(false)}
                      className="text-sm px-3 py-2 h-9"
                    >
                      Close
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