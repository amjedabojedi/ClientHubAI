import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarIcon, Clock, ArrowLeft, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDateDisplay } from "@/lib/datetime";

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

  // Generate next 14 days
  const generateDates = () => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
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
    
    // Fetch available slots for the next 14 days based on session type
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
          console.log('Received slots data:', data);
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

      const response = await fetch("/api/portal/book-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionDate: selectedDate,
          sessionTime: selectedTime,
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Date Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarIcon className="w-5 h-5" />
                  Select Date
                </CardTitle>
                <CardDescription>Choose a day for your appointment</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {dates.map((date) => {
                    const slotsForDate = availableSlots[date] || [];
                    const hasSlots = slotsForDate.length > 0;
                    const isSelected = selectedDate === date;

                    return (
                      <button
                        key={date}
                        onClick={() => {
                          setSelectedDate(date);
                          setSelectedTime("");
                          setSelectedService(null); // Reset service when date changes
                        }}
                        disabled={!hasSlots}
                        className={`w-full p-3 rounded-lg border text-left transition-all ${
                          isSelected
                            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500"
                            : hasSlots
                            ? "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                            : "border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed"
                        }`}
                        data-testid={`date-${date}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">
                              {formatDateDisplay(date)}
                            </div>
                            <div className="text-sm text-gray-600">
                              {hasSlots
                                ? `${slotsForDate.length} slot${slotsForDate.length === 1 ? '' : 's'} available`
                                : "No slots available"}
                            </div>
                          </div>
                          {isSelected && (
                            <CheckCircle className="w-5 h-5 text-blue-600" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Time Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Select Time
                </CardTitle>
                <CardDescription>
                  {selectedDate
                    ? `Choose a time slot for ${formatDateDisplay(selectedDate)}`
                    : "Select a date first"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedDate ? (
                  <div className="text-center py-12 text-gray-500">
                    <Clock className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm">Please select a date to see available times</p>
                  </div>
                ) : availableSlots[selectedDate]?.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p className="text-sm">No time slots available for this date</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableSlots[selectedDate]?.map((slot) => {
                      const isSelected = selectedTime === slot.start;
                      const displayTime = new Date(`2000-01-01T${slot.start}`).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      });

                      return (
                        <button
                          key={slot.start}
                          onClick={() => setSelectedTime(slot.start)}
                          className={`w-full p-3 rounded-lg border text-center transition-all ${
                            isSelected
                              ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500"
                              : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                          }`}
                          data-testid={`time-${slot.start}`}
                        >
                          <div className="font-medium">{displayTime}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Service Selection - shown after time is selected */}
        {selectedTime && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Select Service
              </CardTitle>
              <CardDescription>Choose the type of service you need</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingServices ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
                  <p className="text-sm text-gray-600">Loading services...</p>
                </div>
              ) : services.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p className="text-sm">No services available</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {services.map((service) => {
                    const isSelected = selectedService === service.id;
                    return (
                      <button
                        key={service.id}
                        onClick={() => setSelectedService(service.id)}
                        className={`w-full p-4 rounded-lg border text-left transition-all ${
                          isSelected
                            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500"
                            : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                        }`}
                        data-testid={`service-${service.id}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-semibold text-gray-900">{service.serviceName}</div>
                            {service.description && (
                              <div className="text-sm text-gray-600 mt-1">{service.description}</div>
                            )}
                            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {service.duration} min
                              </span>
                              <span className="font-medium text-gray-900">${service.baseRate}</span>
                            </div>
                          </div>
                          {isSelected && (
                            <CheckCircle className="w-5 h-5 text-blue-600 ml-3 flex-shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  })}
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
