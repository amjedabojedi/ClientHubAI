import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle, 
  Clock, 
  User, 
  Calendar, 
  ClipboardList, 
  AlertTriangle,
  Check,
  Trash2,
  ExternalLink,
  Loader2,
  Bell
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  isRead: boolean;
  actionUrl?: string;
  actionLabel?: string;
  createdAt: string;
}

interface NotificationDropdownProps {
  notifications: Notification[];
  isLoading: boolean;
  unreadCount: number;
  onMarkAllAsRead: () => void;
  isMarkingAllAsRead: boolean;
}

export default function NotificationDropdown({ 
  notifications, 
  isLoading, 
  unreadCount,
  onMarkAllAsRead,
  isMarkingAllAsRead
}: NotificationDropdownProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const userId = user?.id || user?.user?.id;

  // Mark single notification as read
  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: number) => 
      apiRequest(`/api/notifications/${notificationId}/read`, "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  // Delete notification
  const deleteNotificationMutation = useMutation({
    mutationFn: (notificationId: number) => 
      apiRequest(`/api/notifications/${notificationId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'client_created':
      case 'client_assigned':
        return <User className="h-4 w-4" />;
      case 'task_assigned':
        return <ClipboardList className="h-4 w-4" />;
      case 'session_scheduled':
      case 'session_overdue':
        return <Calendar className="h-4 w-4" />;
      case 'system_alert':
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-500 text-white';
      case 'high':
        return 'bg-orange-500 text-white';
      case 'medium':
        return 'bg-blue-500 text-white';
      case 'low':
        return 'bg-gray-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const handleActionClick = (notification: Notification) => {
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl;
    }
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id);
    }
  };

  return (
    <div className="w-72 max-w-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMarkAllAsRead}
              disabled={isMarkingAllAsRead}
              className="text-sm"
            >
              {isMarkingAllAsRead ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <CheckCircle className="h-3 w-3 mr-1" />
              )}
              Mark all read
            </Button>
          )}
        </div>
        {unreadCount > 0 && (
          <p className="text-sm text-slate-600 mt-1">
            {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Notifications List */}
      <ScrollArea className="h-96">
        {isLoading ? (
          <div className="p-4 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            <p className="text-sm text-slate-600">Loading notifications...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center">
            <Bell className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-600">No notifications yet</p>
            <p className="text-xs text-slate-400 mt-1">
              You'll see updates about clients, tasks, and sessions here
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "p-4 hover:bg-slate-50 transition-colors",
                  !notification.isRead && "bg-blue-50/50"
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={cn(
                    "p-2 rounded-full flex-shrink-0 mt-0.5",
                    !notification.isRead ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-600"
                  )}>
                    {getNotificationIcon(notification.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className={cn(
                        "text-sm font-medium break-words leading-tight",
                        !notification.isRead ? "text-slate-900" : "text-slate-700"
                      )}>
                        {notification.title}
                      </h4>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Badge 
                          variant="secondary"
                          className={cn("text-xs", getPriorityColor(notification.priority))}
                        >
                          {notification.priority}
                        </Badge>
                        {!notification.isRead && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        )}
                      </div>
                    </div>
                    
                    <p className="text-xs text-slate-600 mt-1 line-clamp-3 break-words">
                      {notification.message}
                    </p>
                    
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-slate-400">
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                      </span>
                      
                      <div className="flex items-center gap-1">
                        {notification.actionUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleActionClick(notification)}
                            className="text-xs h-6 px-2"
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            {notification.actionLabel || 'View'}
                          </Button>
                        )}
                        
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markAsReadMutation.mutate(notification.id)}
                            disabled={markAsReadMutation.isPending}
                            className="text-xs h-6 px-2"
                            title="Mark as read"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                        )}
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteNotificationMutation.mutate(notification.id)}
                          disabled={deleteNotificationMutation.isPending}
                          className="text-xs h-6 px-2 text-red-600 hover:text-red-700"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      {notifications.length > 0 && (
        <>
          <Separator />
          <div className="p-2">
            <Button 
              variant="ghost" 
              className="w-full text-sm"
              onClick={() => window.location.href = '/notifications'}
            >
              View all notifications
            </Button>
          </div>
        </>
      )}
    </div>
  );
}