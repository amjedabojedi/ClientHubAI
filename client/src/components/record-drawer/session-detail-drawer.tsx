import { Badge } from "@/components/ui/badge";
import { formatDateTimeDisplay } from "@/lib/datetime";
import { Calendar, User as UserIcon, MapPin, Monitor, FileText } from "lucide-react";

interface SessionDetailDrawerProps {
  session?: any;
  clientName?: string;
  noteStatus?: "finalized" | "draft" | "none";
}

function statusBadgeClass(status?: string): string {
  switch (status) {
    case "completed":
      return "bg-green-50 text-green-700 border-green-200";
    case "scheduled":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "cancelled":
      return "bg-red-50 text-red-700 border-red-200";
    case "rescheduled":
      return "bg-purple-50 text-purple-700 border-purple-200";
    case "no_show":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
}

function titleCase(value?: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 text-slate-400">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-sm text-slate-900">{value}</p>
      </div>
    </div>
  );
}

export function SessionDetailDrawer({ session, clientName, noteStatus }: SessionDetailDrawerProps) {
  if (!session) {
    return <p className="text-sm text-muted-foreground">Session not found.</p>;
  }

  const serviceName = session.service?.serviceName || "Session";
  const therapistName = session.therapistName;
  const roomName = session.room?.roomName;
  const isOnline = session.sessionType === "online";

  const noteLabel =
    noteStatus === "finalized"
      ? "Finalized note on file"
      : noteStatus === "draft"
        ? "Draft note in progress"
        : "No note yet";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">{serviceName}</h3>
        <Badge variant="secondary" className={statusBadgeClass(session.status)}>
          {titleCase(session.status)}
        </Badge>
      </div>

      <div className="divide-y rounded-lg border bg-white">
        <div className="px-4">
          <Row
            icon={<Calendar className="h-4 w-4" />}
            label="Date & Time"
            value={session.sessionDate ? formatDateTimeDisplay(session.sessionDate) : "Date TBD"}
          />
        </div>
        {clientName && (
          <div className="px-4">
            <Row icon={<UserIcon className="h-4 w-4" />} label="Client" value={clientName} />
          </div>
        )}
        {therapistName && (
          <div className="px-4">
            <Row icon={<UserIcon className="h-4 w-4" />} label="Therapist" value={therapistName} />
          </div>
        )}
        {roomName && (
          <div className="px-4">
            <Row icon={<MapPin className="h-4 w-4" />} label="Room" value={roomName} />
          </div>
        )}
        <div className="px-4">
          <Row
            icon={<Monitor className="h-4 w-4" />}
            label="Format"
            value={isOnline ? "Online" : "In person"}
          />
        </div>
        <div className="px-4">
          <Row icon={<FileText className="h-4 w-4" />} label="Session Note" value={noteLabel} />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Use the actions on the session card to add notes, record, or view transcripts.
      </p>
    </div>
  );
}
