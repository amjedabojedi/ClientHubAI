import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  RotateCw,
  Video,
  ExternalLink,
  MoreVertical,
  CalendarIcon
} from "lucide-react";

// Utils and Hooks
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useRecentItems } from "@/hooks/useRecentItems";
import { useRealTimeConflictCheck } from "@/hooks/useConflictDetection";
import { formatTime, formatDate, formatDateTime, formatDateInput, getTodayInPracticeTimezone, generateTimeSlots, timeRangesOverlap, getUserTimeFormat, DURATION_PRESETS, durationToMinutes, localToUTC } from "@/lib/datetime";

// Components
import SessionBulkUploadModal from "@/components/session-management/session-bulk-upload-modal";
import { SessionCard } from "@/components/scheduling/session-card";
import { QuickStats } from "@/components/scheduling/quick-stats";

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
  clientId: z.coerce.number().int().min(1, "Client is required"),
  therapistId: z.coerce.number().int().min(1, "Therapist is required"),
  sessionDate: z.string().min(1, "Date is required"),
  sessionTime: z.string().min(1, "Time is required"),
  serviceId: z.coerce.number().int().min(1, "Service is required"),
  roomId: z.coerce.number().int().min(1, "Room is required"),
  sessionType: z.enum(["assessment", "psychotherapy", "consultation"]),
  notes: z.string().optional(),
  zoomEnabled: z.boolean().optional().default(false),
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
  // Zoom integration fields
  zoomEnabled?: boolean;
  zoomMeetingId?: string;
  zoomJoinUrl?: string;
  zoomPassword?: string;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTherapist, setSelectedTherapist] = useState<string>("all");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showMySessionsOnly, setShowMySessionsOnly] = useState(false);
  const [isSchedulingFromExistingSession, setIsSchedulingFromExistingSession] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [provisionalDuration, setProvisionalDuration] = useState<number>(60); // Quick duration for preview
  const [userConfirmedConflicts, setUserConfirmedConflicts] = useState<boolean>(false); // Track conflict confirmation
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { addRecentSession } = useRecentItems();

  // URL Parameters for client pre-filling
  const urlParams = new URLSearchParams(window.location.search);
  const clientIdFromUrl = urlParams.get('clientId');
  const clientNameFromUrl = urlParams.get('clientName');
  const therapistIdFromUrl = urlParams.get('therapistId');
  const therapistNameFromUrl = urlParams.get('therapistName');
  const editSessionIdFromUrl = urlParams.get('editSessionId');
  
  // Determine which month to fetch based on selected date and view mode
  const getMonthToFetch = () => {
    if (viewMode === "month") return currentMonth;
    // For day/week view, use the selected date's month
    return selectedDate;
  };

  const monthToFetch = getMonthToFetch();

  // Fetch sessions for the appropriate month
  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: [`/api/sessions/${monthToFetch.getFullYear()}/${monthToFetch.getMonth() + 1}/month`],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60 * 1000, // Cache for 1 minute - sessions change but not every second
  });

  // Also fetch neighboring months for cross-month navigation
  const prevMonth = new Date(monthToFetch);
  prevMonth.setMonth(monthToFetch.getMonth() - 1);
  const nextMonth = new Date(monthToFetch);
  nextMonth.setMonth(monthToFetch.getMonth() + 1);

  const { data: prevMonthSessions = [] } = useQuery<Session[]>({
    queryKey: [`/api/sessions/${prevMonth.getFullYear()}/${prevMonth.getMonth() + 1}/month`],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60 * 1000,
    enabled: viewMode !== "month" // Only fetch when not in month view
  });

  const { data: nextMonthSessions = [] } = useQuery<Session[]>({
    queryKey: [`/api/sessions/${nextMonth.getFullYear()}/${nextMonth.getMonth() + 1}/month`],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60 * 1000,
    enabled: viewMode !== "month" // Only fetch when not in month view
  });

  // Combine all sessions for cross-month availability
  const allAvailableSessions = [...sessions, ...prevMonthSessions, ...nextMonthSessions];
  
  // DEBUG: Log actual session data structure
  // Session data processing - removed debug logging for security
  
  // Normalize session data - convert all IDs from strings to numbers for proper filtering
  const normalizedSessions = useMemo(() => 
    allAvailableSessions.map(s => ({
      ...s,
      roomId: Number((s as any).roomId ?? 0),
      therapistId: Number((s as any).therapistId ?? 0), 
      serviceId: Number((s as any).serviceId ?? 0),
      clientId: Number((s as any).clientId ?? 0)
    })), 
    [allAvailableSessions]
  );

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
    queryKey: ["/api/sessions", 
      sessionsFilters.page,
      sessionsFilters.limit,
      sessionsFilters.startDate,
      sessionsFilters.endDate,
      sessionsFilters.therapistId,
      sessionsFilters.status,
      sessionsFilters.serviceCode,
      sessionsFilters.clientId
    ],
    queryFn: async () => {
      let url = '/api/sessions';
      const params = new URLSearchParams();
      
      // Add all filters to query parameters
      params.append('page', sessionsFilters.page.toString());
      params.append('limit', sessionsFilters.limit.toString());
      if (sessionsFilters.startDate) params.append('startDate', sessionsFilters.startDate);
      if (sessionsFilters.endDate) params.append('endDate', sessionsFilters.endDate);
      if (sessionsFilters.therapistId && sessionsFilters.therapistId !== 'all') {
        params.append('therapistId', sessionsFilters.therapistId);
      }
      if (sessionsFilters.status && sessionsFilters.status !== 'all') {
        params.append('status', sessionsFilters.status);
      }
      if (sessionsFilters.serviceCode && sessionsFilters.serviceCode !== 'all') {
        params.append('serviceCode', sessionsFilters.serviceCode);
      }
      if (sessionsFilters.clientId) {
        params.append('clientId', sessionsFilters.clientId);
      }
      
      url += '?' + params.toString();
      
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });
      
      if (!response.ok) throw new Error('Failed to fetch sessions');
      return response.json();
    },
    enabled: viewMode === "list",
    staleTime: 30 * 1000, // Cache for 30 seconds - list view needs fresher data
  });

  const allSessions = allSessionsData?.sessions || [];

  // Fetch clients and therapists for dropdowns
  const { data: clients = { clients: [], total: 0 } } = useQuery<{ clients: ClientData[]; total: number }>({
    queryKey: ["/api/clients"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes - clients don't change often
  });

  const { data: therapists = [] } = useQuery<TherapistData[]>({
    queryKey: ["/api/therapists"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes - therapist list rarely changes
  });

  // Fetch services for booking (role-based filtering)
  const { data: services = [] } = useQuery<Service[]>({
    queryKey: [user?.role === 'administrator' || user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'clinical_supervisor' ? "/api/services" : "/api/services/filtered"],
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
      zoomEnabled: false,
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

  // Auto-load session for editing when editSessionId is in URL
  React.useEffect(() => {
    if (editSessionIdFromUrl && sessions.length > 0) {
      const sessionToEdit = sessions.find(s => s.id === parseInt(editSessionIdFromUrl));
      if (sessionToEdit) {
        try {
          form.setValue('clientId', sessionToEdit.clientId);
          form.setValue('therapistId', sessionToEdit.therapistId);
          form.setValue('serviceId', sessionToEdit.serviceId);
          form.setValue('roomId', sessionToEdit.roomId);
          form.setValue('sessionType', sessionToEdit.sessionType as any);
          
          // Parse date/time from UTC and convert to EST for editing
          const sessionDateObj = new Date(sessionToEdit.sessionDate);
          const dateOnly = formatInTimeZone(sessionDateObj, 'America/New_York', 'yyyy-MM-dd');
          const timeOnly = formatInTimeZone(sessionDateObj, 'America/New_York', 'HH:mm');
          form.setValue('sessionDate', dateOnly);
          form.setValue('sessionTime', timeOnly);
          
          form.setValue('notes', sessionToEdit.notes || '');
          form.setValue('zoomEnabled', (sessionToEdit as any).zoomEnabled || false);
          
          setEditingSessionId(sessionToEdit.id);
          setIsSchedulingFromExistingSession(true);
          setIsNewSessionModalOpen(true);
          
          // Clear the URL parameter after loading
          window.history.replaceState({}, '', '/scheduling');
        } catch (error) {
          console.error('Error loading session for editing:', error);
          toast({
            title: "Error",
            description: "Failed to load session data",
            variant: "destructive"
          });
        }
      }
    }
  }, [editSessionIdFromUrl, sessions, form, toast]);

  // Watch for date/time changes to update room availability
  const watchedDate = form.watch('sessionDate');
  const watchedTime = form.watch('sessionTime');
  const watchedTherapistId = form.watch('therapistId');
  const watchedRoomId = form.watch('roomId');
  const watchedServiceId = form.watch('serviceId');
  
  // Get service duration for conflict detection
  const selectedService = services.find(s => s.id === watchedServiceId);
  const serviceDuration = selectedService?.duration;
  
  React.useEffect(() => {
    if (watchedDate && watchedTime) {
      setSelectedDateTimeForRooms({ date: watchedDate, time: watchedTime });
    }
  }, [watchedDate, watchedTime]);

  // Real-time conflict detection - only enabled when service + day + room selected
  const { data: conflictData, isLoading: isCheckingConflicts } = useRealTimeConflictCheck(
    watchedTherapistId,
    watchedDate,
    watchedTime,
    editingSessionId || undefined,
    watchedRoomId,
    serviceDuration
  );

  const createSessionMutation = useMutation({
    mutationFn: (data: SessionFormData) => {
      // Convert local date/time to UTC using practice timezone (EST)
      // This ensures all users see consistent times regardless of their browser timezone
      const utcDateTime = localToUTC(data.sessionDate, data.sessionTime);
      
      const sessionData = {
        ...data,
        sessionDate: utcDateTime.toISOString(),
        ignoreConflicts: userConfirmedConflicts, // Only ignore conflicts if user explicitly confirmed
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
    // Check for conflicts before submitting
    if (conflictData?.hasConflict && !userConfirmedConflicts) {
      // Show conflict warning and require confirmation
      toast({
        title: "Scheduling Conflicts Detected",
        description: "Please review the conflicts shown above and click 'Proceed Anyway' if you want to continue.",
        variant: "destructive",
      });
      return; // Don't submit the form
    }
    
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

  // Helper function to load session data into form and open edit modal
  const openEditSessionForm = (session: Session) => {
    // Use America/New_York timezone for consistent date/time handling
    // Pass the string directly to formatInTimeZone to avoid browser timezone conversion
    const dateOnly = formatInTimeZone(session.sessionDate, 'America/New_York', 'yyyy-MM-dd');
    const timeString = formatInTimeZone(session.sessionDate, 'America/New_York', 'HH:mm');
    
    form.reset({
      clientId: session.clientId,
      therapistId: session.therapistId,
      serviceId: session.serviceId,
      roomId: session.roomId,
      sessionType: session.sessionType as any,
      sessionDate: dateOnly,
      sessionTime: timeString,
      notes: session.notes || '',
      zoomEnabled: (session as any).zoomEnabled || false,
    });
    
    setEditingSessionId(session.id);
    setIsSchedulingFromExistingSession(true);
    setIsNewSessionModalOpen(true);
  };

  // Enhanced time slots with flexible intervals
  const getTimeSlots = (intervalMinutes = 30): string[] => {
    return generateTimeSlots(8, 24, intervalMinutes);
  };
  
  // Get time slots with labels for display
  const getTimeSlotsWithLabels = (intervalMinutes = 30): Array<{value: string, label: string}> => {
    const slots = getTimeSlots(intervalMinutes);
    return slots.map(time => ({
      value: time,
      label: formatTime(time)
    }));
  };

  // Generate available time slots for specific room - Room-First with provisional duration
  const generateAvailableTimeSlotsForSpecificRoom = (
    selectedDate: string, 
    serviceDuration: number,
    therapistId: number, 
    roomId: number,
    fallbackDuration?: number
  ): Array<{time: string, isAvailable: boolean}> => {
    
    // PRIORITY: Use provisional duration tags first, then service duration as fallback
    const effectiveDuration = provisionalDuration || serviceDuration || fallbackDuration || 60;
    
    
    // Enforce all required inputs - Room-First workflow
    if (!selectedDate || !therapistId || !roomId || !effectiveDuration || effectiveDuration <= 0) return [];
    
    // Debug type checking
    if (typeof roomId !== 'number' || typeof therapistId !== 'number') {
      return [];
    }
    
    // Ensure rooms data is loaded before showing suggestions
    if (!rooms || rooms.length === 0) return [];
    
    const results: Array<{ time: string, isAvailable: boolean }> = [];
    const timeSlots = getTimeSlots(effectiveDuration); // Duration-based intervals - FIXED!
    
    // Get comprehensive session data - using NORMALIZED sessions for proper ID comparison
    const allSessionsData = normalizedSessions && normalizedSessions.length > 0 ? normalizedSessions : [];
    
    // For accurate conflict detection, also include sessions from adjacent date range
    // This helps catch conflicts near month boundaries
    const targetDate = new Date(selectedDate + 'T12:00:00');
    const dayBefore = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);
    const dayAfter = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
    
    const daySessionsForTherapist = allSessionsData.filter(s => {
      const sessionDate = new Date(s.sessionDate);
      // Include sessions from day before, target day, and day after to catch overlapping sessions
      return (
        (sessionDate.toDateString() === targetDate.toDateString() ||
         sessionDate.toDateString() === dayBefore.toDateString() ||
         sessionDate.toDateString() === dayAfter.toDateString()) &&
        s.therapistId === therapistId
      );
    });
    
    const daySessionsForRoom = allSessionsData.filter(s => {
      const dt = new Date(s.sessionDate);
      return (
        (dt.toDateString() === targetDate.toDateString() ||
         dt.toDateString() === dayBefore.toDateString() ||
         dt.toDateString() === dayAfter.toDateString()) &&
        s.roomId === roomId  // Both are numbers now - fixed!
      );
    });
    
    
    const allDaySessions = allSessionsData.filter(s => {
      const sessionDate = new Date(s.sessionDate);
      return (
        sessionDate.toDateString() === targetDate.toDateString() ||
        sessionDate.toDateString() === dayBefore.toDateString() ||
        sessionDate.toDateString() === dayAfter.toDateString()
      );
    });
    
    // Simple Room + Therapist conflict logic: check each time slot
    for (const timeSlot of timeSlots) {
      const slotStart = new Date(`${selectedDate}T${timeSlot}:00`);
      const slotEnd = new Date(slotStart.getTime() + effectiveDuration * 60000);
      
      // Skip slots that would end after business hours (12 AM / 24:00)
      const businessEnd = new Date(`${selectedDate}T24:00:00`);
      if (slotEnd > businessEnd) continue;

      // ROOM-FIRST LOGIC: Check if room is busy during this time slot  
      const roomBusy = daySessionsForRoom.some(s => {
        const sStart = new Date(s.sessionDate).getTime();
        const sEnd = sStart + (((s.service as any)?.duration || 60) * 60000); // Use ACTUAL session duration
        return slotStart.getTime() < sEnd && slotEnd.getTime() > sStart;
      });

      // Available based on ROOM availability only - each room shows its own pattern
      const isAvailable = !roomBusy;
      
      results.push({ 
        time: timeSlot, 
        isAvailable 
      });
    }
    
    
    return results;
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
      
      // Check for time overlap using actual service durations
      const sessionDuration = (session.service as any)?.duration || 60; // minutes
      const otherDuration = (otherSession.service as any)?.duration || 60; // minutes
      const sessionStart = sessionTime.getTime();
      const sessionEnd = sessionStart + (sessionDuration * 60 * 1000);
      const otherStart = otherTime.getTime();
      const otherEnd = otherStart + (otherDuration * 60 * 1000);
      
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
      
      // Check for time overlap using actual service durations
      const sessionDuration = (session.service as any)?.duration || 60; // minutes
      const otherDuration = (otherSession.service as any)?.duration || 60; // minutes
      const sessionStart = sessionTime.getTime();
      const sessionEnd = sessionStart + (sessionDuration * 60 * 1000);
      const otherStart = otherTime.getTime();
      const otherEnd = otherStart + (otherDuration * 60 * 1000);
      
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


  // Helper function to track session for recent items
  const trackSessionViewed = (session: Session) => {
    addRecentSession({
      id: session.id,
      clientId: session.clientId,
      clientName: session.client?.fullName || 'Unknown Client',
      sessionDate: session.sessionDate,
      status: session.status,
      serviceCode: session.service?.serviceCode,
    });
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

  const getWeekSessions = (date: Date): Session[] => {
    // Get start of week (Sunday) and end of week (Saturday) for the given date
    const dayOfWeek = date.getDay();
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    return filteredSessions.filter((session: Session) => {
      const sessionDate = parseSessionDate(session.sessionDate);
      return sessionDate >= weekStart && sessionDate <= weekEnd;
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
                  // Reset form when modal is closed
                  form.reset();
                  setIsSchedulingFromExistingSession(false);
                  setEditingSessionId(null);
                  setProvisionalDuration(60); // Reset to default
                  setUserConfirmedConflicts(false); // Reset conflict confirmation
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
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                              <FormLabel>Client *</FormLabel>
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
                              <FormLabel>Therapist *</FormLabel>
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

                      {/* Service Field - determines duration */}
                      <FormField
                        control={form.control}
                        name="serviceId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Service *</FormLabel>
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

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="sessionDate"
                          render={({ field }) => {
                            const today = getTodayInPracticeTimezone();
                            const currentValue = field.value;
                            const isPastDate = currentValue && currentValue < today;
                            
                            return (
                              <FormItem>
                                <FormLabel>Date *</FormLabel>
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
                          name="roomId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Room *</FormLabel>
                              <Select value={field.value?.toString()} onValueChange={(value) => field.onChange(parseInt(value))}>
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
                      </div>

                      {/* Time Field */}
                      <FormField
                        control={form.control}
                        name="sessionTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Time *</FormLabel>
                            <div className="space-y-2">
                              <Select value={field.value} onValueChange={field.onChange}>
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
                              
                              {/* Quick Duration Tags */}
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">Duration (minutes)</label>
                                <div className="flex flex-wrap gap-2">
                                  {[30, 45, 60, 90, 120].map((minutes) => (
                                    <Button
                                      key={minutes}
                                      type="button"
                                      variant={provisionalDuration === minutes ? "default" : "outline"}
                                      size="sm"
                                      className="h-8 px-3 text-xs"
                                      onClick={() => setProvisionalDuration(minutes)}
                                    >
                                      {minutes}
                                    </Button>
                                  ))}
                                </div>
                              </div>

                              {/* Time Suggestions - Service + Day + Room workflow */}
                              {(() => {
                                const selectedDate = form.watch('sessionDate');
                                const selectedTherapist = form.watch('therapistId');
                                const selectedService = form.watch('serviceId');
                                const selectedRoom = form.watch('roomId');
                                
                                // Service + Day + Room workflow
                                if (!selectedService) {
                                  return (
                                    <div className="text-xs text-slate-500 italic">
                                      📋 Select service first to see available times
                                    </div>
                                  );
                                }
                                
                                if (!selectedDate) {
                                  return (
                                    <div className="text-xs text-slate-500 italic">
                                      📅 Select date to continue
                                    </div>
                                  );
                                }
                                
                                if (!selectedRoom) {
                                  return (
                                    <div className="text-xs text-slate-500 italic">
                                      🏠 Select a room to see available times
                                    </div>
                                  );
                                }
                                
                                if (!selectedTherapist) {
                                  return (
                                    <div className="text-xs text-slate-500 italic">
                                      👩‍⚕️ Select therapist to continue
                                    </div>
                                  );
                                }
                                
                                // Get service duration - no default, must be explicit
                                const selectedServiceData = services?.find(s => s.id === selectedService);
                                const serviceDuration = (selectedServiceData as any)?.duration;
                                
                                if (!serviceDuration || serviceDuration <= 0) {
                                  return (
                                    <div className="text-xs text-orange-600">
                                      Service duration not available - please select a different service
                                    </div>
                                  );
                                }
                                
                                // Convert to numbers for proper comparison with database
                                const roomIdNum = Number(selectedRoom || 0);
                                const therapistIdNum = Number(selectedTherapist || 0);
                                
                                const availableSlots = generateAvailableTimeSlotsForSpecificRoom(selectedDate, serviceDuration, therapistIdNum, roomIdNum, provisionalDuration);
                                
                                // Show loading state if rooms data isn't ready
                                if (!rooms || rooms.length === 0) {
                                  return (
                                    <div className="text-xs text-slate-500 italic">
                                      Loading room availability...
                                    </div>
                                  );
                                }
                                
                                const roomName = rooms?.find(r => r.id === selectedRoom)?.roomName || 'Selected Room';
                                const freeSlots = availableSlots.filter(slot => slot.isAvailable);
                                
                                return (
                                  <div className="space-y-1">
                                    <span className="text-xs text-slate-600">
                                      Available times for {roomName}:
                                    </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {freeSlots.map((slot) => (
                                        <Button
                                          key={slot.time}
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="text-xs px-2 py-1 h-6 text-green-600 hover:text-green-700 border-green-300 hover:border-green-400"
                                          onClick={() => {
                                            form.setValue('sessionTime', slot.time);
                                          }}
                                        >
                                          {formatTime(slot.time)} ✓
                                        </Button>
                                      ))}
                                    </div>
                                    {freeSlots.length === 0 && (
                                      <p className="text-xs text-orange-600 mt-1">
                                        {roomName} is not available for your therapist on this date
                                      </p>
                                    )}
                                    {freeSlots.length > 0 && (
                                      <div className="text-xs text-green-600 bg-green-50 p-2 rounded mt-2">
                                        🏠 {freeSlots.length} time slot{freeSlots.length > 1 ? 's' : ''} available for {roomName}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Session Type Field */}
                      <FormField
                        control={form.control}
                        name="sessionType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Session Type *</FormLabel>
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

                      {/* Zoom Integration Toggle */}
                      <FormField
                        control={form.control}
                        name="zoomEnabled"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Enable Virtual Meeting (Zoom)
                              </FormLabel>
                              <div className="text-sm text-muted-foreground">
                                Create a Zoom meeting for this session. Meeting details will be emailed to the client.
                              </div>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                data-testid="toggle-zoom"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

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
                                  <div className="flex gap-2 mt-1 flex-wrap">
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

                              {/* Proceed Anyway Button */}
                              <div className="mt-4 pt-3 border-t border-red-200">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs text-red-700">
                                    Override conflicts and book anyway?
                                  </p>
                                  <Button
                                    type="button"
                                    variant={userConfirmedConflicts ? "default" : "destructive"}
                                    size="sm"
                                    className="h-7 px-3 text-xs"
                                    onClick={() => setUserConfirmedConflicts(!userConfirmedConflicts)}
                                  >
                                    {userConfirmedConflicts ? "✓ Will Override" : "Proceed Anyway"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

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
                  {format(currentMonth, 'MMMM yyyy')}
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
                                  trackSessionViewed(session);
                                  openEditSessionForm(session);
                                }}
                              >
                                {getConflictIndicator()}
                                {(() => {
                                  // Parse the session date and extract time without timezone conversion
                                  const sessionDate = parseSessionDate(session.sessionDate);
                                  return formatTime(sessionDate);
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
            </div>

            {/* Quick Stats */}
            <QuickStats 
              stats={[
                { label: "Total Sessions", value: allSessionsData?.total || 0 },
                { label: "Showing", value: allSessions.length },
                { label: "Completed", value: allSessions.filter((s: Session) => s.status === 'completed').length, color: "text-green-600" },
                { label: "Upcoming", value: allSessions.filter((s: Session) => s.status === 'scheduled').length, color: "text-blue-600" }
              ]}
            />

            {/* Filters Section */}
            <Card>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 lg:flex lg:flex-wrap gap-4">
                  <div className="lg:w-44">
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Start Date</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal text-sm h-9"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {sessionsFilters.startDate ? format(new Date(sessionsFilters.startDate), 'MMM dd, yyyy') : 'Pick a date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={sessionsFilters.startDate ? new Date(sessionsFilters.startDate + 'T00:00:00') : undefined}
                          onSelect={(date) => {
                            if (date) {
                              const formattedDate = formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
                              setSessionsFilters(prev => ({ 
                                ...prev, 
                                startDate: formattedDate, 
                                page: 1 
                              }));
                            }
                          }}
                          onDayClick={(date) => {
                            // Force trigger even if same date is clicked
                            const formattedDate = formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
                            setSessionsFilters(prev => ({ 
                              ...prev, 
                              startDate: formattedDate, 
                              page: 1 
                            }));
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="lg:w-44">
                    <label className="text-xs font-medium text-slate-700 mb-1 block">End Date</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal text-sm h-9"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {sessionsFilters.endDate ? format(new Date(sessionsFilters.endDate), 'MMM dd, yyyy') : 'Pick a date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={sessionsFilters.endDate ? new Date(sessionsFilters.endDate + 'T00:00:00') : undefined}
                          onSelect={(date) => {
                            if (date) {
                              const formattedDate = formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
                              setSessionsFilters(prev => ({ 
                                ...prev, 
                                endDate: formattedDate, 
                                page: 1 
                              }));
                            }
                          }}
                          onDayClick={(date) => {
                            // Force trigger even if same date is clicked
                            const formattedDate = formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
                            setSessionsFilters(prev => ({ 
                              ...prev, 
                              endDate: formattedDate, 
                              page: 1 
                            }));
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  {/* Therapist filter - only for admin and supervisor roles */}
                  {(user?.role === 'admin' || user?.role === 'administrator' || user?.role === 'supervisor') && (
                    <div className="lg:flex-1 lg:min-w-48">
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
                  )}
                  <div className="lg:w-36">
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
                  <div className="lg:flex-1 lg:min-w-48">
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
                  <div className="lg:w-28">
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
                </div>
                <div className="mt-4">
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
                      <SessionCard
                        key={session.id}
                        session={session}
                        viewMode="list"
                        getStatusColor={getStatusColor}
                        parseSessionDate={parseSessionDate}
                        formatTime={formatTime}
                        getDisplayClientName={getDisplayClientName}
                        getSessionConflictStyle={getSessionConflictStyle}
                        trackSessionViewed={trackSessionViewed}
                        openEditSessionForm={openEditSessionForm}
                        updateSessionStatus={updateSessionStatus}
                      />
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
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {viewMode === "week" ? (
                  (() => {
                    const dayOfWeek = selectedDate.getDay();
                    const weekStart = new Date(selectedDate);
                    weekStart.setDate(selectedDate.getDate() - dayOfWeek);
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekStart.getDate() + 6);
                    return `${format(weekStart, 'MMM dd')} - ${format(weekEnd, 'MMM dd, yyyy')}`;
                  })()
                ) : (
                  format(selectedDate, 'EEEE, MMM dd, yyyy')
                )}
              </h2>
              <div className="flex items-center space-x-2">
                <Switch 
                  checked={showMySessionsOnly}
                  onCheckedChange={setShowMySessionsOnly}
                />
                <span className="text-sm text-slate-600">My Sessions Only</span>
              </div>
            </div>

            {/* Quick Stats */}
            <QuickStats 
              stats={[
                { 
                  label: viewMode === "week" ? "This Week" : "Today", 
                  value: viewMode === "week" ? getWeekSessions(selectedDate).length : getSessionsForDate(selectedDate).length 
                },
                { label: "This Month", value: getMonthSessions().length },
                { 
                  label: "Completed", 
                  value: viewMode === "week" 
                    ? getWeekSessions(selectedDate).filter((s: Session) => s.status === 'completed').length
                    : getSessionsForDate(selectedDate).filter((s: Session) => s.status === 'completed').length,
                  color: "text-green-600"
                },
                { 
                  label: "Upcoming", 
                  value: viewMode === "week"
                    ? getWeekSessions(selectedDate).filter((s: Session) => s.status === 'scheduled').length
                    : getSessionsForDate(selectedDate).filter((s: Session) => s.status === 'scheduled').length,
                  color: "text-blue-600"
                }
              ]}
            />

            <Card>
              <CardContent className="p-6">
                {(() => {
                  const displaySessions = viewMode === "week" 
                    ? getWeekSessions(selectedDate)
                    : getSessionsForDate(selectedDate);
                  
                  return isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-slate-600">Loading schedule...</p>
                      </div>
                    </div>
                  ) : displaySessions.length === 0 ? (
                    <div className="text-center py-12">
                      <CalendarDays className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-slate-900 mb-2">No sessions scheduled</h3>
                      <p className="text-slate-600 mb-4">
                        {viewMode === "week" 
                          ? "No sessions scheduled for this week." 
                          : "Schedule your first appointment for this day."}
                      </p>
                      <Button onClick={() => setIsNewSessionModalOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Schedule Session
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {displaySessions
                        .sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime())
                        .map((session: Session) => (
                          <SessionCard
                            key={session.id}
                            session={session}
                            viewMode={viewMode}
                            getStatusColor={getStatusColor}
                            parseSessionDate={parseSessionDate}
                            formatTime={formatTime}
                            getDisplayClientName={getDisplayClientName}
                            getSessionConflictStyle={getSessionConflictStyle}
                            trackSessionViewed={trackSessionViewed}
                            openEditSessionForm={openEditSessionForm}
                            updateSessionStatus={updateSessionStatus}
                          />
                        ))}
                    </div>
                  );
                })()}
                </CardContent>
              </Card>
          </div>
        )}
      </div>
    </div>
  );
}