import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Mail, Clock, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  priority: string;
  isRead: boolean;
  createdAt: string;
  relatedEntityType: string;
  relatedEntityId: number;
}

interface EmailHistoryProps {
  clientId: number;
}

export default function EmailHistory({ clientId }: EmailHistoryProps) {
  const { data: communications = [], isLoading } = useQuery<Notification[]>({
    queryKey: [`/api/clients/${clientId}/communications`],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (communications.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Mail className="h-16 w-16 text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No Communications Yet</h3>
          <p className="text-slate-500 text-center max-w-md">
            Email notifications sent to this client will appear here for tracking and reference.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Email History</h3>
          <p className="text-sm text-slate-500">
            {communications.length} communication{communications.length !== 1 ? 's' : ''} sent
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {communications.map((comm) => (
          <EmailCard key={comm.id} notification={comm} />
        ))}
      </div>
    </div>
  );
}

function EmailCard({ notification }: { notification: Notification }) {
  const [isOpen, setIsOpen] = useState(false);

  const getTypeColor = (type: string) => {
    if (type.includes('scheduled')) return 'blue';
    if (type.includes('rescheduled')) return 'amber';
    if (type.includes('cancelled')) return 'red';
    if (type.includes('completed')) return 'green';
    if (type.includes('reminder')) return 'purple';
    return 'slate';
  };

  const getTypeLabel = (type: string) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'medium':
        return <Clock className="h-4 w-4 text-amber-500" />;
      default:
        return <CheckCircle2 className="h-4 w-4 text-slate-400" />;
    }
  };

  const typeColor = getTypeColor(notification.type);

  return (
    <Card className="border-l-4" style={{ borderLeftColor: `var(--${typeColor}-500)` }}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="h-4 w-4 text-slate-500" />
                <Badge variant="outline" className="text-xs">
                  {getTypeLabel(notification.type)}
                </Badge>
                {getPriorityIcon(notification.priority)}
              </div>
              <CardTitle className="text-base font-medium text-slate-900">
                {notification.title}
              </CardTitle>
              <p className="text-sm text-slate-500 mt-1">
                {format(new Date(notification.createdAt), "MMMM dd, yyyy 'at' h:mm a")}
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="ml-2"
                data-testid={`toggle-email-${notification.id}`}
              >
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-sm text-slate-700 whitespace-pre-wrap font-mono">
                {notification.message}
              </p>
            </div>
            
            <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-1">
                <span className="font-medium">Related to:</span>
                <span>{notification.relatedEntityType || 'General'}</span>
              </div>
              {notification.relatedEntityId && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">ID:</span>
                  <span>#{notification.relatedEntityId}</span>
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
