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
  AlertCircle,
  RotateCw
} from "lucide-react";

// Utils and Hooks
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useRealTimeConflictCheck } from "@/hooks/useConflictDetection";
import { formatTime, formatDate, formatDateTime, generateTimeSlots, timeRangesOverlap, getUserTimeFormat, DURATION_PRESETS, durationToMinutes } from "@/lib/datetime";

// Components
import SessionBulkUploadModal from "@/components/session-management/session-bulk-upload-modal";

// Utility function to parse UTC date strings without timezone shift
const parseSessionDate = (dateString: string): Date => {
  // If date is already in YYYY-MM-DD format, add time to avoid timezone issues
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(dateString + 'T12:00:00');
  }
  // Handle ISO strings properly - keep the original time but ensure consistent parsing
  if (dateString.includes('T')) {
    return new Date(dateString);
  }
  // Fallback for other formats
  return new Date(dateString);
};

// Additional type definitions for better type safety
interface Service {
  id: number;
  serviceCode: string;
  serviceName: string;
  duration: number;
  baseRate: string;
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
  
  // Determine which month to fetch based on selected date and view mode
  const getMonthToFetch = () => {
    if (viewMode === "month") return currentMonth;
    // For day/week view, use the selected date's month
    return selectedDate;
  };

  const monthToFetch = getMonthToFetch();

