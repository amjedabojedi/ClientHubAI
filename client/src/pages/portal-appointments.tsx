import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Calendar, Clock, MapPin, User, HelpCircle, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { fromZonedTime } from "date-fns-tz";

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

export default function PortalAppointmentsPage() {
  const [, setLocation] = useLocation();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const PRACTICE_TIMEZONE = 'America/New_York';
  
  const normalizeTime = (time: string) => {
    return time.length === 5 ? `${time}:00` : time;
  };

  useEffect(() => {
    const fetchAppointments = async () => {
      try {
        const response = await fetch("/api/portal/appointments", {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          setAppointments(data);
        } else {
          setLocation("/portal/login");
        }
      } catch (error) {
        console.error("Failed to fetch appointments:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAppointments();
  }, [setLocation]);

  const now = new Date();
  
  const upcomingAppointments = appointments.filter(app => {
    const appointmentDateTime = fromZonedTime(`${app.sessionDate}T${normalizeTime(app.sessionTime)}`, PRACTICE_TIMEZONE);
    return appointmentDateTime >= now && app.status !== 'cancelled' && app.status !== 'completed';
  });
  
  const pastAppointments = appointments.filter(app => {
    const appointmentDateTime = fromZonedTime(`${app.sessionDate}T${normalizeTime(app.sessionTime)}`, PRACTICE_TIMEZONE);
    return appointmentDateTime < now || app.status === 'cancelled' || app.status === 'completed';
  });

  const renderAppointment = (appointment: Appointment) => {
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
        <div className="flex flex-col sm:flex-row gap-4">
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
                  <span>Location: {appointment.roomName}</span>
                </div>
              )}
              {appointment.duration && (
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Duration: {appointment.duration} minutes</span>
                </div>
              )}
              {appointment.referenceNumber && (
                <div className="text-xs text-gray-500">
                  Ref: {appointment.referenceNumber}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/portal/dashboard">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>My Appointments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Loading appointments...</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
          <Link href="/portal/dashboard">
            <Button variant="outline" size="sm" data-testid="button-back" className="text-xs sm:text-sm">
              <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Back to </span>Dashboard
            </Button>
          </Link>
        </div>

        {/* Help Section */}
        <Collapsible
          open={isHelpOpen}
          onOpenChange={setIsHelpOpen}
          className="mb-6"
        >
          <Card className="border-amber-200 bg-amber-50">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-amber-100 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-amber-600" />
                    <CardTitle className="text-base">Managing Your Appointments</CardTitle>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-amber-600 transition-transform ${isHelpOpen ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-amber-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                  <div>
                    <p className="font-medium text-sm">View All Your Sessions</p>
                    <p className="text-xs text-gray-600">This page shows your complete appointment history. Use the tabs to switch between upcoming sessions and past sessions.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-amber-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                  <div>
                    <p className="font-medium text-sm">Appointment Details</p>
                    <p className="text-xs text-gray-600">Each appointment card shows: Date, Time (EST), Therapist name, Location/Room, Duration, and Status (Scheduled, Confirmed, Completed, or Cancelled)</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-amber-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                  <div>
                    <p className="font-medium text-sm">Status Colors</p>
                    <p className="text-xs text-gray-600">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800 mr-1">Confirmed</span> (ready to attend), 
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800 mx-1">Scheduled</span> (awaiting confirmation), 
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800 mx-1">Completed</span> (session finished), 
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800 ml-1">Cancelled</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-amber-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</div>
                  <div>
                    <p className="font-medium text-sm">Book New Session</p>
                    <p className="text-xs text-gray-600">Need to schedule another appointment? Go back to the dashboard and click "Book Appointment" to see available times</p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-amber-100 rounded-lg">
                  <p className="text-xs text-amber-900">
                    <strong>💡 Tips:</strong> You'll receive a reminder notification 24 hours before each upcoming session. If you need to reschedule or cancel, please contact your therapist directly. All times shown are in Eastern Time (America/New_York).
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Appointments Card with Tabs */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-amber-600" />
              <CardTitle>My Appointments</CardTitle>
            </div>
            <CardDescription>
              {upcomingAppointments.length > 0 
                ? `${upcomingAppointments.length} upcoming, ${pastAppointments.length} past`
                : `${pastAppointments.length} total appointment${pastAppointments.length === 1 ? '' : 's'}`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="upcoming" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="upcoming" data-testid="tab-upcoming">
                  Upcoming ({upcomingAppointments.length})
                </TabsTrigger>
                <TabsTrigger value="past" data-testid="tab-past">
                  Past ({pastAppointments.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upcoming">
                {upcomingAppointments.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm">No upcoming appointments</p>
                    <p className="text-xs mb-4">Book a new session to get started</p>
                    <Button onClick={() => setLocation("/portal/book-appointment")}>
                      Book Appointment
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {upcomingAppointments
                      .sort((a, b) => {
                        const dateA = fromZonedTime(`${a.sessionDate}T${normalizeTime(a.sessionTime)}`, PRACTICE_TIMEZONE);
                        const dateB = fromZonedTime(`${b.sessionDate}T${normalizeTime(b.sessionTime)}`, PRACTICE_TIMEZONE);
                        return dateA.getTime() - dateB.getTime();
                      })
                      .map(renderAppointment)
                    }
                  </div>
                )}
              </TabsContent>

              <TabsContent value="past">
                {pastAppointments.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm">No past appointments</p>
                    <p className="text-xs">Your appointment history will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pastAppointments
                      .sort((a, b) => {
                        const dateA = fromZonedTime(`${a.sessionDate}T${normalizeTime(a.sessionTime)}`, PRACTICE_TIMEZONE);
                        const dateB = fromZonedTime(`${b.sessionDate}T${normalizeTime(b.sessionTime)}`, PRACTICE_TIMEZONE);
                        return dateB.getTime() - dateA.getTime(); // Most recent first
                      })
                      .map(renderAppointment)
                    }
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
