import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, FileText, CreditCard, Upload, Clock, MapPin, User, Bell } from "lucide-react";
import { formatDateDisplay, formatDateTimeDisplay } from "@/lib/datetime";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

interface ClientInfo {
  id: number;
  clientId: string;
  fullName: string;
  email: string;
  phone?: string;
  assignedTherapistId?: number;
}

interface Appointment {
  id: number;
  sessionDate: string;
  sessionTime: string;
  duration?: number;
  sessionType?: string;
  status: string;
  location?: string;
  roomName?: string;
  referenceNumber?: string;
  serviceCode?: string;
  serviceName?: string;
  serviceRate?: number;
  therapistName?: string;
}

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  createdAt: Date;
  relatedEntityType: string;
  relatedEntityId: number;
  isRead?: boolean;
}

export default function PortalDashboardPage() {
  const [, setLocation] = useLocation();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAppointments, setIsLoadingAppointments] = useState(true);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);

  useEffect(() => {
    // Check authentication on mount
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/portal/me", {
          credentials: "include", // Send cookies automatically
        });

        if (response.ok) {
          const data = await response.json();
          setClient(data.client);
        } else {
          // Session invalid or expired, redirect to login
          setLocation("/portal/login");
        }
      } catch (error) {
        console.error("Auth check failed:", error);
        setLocation("/portal/login");
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [setLocation]);

  useEffect(() => {
    // Fetch appointments after authentication
    if (!client) return;

    const fetchAppointments = async () => {
      try {
        const response = await fetch("/api/portal/appointments", {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          setAppointments(data);
        }
      } catch (error) {
        console.error("Failed to fetch appointments:", error);
      } finally {
        setIsLoadingAppointments(false);
      }
    };

    fetchAppointments();
  }, [client]);

  useEffect(() => {
    // Fetch notifications after authentication
    if (!client) return;

    const fetchNotifications = async () => {
      try {
        const response = await fetch("/api/portal/notifications", {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          setNotifications(data);
        }
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
      } finally {
        setIsLoadingNotifications(false);
      }
    };

    fetchNotifications();
  }, [client]);

  const handleLogout = async () => {
    try {
      await fetch("/api/portal/logout", {
        method: "POST",
        credentials: "include", // Send cookies automatically
      });
    } catch (error) {
      console.error("Logout error:", error);
    }

    setLocation("/portal/login");
  };

  // Calculate stats - filter out cancelled and completed sessions
  // Use America/New_York timezone for consistent appointment filtering
  const PRACTICE_TIMEZONE = 'America/New_York';
  
  // Get current UTC time - Date objects internally store UTC timestamps
  // When comparing two Date objects, JavaScript compares the underlying UTC values
  const now = new Date();
  
  // Helper to ensure time has seconds component
  const normalizeTime = (time: string) => {
    // If time already has seconds (HH:mm:ss), use as-is
    // If time is HH:mm, append :00
    return time.length === 5 ? `${time}:00` : time;
  };
  
  const upcomingAppointments = appointments.filter(app => {
    // Convert session date/time from America/New_York to UTC Date object
    // fromZonedTime interprets the datetime string as Eastern time and returns UTC
    // Comparing with 'now' (also UTC) gives correct upcoming/past classification
    const appointmentDateTime = fromZonedTime(`${app.sessionDate}T${normalizeTime(app.sessionTime)}`, PRACTICE_TIMEZONE);
    return appointmentDateTime >= now && app.status !== 'cancelled' && app.status !== 'completed';
  });
  
  const pastAppointments = appointments.filter(app => {
    const appointmentDateTime = fromZonedTime(`${app.sessionDate}T${normalizeTime(app.sessionTime)}`, PRACTICE_TIMEZONE);
    return appointmentDateTime < now || app.status === 'cancelled' || app.status === 'completed';
  });
  
  const unreadNotifications = notifications.filter(n => !n.isRead).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!client) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-base sm:text-lg">TF</span>
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900">TherapyFlow</h1>
                <p className="text-xs text-gray-600 hidden sm:block">Client Portal</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                className="relative" 
                data-testid="notification-badge"
                onClick={() => setLocation("/portal/notifications")}
              >
                <Bell className="h-5 w-5 text-gray-600 hover:text-gray-900 cursor-pointer" />
                {unreadNotifications > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center text-xs"
                  >
                    {unreadNotifications}
                  </Badge>
                )}
              </button>
              <Button 
                variant="outline" 
                onClick={handleLogout}
                data-testid="button-portal-logout"
                size="sm"
                className="text-xs sm:text-sm"
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Welcome Back, {client.fullName}!</h2>
          <p className="text-sm sm:text-base text-gray-600">Manage your appointments, billing, and documents all in one place.</p>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-book-appointment">
            <CardHeader>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
              <CardTitle className="text-lg">Book Appointment</CardTitle>
              <CardDescription>Schedule a new session</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                onClick={() => setLocation("/portal/book-appointment")}
                data-testid="button-book-appointment"
              >
                View Available Times
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-view-invoices">
            <CardHeader>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                <CreditCard className="w-6 h-6 text-purple-600" />
              </div>
              <CardTitle className="text-lg">View Invoices</CardTitle>
              <CardDescription>Check billing history</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setLocation("/portal/invoices")}
                data-testid="button-view-invoices"
              >
                View Billing
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-upload-documents">
            <CardHeader>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 text-green-600" />
              </div>
              <CardTitle className="text-lg">Upload Documents</CardTitle>
              <CardDescription>Share insurance & forms</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setLocation("/portal/documents")}
                data-testid="button-upload-documents"
              >
                Upload Files
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-view-appointments">
            <CardHeader>
              <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center mb-3">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
              <CardTitle className="text-lg">My Appointments</CardTitle>
              <CardDescription>
                {upcomingAppointments.length > 0 
                  ? `${upcomingAppointments.length} upcoming session${upcomingAppointments.length === 1 ? '' : 's'}`
                  : 'No upcoming sessions'
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => {
                  const appointmentsSection = document.getElementById('appointments-section');
                  appointmentsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                data-testid="button-view-appointments"
              >
                View My Sessions
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-notifications">
            <CardHeader>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-3">
                <Bell className="w-6 h-6 text-orange-600" />
              </div>
              <CardTitle className="text-lg">Notifications</CardTitle>
              <CardDescription>
                {unreadNotifications > 0 
                  ? `${unreadNotifications} unread notification${unreadNotifications === 1 ? '' : 's'}`
                  : notifications.length > 0
                  ? `${notifications.length} notification${notifications.length === 1 ? '' : 's'}`
                  : 'No notifications'
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setLocation("/portal/notifications")}
                data-testid="button-view-notifications"
              >
                View Notifications
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* My Sessions with Tabs */}
        <Card id="appointments-section">
          <CardHeader>
            <CardTitle>My Sessions</CardTitle>
            <CardDescription>View your upcoming and past appointments</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="upcoming" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="upcoming">
                  Upcoming ({upcomingAppointments.length})
                </TabsTrigger>
                <TabsTrigger value="past">
                  Past ({pastAppointments.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upcoming">
                {isLoadingAppointments ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-sm text-gray-600">Loading appointments...</p>
                  </div>
                ) : upcomingAppointments.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm">No upcoming appointments</p>
                    <p className="text-xs">Book a new session to get started</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {upcomingAppointments
                      .sort((a, b) => {
                        const dateA = fromZonedTime(`${a.sessionDate}T${normalizeTime(a.sessionTime)}`, PRACTICE_TIMEZONE);
                        const dateB = fromZonedTime(`${b.sessionDate}T${normalizeTime(b.sessionTime)}`, PRACTICE_TIMEZONE);
                        return dateA.getTime() - dateB.getTime();
                      })
                      .map((appointment) => {
                      const [year, month, day] = appointment.sessionDate.split('-').map(Number);
                      const localDate = new Date(year, month - 1, day);
                      const formattedDate = localDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      });
                      
                      const formattedTime = new Date(`2000-01-01T${appointment.sessionTime}`).toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                      });
                      
                      return (
                        <div 
                          key={appointment.id}
                          className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                          data-testid={`appointment-${appointment.id}`}
                        >
                          <div className="flex gap-4">
                            <div className="flex flex-col items-start min-w-[120px]">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mb-2 ${
                                appointment.status === 'confirmed'
                                  ? 'bg-green-100 text-green-800'
                                  : appointment.status === 'cancelled'
                                  ? 'bg-red-100 text-red-800'
                                  : appointment.status === 'completed'
                                  ? 'bg-gray-100 text-gray-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {appointment.status === 'scheduled' ? 'Scheduled' : appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                              </span>
                              <div className="text-lg font-semibold text-gray-900">
                                {formattedDate}
                              </div>
                              <div className="text-sm text-gray-600">
                                {formattedTime}
                              </div>
                            </div>
                            
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-medium text-gray-900">
                                  {appointment.serviceName || 'Session'}
                                </h4>
                              </div>
                              
                              <div className="space-y-1 text-sm text-gray-600">
                                {appointment.therapistName && (
                                  <div className="flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    <span>Therapist: {appointment.therapistName}</span>
                                  </div>
                                )}
                                {appointment.roomName && (
                                  <div className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4" />
                                    <span>Room: {appointment.roomName}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                    appointment.sessionType === 'online' 
                                      ? 'bg-blue-100 text-blue-700' 
                                      : 'bg-green-100 text-green-700'
                                  }`}>
                                    {appointment.sessionType === 'online' ? 'Online' : 'In Person'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="past">
                {isLoadingAppointments ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-sm text-gray-600">Loading appointments...</p>
                  </div>
                ) : pastAppointments.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm">No past sessions</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pastAppointments
                      .sort((a, b) => {
                        const dateA = fromZonedTime(`${a.sessionDate}T${normalizeTime(a.sessionTime)}`, PRACTICE_TIMEZONE);
                        const dateB = fromZonedTime(`${b.sessionDate}T${normalizeTime(b.sessionTime)}`, PRACTICE_TIMEZONE);
                        return dateB.getTime() - dateA.getTime();
                      })
                      .map((appointment) => {
                      const [year, month, day] = appointment.sessionDate.split('-').map(Number);
                      const localDate = new Date(year, month - 1, day);
                      const formattedDate = localDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      });
                      
                      const formattedTime = new Date(`2000-01-01T${appointment.sessionTime}`).toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                      });
                      
                      return (
                        <div 
                          key={appointment.id}
                          className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                          data-testid={`past-appointment-${appointment.id}`}
                        >
                          <div className="flex gap-4">
                            <div className="flex flex-col items-start min-w-[120px]">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mb-2 ${
                                appointment.status === 'confirmed'
                                  ? 'bg-green-100 text-green-800'
                                  : appointment.status === 'cancelled'
                                  ? 'bg-red-100 text-red-800'
                                  : appointment.status === 'completed'
                                  ? 'bg-gray-100 text-gray-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {appointment.status === 'scheduled' ? 'Scheduled' : appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                              </span>
                              <div className="text-lg font-semibold text-gray-900">
                                {formattedDate}
                              </div>
                              <div className="text-sm text-gray-600">
                                {formattedTime}
                              </div>
                            </div>
                            
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-medium text-gray-900">
                                  {appointment.serviceName || 'Session'}
                                </h4>
                              </div>
                              
                              <div className="space-y-1 text-sm text-gray-600">
                                {appointment.therapistName && (
                                  <div className="flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    <span>Therapist: {appointment.therapistName}</span>
                                  </div>
                                )}
                                {appointment.roomName && (
                                  <div className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4" />
                                    <span>Room: {appointment.roomName}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                    appointment.sessionType === 'online' 
                                      ? 'bg-blue-100 text-blue-700' 
                                      : 'bg-green-100 text-green-700'
                                  }`}>
                                    {appointment.sessionType === 'online' ? 'Online' : 'In Person'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