  // Fetch sessions for the appropriate month
  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: [`/api/sessions/${monthToFetch.getFullYear()}/${monthToFetch.getMonth() + 1}/month`, { currentUserId: user?.id, currentUserRole: user?.role }],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60 * 1000, // Cache for 1 minute - sessions change but not every second
  });

  // Also fetch neighboring months for cross-month navigation
  const prevMonth = new Date(monthToFetch);
  prevMonth.setMonth(monthToFetch.getMonth() - 1);
  const nextMonth = new Date(monthToFetch);
  nextMonth.setMonth(monthToFetch.getMonth() + 1);

  const { data: prevMonthSessions = [] } = useQuery<Session[]>({
    queryKey: [`/api/sessions/${prevMonth.getFullYear()}/${prevMonth.getMonth() + 1}/month`, { currentUserId: user?.id, currentUserRole: user?.role }],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60 * 1000,
    enabled: viewMode !== "month" // Only fetch when not in month view
  });

  const { data: nextMonthSessions = [] } = useQuery<Session[]>({
    queryKey: [`/api/sessions/${nextMonth.getFullYear()}/${nextMonth.getMonth() + 1}/month`, { currentUserId: user?.id, currentUserRole: user?.role }],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60 * 1000,
    enabled: viewMode !== "month" // Only fetch when not in month view
  });

  // Combine all sessions for cross-month availability
  const allAvailableSessions = [...sessions, ...prevMonthSessions, ...nextMonthSessions];

  // State for sessions list filters
  const [sessionsFilters, setSessionsFilters] = useState({
    page: 1,
    limit: 50,
    startDate: (() => {
      const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    })(),
    endDate: (() => {
      const end = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
      return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    })(),
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
    enabled: viewMode === "list",
    staleTime: 30 * 1000, // Cache for 30 seconds - list view needs fresher data
  });

  const allSessions = allSessionsData?.sessions || [];

  // Fetch clients and therapists for dropdowns
  const { data: clients = { clients: [], total: 0 } } = useQuery<{ clients: ClientData[]; total: number }>({
    queryKey: ["/api/clients", { currentUserId: user?.id, currentUserRole: user?.role }],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes - clients don't change often
  });

  const { data: therapists = [] } = useQuery<TherapistData[]>({
    queryKey: ["/api/therapists"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes - therapist list rarely changes
  });

  // Fetch services for booking
  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["/api/services"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 15 * 60 * 1000, // Cache for 15 minutes - services rarely change
  });

  // Fetch rooms for booking
  const { data: rooms = [] } = useQuery<RoomData[]>({
    queryKey: ["/api/rooms"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 15 * 60 * 1000, // Cache for 15 minutes - rooms rarely change
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
  const watchedTherapistId = form.watch('therapistId');
  const watchedRoomId = form.watch('roomId');
  
  React.useEffect(() => {
    if (watchedDate && watchedTime) {
      setSelectedDateTimeForRooms({ date: watchedDate, time: watchedTime });
    }
  }, [watchedDate, watchedTime]);

  // Real-time conflict detection
  const { data: conflictData, isLoading: isCheckingConflicts } = useRealTimeConflictCheck(
    watchedTherapistId,
    watchedDate,
    watchedTime,
    editingSessionId || undefined,
    watchedRoomId
  );

  const createSessionMutation = useMutation({
    mutationFn: (data: SessionFormData) => {
      // Create a proper Date object to handle timezone correctly
      const localDateTime = new Date(`${data.sessionDate}T${data.sessionTime}:00`);
      
      const sessionData = {
        ...data,
        sessionDate: localDateTime.toISOString(),
        ignoreConflicts: true, // User confirmed to proceed despite conflicts
      };
      
      if (editingSessionId) {
        return apiRequest(`/api/sessions/${editingSessionId}`, "PUT", sessionData);
      } else {
        return apiRequest("/api/sessions", "POST", sessionData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      // Invalidate all month queries that might be affected
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${monthToFetch.getFullYear()}/${monthToFetch.getMonth() + 1}/month`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${prevMonth.getFullYear()}/${prevMonth.getMonth() + 1}/month`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${nextMonth.getFullYear()}/${nextMonth.getMonth() + 1}/month`] });
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
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${monthToFetch.getFullYear()}/${monthToFetch.getMonth() + 1}/month`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${prevMonth.getFullYear()}/${prevMonth.getMonth() + 1}/month`] });
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${nextMonth.getFullYear()}/${nextMonth.getMonth() + 1}/month`] });
      
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
      'rescheduled': 'bg-purple-100 text-purple-800',
      'no_show': 'bg-yellow-100 text-yellow-800'
    };
    return statusColors[status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800';
  };

  // Privacy protection - show client name only to assigned therapist and admins/supervisors
  const getDisplayClientName = (session: Session): string => {
    // Admins and supervisors can see all client names
    if (user?.role === 'admin' || user?.role === 'supervisor') {
      return session.client?.fullName || 'Unknown Client';
    }
    
    // Therapists can only see their own clients' names
    if (user?.role === 'therapist' && user?.id === session.therapistId) {
      return session.client?.fullName || 'Unknown Client';
    }
    
    // Other users see "Private Session"
    return 'Private Session';
  };

  const getSessionTypeColor = (type: string): string => {
    const typeColors = {
      'assessment': 'bg-purple-100 text-purple-800',
      'psychotherapy': 'bg-green-100 text-green-800',
      'consultation': 'bg-blue-100 text-blue-800'
    };
    return typeColors[type as keyof typeof typeColors] || 'bg-gray-100 text-gray-800';
  };

  // Enhanced time slots with flexible intervals
  const getTimeSlots = (intervalMinutes = 30): string[] => {
    return generateTimeSlots(8, 18, intervalMinutes);
  };
  
  // Get time slots with labels for display
  const getTimeSlotsWithLabels = (intervalMinutes = 30): Array<{value: string, label: string}> => {
    const slots = getTimeSlots(intervalMinutes);
    return slots.map(time => ({
      value: time,
      label: formatTime(time)
    }));
  };

  const getInitials = (name: string): string => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  // Check if a session has time conflicts with other sessions for the same therapist
  const hasTherapistTimeConflict = (session: Session, allSessions: Session[]): boolean => {
    return allSessions.some(otherSession => {
      if (otherSession.id === session.id) return false; // Skip same session
      if (otherSession.therapistId !== session.therapistId) return false; // Different therapist
      
      const sessionTime = new Date(session.sessionDate);
      const otherTime = new Date(otherSession.sessionDate);
      
      // Same day check
      if (sessionTime.toDateString() !== otherTime.toDateString()) return false;
      
      // Check for time overlap (assuming 60-minute sessions)
      const sessionStart = sessionTime.getTime();
      const sessionEnd = sessionStart + (60 * 60 * 1000); // 60 minutes
      const otherStart = otherTime.getTime();
      const otherEnd = otherStart + (60 * 60 * 1000);
      
      return (sessionStart < otherEnd && sessionEnd > otherStart);
    });
  };

  // Check if a session has room conflicts with other sessions
  const hasRoomTimeConflict = (session: Session, allSessions: Session[]): boolean => {
    if (!session.roomId) return false;
    
    return allSessions.some(otherSession => {
      if (otherSession.id === session.id) return false; // Skip same session
      if (otherSession.roomId !== session.roomId) return false; // Different room
      
      const sessionTime = new Date(session.sessionDate);
      const otherTime = new Date(otherSession.sessionDate);
      
      // Same day check
      if (sessionTime.toDateString() !== otherTime.toDateString()) return false;
      
      // Check for time overlap (assuming 60-minute sessions)
      const sessionStart = sessionTime.getTime();
      const sessionEnd = sessionStart + (60 * 60 * 1000); // 60 minutes
      const otherStart = otherTime.getTime();
      const otherEnd = otherStart + (60 * 60 * 1000);
      
      return (sessionStart < otherEnd && sessionEnd > otherStart);
    });
  };

  // Get visual indicator for session based on conflicts
  const getSessionConflictStyle = (session: Session): { style: string; conflictType: 'therapist' | 'room' | 'both' | 'none' } => {
    if (!sessions || sessions.length === 0) return { style: '', conflictType: 'none' };
    
    const hasTherapistConflict = hasTherapistTimeConflict(session, sessions);
    const hasRoomConflict = hasRoomTimeConflict(session, sessions);
    
    if (hasTherapistConflict && hasRoomConflict) {
      return { style: 'border-l-4 border-red-600 bg-red-100', conflictType: 'both' };
    } else if (hasTherapistConflict) {
      return { style: 'border-l-4 border-red-500 bg-red-50', conflictType: 'therapist' };
    } else if (hasRoomConflict) {
      return { style: 'border-l-4 border-orange-500 bg-orange-50', conflictType: 'room' };
    }
    
    return { style: '', conflictType: 'none' };
  };


  // Session Filtering and Data Processing
  const filteredSessions = useMemo(() => {
    // Use the appropriate sessions data based on view mode
    const currentSessions = viewMode === "list" ? allSessions : allAvailableSessions;
    let filtered = currentSessions;
    
    if (searchQuery) {
      filtered = filtered.filter((session: Session) =>
        session.client?.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.therapist?.fullName?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    if (selectedTherapist && selectedTherapist !== "all") {
      filtered = filtered.filter((session: Session) =>
        session.therapistId.toString() === selectedTherapist
      );
    }
    
    return filtered;
  }, [allAvailableSessions, allSessions, searchQuery, selectedTherapist, viewMode]);

  const getTodaysSessions = (): Session[] => {
    // Format selected date as YYYY-MM-DD in local timezone
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    
    return filteredSessions.filter((session: Session) => {
      const sessionLocalDate = parseSessionDate(session.sessionDate);
      const sessionYear = sessionLocalDate.getFullYear();
      const sessionMonth = String(sessionLocalDate.getMonth() + 1).padStart(2, '0');
      const sessionDay = String(sessionLocalDate.getDate()).padStart(2, '0');
      const sessionDateStr = `${sessionYear}-${sessionMonth}-${sessionDay}`;
      
      return sessionDateStr === todayStr;
    });
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
    // Format date as YYYY-MM-DD in local timezone to avoid UTC conversion issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const localDateStr = `${year}-${month}-${day}`;
    
    return filteredSessions.filter((session: Session) => {
      const sessionLocalDate = parseSessionDate(session.sessionDate);
      const sessionYear = sessionLocalDate.getFullYear();
      const sessionMonth = String(sessionLocalDate.getMonth() + 1).padStart(2, '0');
      const sessionDay = String(sessionLocalDate.getDate()).padStart(2, '0');
      const sessionLocalDateStr = `${sessionYear}-${sessionMonth}-${sessionDay}`;
      
      return sessionLocalDateStr === localDateStr;
    });
  };

  // Get week dates centered around selected date
  const getWeekDates = (): Date[] => {
    const startOfWeek = new Date(selectedDate);
    startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay()); // Start on Sunday
    
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      weekDates.push(date);
    }
    return weekDates;
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
              {user?.role !== 'therapist' && (
                <SearchableSelect
                  value={selectedTherapist}
                  onValueChange={setSelectedTherapist}
                  options={[
                    { value: "all", label: "All Therapists" },
                    ...(therapists?.map((therapist: any) => ({
                      value: therapist.id.toString(),
                      label: therapist.fullName || therapist.full_name
                    })) || [])
                  ]}
                  placeholder="All Therapists"
                  searchPlaceholder="Search therapists..."
                  className="w-48"
                />
              )}
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
              {user?.role !== 'therapist' && (
                <SessionBulkUploadModal
                  trigger={
                    <Button variant="outline">
                      <Upload className="w-4 h-4 mr-2" />
                      Import
                    </Button>
                  }
                />
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
                                    label: client.fullName || client.full_name
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
                                    label: therapist.fullName || therapist.full_name
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
                            const todayDate = new Date();
                            const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
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
                                  {getTimeSlotsWithLabels().map((timeSlot) => (
                                    <SelectItem key={timeSlot.value} value={timeSlot.value}>
                                      {timeSlot.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Enhanced Conflict Detection Warning */}
                      {conflictData?.hasConflict && !isCheckingConflicts && (
                        <div className="p-4 border border-red-200 bg-red-50 rounded-lg">
                          <div className="flex items-start space-x-3">
                            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
                            <div className="flex-1">
                              <h4 className="text-sm font-medium text-red-800">
                                Scheduling Conflicts Detected
                              </h4>
                              
                              {/* Therapist Conflicts */}
                              {conflictData.therapistConflicts?.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-xs text-red-700 font-medium">Therapist Schedule Conflict:</p>
                                  <ul className="mt-1 space-y-1">
                                    {conflictData.therapistConflicts.map((conflict, index) => (
                                      <li key={index} className="text-xs text-red-700">
                                        • You have: {conflict.clientName} - {conflict.sessionType} at {formatTime(conflict.sessionDate)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Room Conflicts */}
                              {conflictData.roomConflicts?.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-xs text-red-700 font-medium">Room Booking Conflict:</p>
                                  <ul className="mt-1 space-y-1">
                                    {conflictData.roomConflicts.map((conflict, index) => (
                                      <li key={index} className="text-xs text-red-700">
                                        • Room occupied by {conflict.therapistName} - {conflict.sessionType} at {formatTime(conflict.sessionDate)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Alternative Times */}
                              {conflictData.suggestedTimes?.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-xs text-red-700 font-medium">
                                    Suggested alternative times (therapist + room available):
                                  </p>
                                  <div className="flex gap-2 mt-1">
                                    {conflictData.suggestedTimes.map((time, index) => (
                                      <Button
                                        key={index}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="text-xs px-2 py-1 h-6 border-red-300 text-red-700 hover:bg-red-100"
                                        onClick={() => {
                                          const suggestedTime = new Date(time);
                                          const hours = suggestedTime.getHours().toString().padStart(2, '0');
                                          const minutes = suggestedTime.getMinutes().toString().padStart(2, '0');
                                          form.setValue('sessionTime', `${hours}:${minutes}`);
                                        }}
                                      >
                                        {formatTime(time)}
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

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
                    <div key={day} className="p-2 text-center text-sm font-medium text-slate-600 border border-transparent">
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
                    
                    // Show disabled state for dates outside current month to maintain grid structure
                    
                    return (
                      <div
                        key={i}
                        className={`
                          min-h-[140px] p-2 border border-slate-100 
                          ${!isCurrentMonth 
                            ? 'bg-slate-50 text-slate-400 cursor-default opacity-50' 
                            : 'cursor-pointer hover:bg-slate-50'
                          }
                          ${isToday ? 'bg-blue-50 border-blue-200' : ''}
                          ${isSelected ? 'ring-2 ring-blue-500' : ''}
                        `}
                        onClick={() => isCurrentMonth && setSelectedDate(currentDate)}
                      >
                        <div className={`text-sm font-medium mb-1 ${isToday ? 'text-blue-600' : ''}`}>
                          {currentDate.getDate()}
                        </div>
                        <div className="space-y-1">
                          {sessionsForDay.slice(0, 5).map((session: Session) => {
                            const conflictInfo = getSessionConflictStyle(session);
                            const hasConflict = conflictInfo.conflictType !== 'none';
                            
                            const getConflictIndicator = () => {
                              switch (conflictInfo.conflictType) {
                                case 'therapist':
                                  return <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" title="Therapist scheduling conflict"></span>;
                                case 'room':
                                  return <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full" title="Room booking conflict"></span>;
                                case 'both':
                                  return <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-600 rounded-full" title="Multiple conflicts detected"></span>;
                                default:
                                  return null;
                              }
                            };
                            
                            return (
                              <div
                                key={session.id}
                                className={`
                                  text-xs p-1 rounded cursor-pointer truncate relative
                                  ${getSessionTypeColor(session.sessionType)} hover:shadow-sm
                                  ${conflictInfo.style}
                                `}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSession(session);
                                  setIsEditSessionModalOpen(true);
                                }}
                              >
                                {getConflictIndicator()}
                                {(() => {
                                  // Parse the session date and extract time without timezone conversion
                                  const sessionDate = parseSessionDate(session.sessionDate);
                                  const hours = sessionDate.getHours().toString().padStart(2, '0');
                                  const minutes = sessionDate.getMinutes().toString().padStart(2, '0');
                                  return `${hours}:${minutes}`;
                                })()} {getDisplayClientName(session)}
                              </div>
                            );
                          })}
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
                        <SelectItem value="rescheduled">Rescheduled</SelectItem>
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
                                  {formatTime(session.sessionDate)}
                                </p>
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
                                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-mono">
                                    {session.client?.referenceNumber || 'No Ref#'}
                                  </span>
                                  <Badge className={getStatusColor(session.status)} variant="secondary">
                                    {session.status}
                                  </Badge>
                                </div>
                                <div className="space-y-1 text-sm text-slate-600">
                                  <div className="flex items-center space-x-2">
                                    <User className="w-4 h-4" />
                                    <span>Therapist: {session.therapist?.fullName || 'Unassigned'}</span>
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
          (<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                    showOutsideDays={true}
                    className="rounded-md border"
                    classNames={{
                      day_outside: "text-slate-300 opacity-50 hover:text-slate-400"
                    }}
                  />
                </CardContent>
              </Card>

              {/* Today's Summary */}
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Clock className="w-5 h-5" />
                    <span>{selectedDate.toDateString() === new Date().toDateString() ? "Today's Sessions" : "Sessions for " + selectedDate.toLocaleDateString()}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {getSessionsForDate(selectedDate).length === 0 ? (
                    <p className="text-slate-600 text-sm">No sessions scheduled for today</p>
                  ) : (
                    <div className="space-y-3">
                      {getSessionsForDate(selectedDate).slice(0, 5).map((session: Session) => (
                        <div key={session.id} className="border border-slate-100 rounded-lg p-3 hover:bg-slate-50">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-sm">
                              {(() => {
                                const sessionDate = parseSessionDate(session.sessionDate);
                                const hours = sessionDate.getHours().toString().padStart(2, '0');
                                const minutes = sessionDate.getMinutes().toString().padStart(2, '0');
                                return `${hours}:${minutes}`;
                              })()}
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
                                with {session.therapist?.fullName || 'Unassigned'}
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
                    <span className="font-medium">{getSessionsForDate(selectedDate).length} sessions</span>
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
            <div className="lg:col-span-2">
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
                ) : getSessionsForDate(selectedDate).length === 0 ? (
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
                      {getSessionsForDate(selectedDate)
                        .sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime())
                        .map((session: Session) => {
                          const conflictInfo = getSessionConflictStyle(session);
                          const hasConflict = conflictInfo.conflictType !== 'none';
                          
                          return (
                            <div
                              key={session.id}
                              className={`
                                border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors relative
                                ${conflictInfo.style}
                              `}
                            >
                            {hasConflict && (
                              <div className={`absolute top-2 right-2 flex items-center px-2 py-1 rounded text-xs ${
                                conflictInfo.conflictType === 'therapist' ? 'bg-red-100 text-red-700' :
                                conflictInfo.conflictType === 'room' ? 'bg-orange-100 text-orange-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                <AlertCircle className="w-3 h-3" />
                              </div>
                            )}
                            <div className="flex items-start justify-between">
                              <div className="flex items-center space-x-4 flex-1">
                                <div className="text-center">
                                  <p className="font-semibold text-lg">
                                    {(() => {
                                      const sessionDate = parseSessionDate(session.sessionDate);
                                      const hours = sessionDate.getHours().toString().padStart(2, '0');
                                      const minutes = sessionDate.getMinutes().toString().padStart(2, '0');
                                      return `${hours}:${minutes}`;
                                    })()}
                                  </p>
                                  <p className="text-xs text-slate-600">{(session.service as any)?.duration || 60}min</p>
                                </div>
                                
                                <Avatar className="w-12 h-12">
                                  <AvatarFallback className="bg-blue-100 text-blue-600">
                                    {getInitials(session.client?.fullName || 'UC')}
                                  </AvatarFallback>
                                </Avatar>
                                
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <h3 className="font-medium text-blue-600">
                                      {getDisplayClientName(session)}
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
                          );
                        })}
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
                        {(() => {
                          const sessionDate = parseSessionDate(selectedSession.sessionDate);
                          const hours = sessionDate.getHours().toString().padStart(2, '0');
                          const minutes = sessionDate.getMinutes().toString().padStart(2, '0');
                          return `${hours}:${minutes}`;
                        })()}
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
                  <Select 
                    value={selectedSession.status} 
                    onValueChange={(value) => updateSessionStatus(selectedSession.id, value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">
                        <div className="flex items-center">
                          <CalendarDays className="w-4 h-4 mr-2 text-blue-600" />
                          Scheduled
                        </div>
                      </SelectItem>
                      <SelectItem value="completed">
                        <div className="flex items-center">
                          <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                          Completed
                        </div>
                      </SelectItem>
                      <SelectItem value="cancelled">
                        <div className="flex items-center">
                          <X className="w-4 h-4 mr-2 text-red-600" />
                          Cancelled
                        </div>
                      </SelectItem>
                      <SelectItem value="rescheduled">
                        <div className="flex items-center">
                          <RotateCw className="w-4 h-4 mr-2 text-purple-600" />
                          Rescheduled
                        </div>
                      </SelectItem>
                      <SelectItem value="no_show">
                        <div className="flex items-center">
                          <AlertCircle className="w-4 h-4 mr-2 text-yellow-600" />
                          No-Show
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
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
                          
                          // Better date/time parsing - preserve timezone
                          const sessionDate = new Date(selectedSession.sessionDate);
                          const dateOnly = selectedSession.sessionDate.split('T')[0];
                          form.setValue('sessionDate', dateOnly);
                          
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