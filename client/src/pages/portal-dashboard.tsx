import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, FileText, CreditCard, Upload, Clock } from "lucide-react";
import { formatDateDisplay, formatDateTimeDisplay } from "@/lib/datetime";

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
}

export default function PortalDashboardPage() {
  const [, setLocation] = useLocation();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAppointments, setIsLoadingAppointments] = useState(true);

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

  // Calculate stats
  const upcomingAppointments = appointments.filter(
    app => new Date(`${app.sessionDate}T${app.sessionTime}`) >= new Date()
  );

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
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-lg">TF</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">TherapyFlow</h1>
                <p className="text-xs text-gray-600">Client Portal</p>
              </div>
            </div>
            <Button 
              variant="outline" 
              onClick={handleLogout}
              data-testid="button-portal-logout"
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome Back, {client.fullName}!</h2>
          <p className="text-gray-600">Manage your appointments, billing, and documents all in one place.</p>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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
                  : 'View upcoming sessions'
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">View Schedule</Button>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Appointments */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Upcoming Appointments</CardTitle>
            <CardDescription>Your scheduled therapy sessions</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingAppointments ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-sm text-gray-600">Loading appointments...</p>
              </div>
            ) : appointments.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-sm">No upcoming appointments</p>
                <p className="text-xs">Book a new session to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {appointments.slice(0, 5).map((appointment) => {
                  const sessionDateTime = new Date(`${appointment.sessionDate}T${appointment.sessionTime}`);
                  const isPast = sessionDateTime < new Date();
                  
                  return (
                    <div 
                      key={appointment.id}
                      className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                      data-testid={`appointment-${appointment.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Calendar className="w-4 h-4 text-blue-600" />
                            <span className="font-medium text-gray-900">
                              {formatDateDisplay(appointment.sessionDate)}
                            </span>
                            <span className="text-sm text-gray-600">
                              at {new Date(`2000-01-01T${appointment.sessionTime}`).toLocaleTimeString('en-US', { 
                                hour: 'numeric', 
                                minute: '2-digit',
                                hour12: true 
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            {appointment.sessionType && (
                              <span className="capitalize">{appointment.sessionType}</span>
                            )}
                            {appointment.duration && (
                              <span>{appointment.duration} minutes</span>
                            )}
                            {appointment.location && (
                              <span>{appointment.location}</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            isPast 
                              ? 'bg-gray-100 text-gray-800'
                              : appointment.status === 'confirmed'
                              ? 'bg-green-100 text-green-800'
                              : appointment.status === 'cancelled'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {isPast ? 'Completed' : appointment.status || 'Scheduled'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {appointments.length > 5 && (
                  <p className="text-sm text-gray-500 text-center pt-2">
                    Showing 5 of {appointments.length} appointments
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Your recent portal actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-sm">No recent activity</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
