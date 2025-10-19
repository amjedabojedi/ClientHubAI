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

export default function PortalBookAppointmentPage() {
  const [, setLocation] = useLocation();
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [availableSlots, setAvailableSlots] = useState<Record<string, TimeSlot[]>>({});
  const [isLoading, setIsLoading] = useState(false);
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
    // Fetch available slots for the next 14 days
    const fetchSlots = async () => {
      setIsLoading(true);
      try {
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];
        
        const response = await fetch(
          `/api/portal/available-slots?startDate=${startDate}&endDate=${endDate}&duration=60`,
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
  }, [setLocation]);

  const handleBookAppointment = async () => {
    if (!selectedDate || !selectedTime) {
      setError("Please select a date and time");
      return;
    }

    setIsBooking(true);
    setError("");

    try {
      const response = await fetch("/api/portal/book-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionDate: selectedDate,
          sessionTime: selectedTime,
          duration: 60,
          sessionType: "individual",
          location: "Office",
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

        {/* Booking Summary */}
        {selectedDate && selectedTime && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Confirm Your Appointment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
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
                  <span className="text-gray-600">Duration</span>
                  <span className="font-medium">60 minutes</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-gray-600">Session Type</span>
                  <span className="font-medium">Individual Therapy</span>
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
