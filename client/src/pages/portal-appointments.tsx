import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, Calendar, Clock, MapPin, User, HelpCircle, ChevronDown, Star } from "lucide-react";
import { Link } from "wouter";
import { fromZonedTime } from "date-fns-tz";

interface SrsRating {
  relationship: number;
  goalsTopics: number;
  approachMethod: number;
  overall: number;
  totalScore: number;
  completedAt: string;
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
  srsRating?: SrsRating | null;
}

const SRS_DIMENSIONS = [
  { key: "relationship", label: "Relationship", left: "I did not feel heard, understood, or respected", right: "I felt heard, understood, and respected" },
  { key: "goalsTopics", label: "Goals & Topics", left: "We did not work on what I wanted to work on", right: "We worked on what I wanted to work on" },
  { key: "approachMethod", label: "Approach or Method", left: "The therapist's approach is not a good fit for me", right: "The therapist's approach is a good fit for me" },
  { key: "overall", label: "Overall", left: "There was something missing in the session today", right: "Overall, today's session was right for me" },
] as const;

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 36 ? "bg-green-100 text-green-800 border-green-200" : score >= 30 ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-red-100 text-red-800 border-red-200";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>
      <Star className="w-3 h-3" />
      {score}/40
    </span>
  );
}

export default function PortalAppointmentsPage() {
  const [, setLocation] = useLocation();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const [ratingSession, setRatingSession] = useState<Appointment | null>(null);
  const [scores, setScores] = useState({ relationship: 5, goalsTopics: 5, approachMethod: 5, overall: 5 });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const PRACTICE_TIMEZONE = 'America/New_York';

  const normalizeTime = (time: string) => time.length === 5 ? `${time}:00` : time;

  const fetchAppointments = async () => {
    try {
      const response = await fetch("/api/portal/appointments", { credentials: "include" });
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

  useEffect(() => { fetchAppointments(); }, []);

  const now = new Date();

  const upcomingAppointments = appointments.filter(app => {
    const dt = fromZonedTime(`${app.sessionDate}T${normalizeTime(app.sessionTime)}`, PRACTICE_TIMEZONE);
    return dt >= now && app.status !== 'cancelled' && app.status !== 'completed';
  });

  const pastAppointments = appointments.filter(app => {
    const dt = fromZonedTime(`${app.sessionDate}T${normalizeTime(app.sessionTime)}`, PRACTICE_TIMEZONE);
    return dt < now || app.status === 'cancelled' || app.status === 'completed';
  });

  const handleSubmitRating = async () => {
    if (!ratingSession) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/portal/sessions/${ratingSession.id}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(scores),
      });
      if (res.ok) {
        const rating = await res.json();
        setAppointments(prev => prev.map(a => a.id === ratingSession.id ? {
          ...a,
          srsRating: {
            relationship: scores.relationship,
            goalsTopics: scores.goalsTopics,
            approachMethod: scores.approachMethod,
            overall: scores.overall,
            totalScore: parseFloat(rating.totalScore),
            completedAt: rating.completedAt,
          }
        } : a));
        setRatingSession(null);
        setScores({ relationship: 5, goalsTopics: 5, approachMethod: 5, overall: 5 });
      } else {
        const err = await res.json();
        setSubmitError(err.error || "Failed to submit rating");
      }
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderAppointment = (appointment: Appointment, isPast = false) => {
    const [year, month, day] = appointment.sessionDate.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    const formattedDate = localDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const formattedTime = new Date(`2000-01-01T${appointment.sessionTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const canRate = isPast && appointment.status === 'completed' && !appointment.srsRating;

    return (
      <div key={appointment.id} className="p-4 border rounded-lg hover:bg-gray-50 transition-colors">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex flex-col items-start min-w-[120px]">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mb-2 ${
              appointment.status === 'confirmed' ? 'bg-green-100 text-green-800'
              : appointment.status === 'cancelled' ? 'bg-red-100 text-red-800'
              : appointment.status === 'completed' ? 'bg-gray-100 text-gray-800'
              : 'bg-blue-100 text-blue-800'
            }`}>
              {appointment.status === 'scheduled' ? 'Scheduled' : appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
            </span>
            <div className="text-lg font-semibold text-gray-900">{formattedDate}</div>
            <div className="text-sm text-gray-600">{formattedTime}</div>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h4 className="font-medium text-gray-900">{appointment.serviceName || 'Session'}</h4>
              {appointment.srsRating && <ScoreBadge score={appointment.srsRating.totalScore} />}
            </div>

            <div className="space-y-1 text-sm text-gray-600">
              {appointment.therapistName && (
                <div className="flex items-center gap-2"><User className="w-4 h-4" /><span>Therapist: {appointment.therapistName}</span></div>
              )}
              {appointment.roomName && (
                <div className="flex items-center gap-2"><MapPin className="w-4 h-4" /><span>Location: {appointment.roomName}</span></div>
              )}
              {appointment.duration && (
                <div className="flex items-center gap-2"><Clock className="w-4 h-4" /><span>Duration: {appointment.duration} minutes</span></div>
              )}
              {appointment.referenceNumber && (
                <div className="text-xs text-gray-500">Ref: {appointment.referenceNumber}</div>
              )}
            </div>

            {/* SRS Rating Section */}
            {isPast && appointment.status === 'completed' && (
              <div className="mt-3">
                {appointment.srsRating ? (
                  <div className="bg-gray-50 border rounded-lg p-3">
                    <p className="text-xs font-medium text-gray-700 mb-2">Your Session Rating</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                      <span>Relationship: <strong>{appointment.srsRating.relationship}/10</strong></span>
                      <span>Goals & Topics: <strong>{appointment.srsRating.goalsTopics}/10</strong></span>
                      <span>Approach: <strong>{appointment.srsRating.approachMethod}/10</strong></span>
                      <span>Overall: <strong>{appointment.srsRating.overall}/10</strong></span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-gray-200">
                        <div
                          className={`h-2 rounded-full ${appointment.srsRating.totalScore >= 36 ? 'bg-green-500' : appointment.srsRating.totalScore >= 30 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${(appointment.srsRating.totalScore / 40) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold">{appointment.srsRating.totalScore}/40</span>
                    </div>
                  </div>
                ) : canRate ? (
                  <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => { setRatingSession(appointment); setScores({ relationship: 5, goalsTopics: 5, approachMethod: 5, overall: 5 }); }}>
                    <Star className="w-3 h-3 mr-1" />
                    Rate this session
                  </Button>
                ) : null}
              </div>
            )}
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
              <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back to Dashboard</Button>
            </Link>
          </div>
          <Card>
            <CardHeader><CardTitle>My Appointments</CardTitle></CardHeader>
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
            <Button variant="outline" size="sm" className="text-xs sm:text-sm">
              <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Back to </span>Dashboard
            </Button>
          </Link>
        </div>

        {/* Help Section */}
        <Collapsible open={isHelpOpen} onOpenChange={setIsHelpOpen} className="mb-6">
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
                {[
                  { n: 1, title: "View Your Recent Sessions", desc: "This page shows your appointments from the last 6 months. Use the tabs to switch between upcoming sessions and past sessions." },
                  { n: 2, title: "Appointment Details", desc: "Each appointment card shows: Date, Time (EST), Therapist name, Location/Room, Duration, and Status." },
                  { n: 3, title: "Rate Your Sessions", desc: "After a session is completed, you'll see a 'Rate this session' button. Your feedback helps your therapist improve the sessions for you. Ratings are anonymous to the clinic admin." },
                  { n: 4, title: "Book New Session", desc: "Need to schedule another appointment? Go back to the dashboard and click 'Book Appointment' to see available times." },
                ].map(({ n, title, desc }) => (
                  <div key={n} className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-6 h-6 bg-amber-600 text-white rounded-full flex items-center justify-center text-xs font-bold">{n}</div>
                    <div><p className="font-medium text-sm">{title}</p><p className="text-xs text-gray-600">{desc}</p></div>
                  </div>
                ))}
                <div className="mt-4 p-3 bg-amber-100 rounded-lg">
                  <p className="text-xs text-amber-900"><strong>💡 Tips:</strong> You'll receive a reminder notification 24 hours before each upcoming session. All times shown are in Eastern Time (America/New_York).</p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Appointments Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-amber-600" />
              <CardTitle>My Appointments</CardTitle>
            </div>
            <CardDescription>
              {upcomingAppointments.length > 0
                ? `${upcomingAppointments.length} upcoming, ${pastAppointments.length} past (last 6 months)`
                : `${pastAppointments.length} appointment${pastAppointments.length === 1 ? '' : 's'} (last 6 months)`}
              <span className="block mt-1 text-gray-500">For older records, please contact your therapist.</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="upcoming" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="upcoming">Upcoming ({upcomingAppointments.length})</TabsTrigger>
                <TabsTrigger value="past">Past ({pastAppointments.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="upcoming">
                {upcomingAppointments.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm">No upcoming appointments</p>
                    <p className="text-xs mb-4">Book a new session to get started</p>
                    <Button onClick={() => setLocation("/portal/book-appointment")}>Book Appointment</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {upcomingAppointments
                      .sort((a, b) => fromZonedTime(`${a.sessionDate}T${normalizeTime(a.sessionTime)}`, PRACTICE_TIMEZONE).getTime() - fromZonedTime(`${b.sessionDate}T${normalizeTime(b.sessionTime)}`, PRACTICE_TIMEZONE).getTime())
                      .map(a => renderAppointment(a, false))}
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
                      .sort((a, b) => fromZonedTime(`${b.sessionDate}T${normalizeTime(b.sessionTime)}`, PRACTICE_TIMEZONE).getTime() - fromZonedTime(`${a.sessionDate}T${normalizeTime(a.sessionTime)}`, PRACTICE_TIMEZONE).getTime())
                      .map(a => renderAppointment(a, true))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* SRS Rating Dialog */}
      <Dialog open={!!ratingSession} onOpenChange={(open) => { if (!open) { setRatingSession(null); setSubmitError(""); } }}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              Session Rating Scale (SRS)
            </DialogTitle>
            <DialogDescription>
              Please rate today's session by moving each slider. Your feedback helps improve your care.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {SRS_DIMENSIONS.map(dim => (
              <div key={dim.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{dim.label}</span>
                  <span className="text-sm font-bold text-gray-900">{scores[dim.key]}/10</span>
                </div>
                <div className="flex gap-2 text-xs text-gray-400">
                  <span className="flex-1 text-left leading-tight">{dim.left}</span>
                  <span className="flex-1 text-right leading-tight">{dim.right}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={scores[dim.key]}
                  onChange={e => setScores(prev => ({ ...prev, [dim.key]: parseFloat(e.target.value) }))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
            ))}

            {/* Total score preview */}
            <div className="bg-gray-50 border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600">Total Score</span>
                <ScoreBadge score={parseFloat((scores.relationship + scores.goalsTopics + scores.approachMethod + scores.overall).toFixed(1))} />
              </div>
              <div className="h-2 rounded-full bg-gray-200">
                <div
                  className={`h-2 rounded-full transition-all ${(scores.relationship + scores.goalsTopics + scores.approachMethod + scores.overall) >= 36 ? 'bg-green-500' : (scores.relationship + scores.goalsTopics + scores.approachMethod + scores.overall) >= 30 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${((scores.relationship + scores.goalsTopics + scores.approachMethod + scores.overall) / 40) * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Scores of 36+ indicate a strong working relationship</p>
            </div>

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setRatingSession(null); setSubmitError(""); }}>Cancel</Button>
            <Button className="bg-amber-600 hover:bg-amber-700" disabled={submitting} onClick={handleSubmitRating}>
              {submitting ? "Submitting..." : "Submit Rating"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
