import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  MessageSquare,
  CheckCircle2,
  XCircle,
  Ban,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface SmsLogEntry {
  id: number;
  action: string;
  result: "success" | "failure" | "blocked" | string;
  eventType: string | null;
  reason: string | null;
  timestamp: string;
}

interface SmsHistoryProps {
  clientId: number;
}

function formatEventType(eventType: string | null): string {
  if (!eventType) return "Appointment text";
  return eventType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function OutcomeBadge({ result }: { result: string }) {
  if (result === "success") {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Sent
      </Badge>
    );
  }
  if (result === "blocked") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 gap-1">
        <Ban className="h-3 w-3" />
        Blocked
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 hover:bg-red-100 gap-1">
      <XCircle className="h-3 w-3" />
      Failed
    </Badge>
  );
}

export default function SmsHistory({ clientId }: SmsHistoryProps) {
  const { data: entries = [], isLoading } = useQuery<SmsLogEntry[]>({
    queryKey: [`/api/clients/${clientId}/sms-log`],
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <MessageSquare className="h-16 w-16 text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">
            No Text Messages Yet
          </h3>
          <p className="text-slate-500 text-center max-w-md">
            Appointment text messages sent to this client — along with any that
            were blocked or failed — will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="sms-history">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Text Messages</h3>
        <p className="text-sm text-slate-500">
          {entries.length} text {entries.length === 1 ? "attempt" : "attempts"}
        </p>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => (
          <Card
            key={entry.id}
            className="border-l-4 border-l-slate-200"
            data-testid={`sms-entry-${entry.id}`}
          >
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <MessageSquare className="h-4 w-4 text-slate-500 shrink-0" />
                    <span className="text-sm font-medium text-slate-900">
                      {formatEventType(entry.eventType)}
                    </span>
                    <OutcomeBadge result={entry.result} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {format(
                      new Date(entry.timestamp),
                      "MMM dd, yyyy 'at' h:mm a",
                    )}
                  </p>
                  {entry.reason && (
                    <p className="text-sm text-slate-600 mt-2">
                      {entry.reason}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
