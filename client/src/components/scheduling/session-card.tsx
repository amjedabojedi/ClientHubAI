import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { 
  Edit, User, MapPin, FileText, MoreVertical, AlertCircle, 
  CalendarDays, CheckCircle, X, RotateCw, Video
} from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";

interface Session {
  id: number;
  sessionDate: string;
  status: string;
  notes?: string;
  clientId: number;
  sessionType: string;
  client?: {
    fullName?: string;
    referenceNumber?: string;
  };
  therapist: {
    fullName: string;
  };
  room?: {
    roomNumber: string;
    roomName: string;
  };
  service?: {
    serviceCode: string;
    baseRate: number;
  };
}

interface ConflictInfo {
  conflictType: 'none' | 'therapist' | 'room' | 'both';
  style: string;
}

interface SessionCardProps {
  session: Session;
  viewMode?: 'day' | 'week' | 'list';
  getStatusColor: (status: string) => string;
  parseSessionDate: (date: string) => Date;
  formatTime: (date: string) => string;
  getDisplayClientName: (session: Session) => string;
  getSessionConflictStyle: (session: Session) => ConflictInfo;
  trackSessionViewed: (session: Session) => void;
  openEditSessionForm: (session: Session) => void;
  updateSessionStatus: (id: number, status: string) => void;
}

export function SessionCard({
  session,
  viewMode = 'list',
  getStatusColor,
  parseSessionDate,
  formatTime,
  getDisplayClientName,
  getSessionConflictStyle,
  trackSessionViewed,
  openEditSessionForm,
  updateSessionStatus
}: SessionCardProps) {
  const [, setLocation] = useLocation();
  const conflictInfo = getSessionConflictStyle(session);
  const hasConflict = conflictInfo.conflictType !== 'none';

  return (
    <div
      className={`
        border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors relative
        ${conflictInfo.style}
      `}
    >
      {hasConflict && (
        <div className={`absolute top-2 right-2 flex items-center px-2 py-1 rounded text-xs ${
          conflictInfo.conflictType === 'therapist' ? 'bg-red-100 text-red-700' :
          conflictInfo.conflictType === 'room' ? 'bg-orange-100 text-orange-700' :
          'bg-red-100 text-red-700'
        }`}>
          <AlertCircle className="w-3 h-3" />
        </div>
      )}
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-4 flex-1">
          <div className="text-center min-w-[100px]">
            <Badge className={`${getStatusColor(session.status)} mb-2`} variant="secondary">
              {session.status}
            </Badge>
            <p className="font-semibold text-lg">
              {format(parseSessionDate(session.sessionDate), 'MMM dd, yyyy')}
            </p>
            <p className="text-sm text-slate-600">
              {formatTime(session.sessionDate)}
            </p>
          </div>
          
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <h3 
                className="font-medium text-primary hover:underline cursor-pointer"
                onClick={() => setLocation(`/clients/${session.clientId}?from=scheduling`)}
              >
                {getDisplayClientName(session)}
              </h3>
              <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded font-mono">
                Ref# {session.client?.referenceNumber || 'N/A'}
              </span>
            </div>
            <div className="space-y-1 text-sm text-slate-600">
              <div className="flex items-center space-x-2">
                <User className="w-4 h-4" />
                <span>Therapist: {session.therapist.fullName}</span>
              </div>
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4" />
                <span>{session.sessionType}</span>
              </div>
              {session.room && (
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4" />
                  <span>Room: {session.room ? `${session.room.roomNumber} - ${session.room.roomName}` : 'TBD'}</span>
                </div>
              )}
              {session.service && (
                <div className="flex items-center space-x-2">
                  <span className="text-xs bg-slate-100 px-2 py-1 rounded">
                    {session.service.serviceCode} - ${session.service.baseRate}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="default" 
            size="sm"
            onClick={() => {
              trackSessionViewed(session);
              openEditSessionForm(session);
            }}
          >
            <Edit className="w-4 h-4 mr-2" />
            Edit Session
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {(session as any).zoomEnabled && (session as any).zoomJoinUrl && (
                <>
                  <DropdownMenuItem onClick={() => window.open((session as any).zoomJoinUrl, '_blank')}>
                    <Video className="w-4 h-4 mr-2 text-blue-600" />
                    Join Zoom Meeting
                  </DropdownMenuItem>
                  <div className="border-t my-1"></div>
                </>
              )}
              
              <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">
                Change Status
              </div>
              <DropdownMenuItem onClick={() => updateSessionStatus(session.id, 'scheduled')}>
                <CalendarDays className="w-4 h-4 mr-2 text-blue-600" />
                Mark Scheduled
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateSessionStatus(session.id, 'completed')}>
                <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                Mark Completed
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateSessionStatus(session.id, 'cancelled')}>
                <X className="w-4 h-4 mr-2 text-red-600" />
                Mark Cancelled
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateSessionStatus(session.id, 'rescheduled')}>
                <RotateCw className="w-4 h-4 mr-2 text-purple-600" />
                Mark Rescheduled
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateSessionStatus(session.id, 'no_show')}>
                <AlertCircle className="w-4 h-4 mr-2 text-yellow-600" />
                Mark No-Show
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      {session.notes && (
        <div className="mt-4 p-3 bg-slate-50 rounded-md">
          <div className="flex items-center space-x-2 mb-2">
            <FileText className="w-4 h-4 text-slate-600" />
            <p className="text-sm font-medium text-slate-700">Session Notes:</p>
          </div>
          <p className="text-sm text-slate-600">{session.notes}</p>
        </div>
      )}
    </div>
  );
}
