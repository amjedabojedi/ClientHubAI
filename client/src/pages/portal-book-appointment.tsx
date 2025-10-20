import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarIcon, Clock, ArrowLeft, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateDisplay, localToUTC } from "@/lib/datetime";
import { format } from "date-fns";

interface TimeSlot {
  start: string;
  end: string;
}

interface Service {
  id: number;
  serviceName: string;
  duration: number;
  baseRate: string;
  description: string | null;
}

export default function PortalBookAppointmentPage() {
  const [, setLocation] = useLocation();
  const [sessionType, setSessionType] = useState<'online' | 'in-person'>('online');
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [selectedService, setSelectedService] = useState<number | null>(null);
  const [availableSlots, setAvailableSlots] = useState<Record<string, TimeSlot[]>>({});
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState("");

  // Generate dates for future booking (1 year ahead - no artificial limit)
  const generateDates = () => {
    const dates = [];
    const today = new Date();
    // Generate 365 days (1 year) - allows long-term therapy scheduling
    for (let i = 0; i < 365; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
  };

  const dates = generateDates();

  useEffect(() => {
    // Reset selections when session type changes
    setSelectedDate("");
    setSelectedTime("");
    
    // Fetch available slots for the next year based on session type
    const fetchSlots = async () => {
      setIsLoading(true);
      setError("");
      try {
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];
        
        const response = await fetch(
          `/api/portal/available-slots?startDate=${startDate}&endDate=${endDate}&sessionType=${sessionType}`,
          { credentials: "include" }
        );

        if (response.ok) {
          const data = await response.json();
          setAvailableSlots(data);
        } else if (response.status === 401) {
          setLocation("/portal/login");
        } else {
          const errorData = await response.json();
          setError(errorData.error || "Failed to load available slots");
        }
      } catch (err) {
        setError("Failed to load available slots");
      } finally {
        setIsLoading(false);
      }
    };

    fetchSlots();
  }, [sessionType, setLocation]);

  // Fetch services when time is selected
  useEffect(() => {
    if (selectedTime) {
      fetchServices();
    } else {
      // Reset service selection when time is cleared
      setSelectedService(null);
      setServices([]);
    }
  }, [selectedTime]);

  const fetchServices = async () => {
    try {
      setIsLoadingServices(true);
      const response = await fetch("/api/portal/services", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch services");
      }

      const data = await response.json();
      setServices(data);
    } catch (err) {
      console.error("Failed to fetch services:", err);
      setError("Failed to load available services");
    } finally {
      setIsLoadingServices(false);
    }
  };

  const handleBookAppointment = async () => {
    if (!selectedDate || !selectedTime) {
      setError("Please select a date and time");
      return;
    }

    if (!selectedService) {
      setError("Please select a service");
      return;
    }

    setIsBooking(true);
    setError("");

    try {
      // Find selected service to get duration
      const service = services.find(s => s.id === selectedService);
      if (!service) {
        setError("Invalid service selected");
        setIsBooking(false);
        return;
      }

      // Convert EST date/time to UTC before sending to server
      const sessionStartUtc = localToUTC(selectedDate, selectedTime);
      
      const response = await fetch("/api/portal/book-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionStartUtc: sessionStartUtc.toISOString(),
          duration: service.duration,
          serviceId: selectedService,
          sessionType: sessionType, // Use the selected session type
          location: sessionType === 'online' ? 'Online' : 'Office',
        }),
      });

      if (response.ok) {
        setIsSuccess(true);
        setTimeout(() => {
          setLocation("/portal/dashboard");
        }, 2000);
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to book appointment");
      }
    } catch (err) {
      setError("Failed to book appointment");
    } finally {
      setIsBooking(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <CardTitle className="text-2xl">Appointment Booked!</CardTitle>
            <CardDescription>
              Your appointment has been successfully scheduled.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              Redirecting you to the dashboard...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/portal/dashboard")}
              data-testid="button-back"
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">Book Appointment</h1>
              <p className="text-xs sm:text-sm text-gray-600 hidden sm:block">Select a date and time for your session</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 sm:py-8 max-w-4xl">
        {error && (
          <Alert variant="destructive" className="mb-4 sm:mb-6">
            <AlertDescription className="text-xs sm:text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {/* Session Type Selection */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Session Type</CardTitle>
            <CardDescription>Choose how you would like to attend your session</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setSessionType('online')}
                className={`p-4 rounded-lg border-2 transition-all ${
                  sessionType === 'online'
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
                data-testid="button-session-type-online"
              >
                <div className="text-center">
                  <div className="text-2xl mb-2">💻</div>
                  <div className="font-semibold">Online</div>
                  <div className="text-xs text-gray-600 mt-1">Video session</div>
                </div>
              </button>
              <button
                onClick={() => setSessionType('in-person')}
                className={`p-4 rounded-lg border-2 transition-all ${
                  sessionType === 'in-person'
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
                data-testid="button-session-type-in-person"
              >
                <div className="text-center">
                  <div className="text-2xl mb-2">🏢</div>
                  <div className="font-semibold">In-Person</div>
                  <div className="text-xs text-gray-600 mt-1">Office visit</div>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-8 sm:py-12">
            <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-sm sm:text-base text-gray-600">Loading available time slots...</p>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Select Date & Time</CardTitle>
              <CardDescription>Choose when you'd like your appointment</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Date Picker - Always visible calendar */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Date</label>
                <div className="flex justify-center border rounded-lg p-4">
                  <Calendar
                    mode="single"
                    selected={selectedDate ? new Date(selectedDate + 'T12:00:00') : undefined}
                    onSelect={(date) => {
                      if (date) {
                        // Use local timezone to avoid date shifts
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        const dateStr = `${year}-${month}-${day}`;
                        
                        // Only select dates with available slots
                        if (availableSlots[dateStr] && availableSlots[dateStr].length > 0) {
                          setSelectedDate(dateStr);
                          setSelectedTime("");
                          setSelectedService(null);
                        }
                      }
                    }}
                    disabled={(date) => {
                      // Use local timezone to avoid date shifts
                      const year = date.getFullYear();
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      const dateStr = `${year}-${month}-${day}`;
                      
                      // Disable dates outside therapist's available range or with no slots
                      const hasSlots = availableSlots[dateStr] && availableSlots[dateStr].length > 0;
                      return !hasSlots;
                    }}
                    fromDate={new Date()} // Start from today
                    defaultMonth={new Date()} // Start with current month
                    initialFocus
                  />
                </div>
                {selectedDate && (
                  <div className="text-center text-sm font-medium text-blue-600">
                    Selected: {formatDateDisplay(selectedDate)}
                  </div>
                )}
              </div>

              {/* Time Dropdown */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Time</label>
                <Select
                  value={selectedTime}
                  onValueChange={setSelectedTime}
                  disabled={!selectedDate}
                >
                  <SelectTrigger className="w-full" data-testid="select-time">
                    <SelectValue placeholder={selectedDate ? "Select a time" : "Select a date first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedDate && availableSlots[selectedDate]?.map((slot) => {
                      const displayTime = new Date(`2000-01-01T${slot.start}`).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      });
                      return (
                        <SelectItem key={slot.start} value={slot.start} data-testid={`time-${slot.start}`}>
                          {displayTime}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Service Selection - shown after time is selected */}
        {selectedTime && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Select Service</CardTitle>
              <CardDescription>Choose the type of service you need</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingServices ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
                  <p className="text-sm text-gray-600">Loading services...</p>
                </div>
              ) : services.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  <p className="text-sm">No services available</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Service</label>
                  <Select
                    value={selectedService?.toString()}
                    onValueChange={(value) => setSelectedService(parseInt(value))}
                  >
                    <SelectTrigger className="w-full" data-testid="select-service">
                      <SelectValue placeholder="Select a service" />
                    </SelectTrigger>
                    <SelectContent>
                      {services.map((service) => (
                        <SelectItem key={service.id} value={service.id.toString()} data-testid={`service-${service.id}`}>
                          <div className="flex items-center justify-between w-full gap-4">
                            <span className="font-medium">{service.serviceName}</span>
                            <span className="text-sm text-muted-foreground">
                              {service.duration}min • ${service.baseRate}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedService && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="text-sm text-gray-700">
                        {services.find(s => s.id === selectedService)?.description || 'Professional therapy service'}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Booking Summary */}
        {selectedDate && selectedTime && selectedService && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Confirm Your Appointment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-gray-600">Session Type</span>
                  <span className="font-medium capitalize">{sessionType}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-gray-600">Date</span>
                  <span className="font-medium">{formatDateDisplay(selectedDate)}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-gray-600">Time</span>
                  <span className="font-medium">
                    {new Date(`2000-01-01T${selectedTime}`).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-gray-600">Service</span>
                  <span className="font-medium">{services.find(s => s.id === selectedService)?.serviceName}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-gray-600">Duration</span>
                  <span className="font-medium">{services.find(s => s.id === selectedService)?.duration} minutes</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-gray-600">Cost</span>
                  <span className="font-medium">${services.find(s => s.id === selectedService)?.baseRate}</span>
                </div>

                <Button
                  onClick={handleBookAppointment}
                  disabled={isBooking}
                  className="w-full mt-4"
                  data-testid="button-confirm-booking"
                >
                  {isBooking ? "Booking..." : "Confirm Appointment"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
