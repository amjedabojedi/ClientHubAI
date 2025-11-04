import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Loader2, AlertCircle } from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import NotificationDropdown from "./notification-dropdown.tsx";

interface NotificationBellProps {
  className?: string;
}

export default function NotificationBell({ className }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const userId = user?.id;

  const { data: unreadData, isLoading: countLoading, error: countError, refetch: refetchCount } = useQuery({
    queryKey: ["/api/notifications/unread-count", userId],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!user && !!userId,
    refetchInterval: 30000, // Refetch every 30 seconds
    retry: false, // Disable retry to prevent loops on auth failures
  });

  // Get notifications when dropdown is opened
  const { data: notificationsData, isLoading: notificationsLoading, error: notificationsError, refetch: refetchNotifications } = useQuery({
    queryKey: ["/api/notifications", userId, { limit: 20 }],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isOpen && !!user && !!userId, // Only fetch when dropdown is open and user is authenticated
    retry: (failureCount, error: any) => {
      // Stop retrying on auth failures
      if (error?.message?.includes('401') || error?.message?.includes('403')) {
        return false;
      }
      // Retry up to 2 times for notifications dropdown
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
  
  const notifications = Array.isArray(notificationsData) ? notificationsData : [];

  // Mark all as read mutation
  const markAllAsReadMutation = useMutation({
    mutationFn: () => apiRequest("/api/notifications/mark-all-read", "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count", userId] });
      toast({
        title: "Success",
        description: "All notifications marked as read",
      });
    },
    onError: (error: any) => {
      console.error("Failed to mark all notifications as read:", error);
      toast({
        title: "Error",
        description: "Failed to mark notifications as read. Please try again.",
        variant: "destructive",
      });
    },
    retry: 2, // Retry mutations up to 2 times
  });

  const unreadCount = (unreadData as { count: number })?.count || 0;
  const hasUnread = unreadCount > 0;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "relative p-2 hover:bg-slate-100 dark:hover:bg-slate-800",
            className
          )}
        >
          <Bell className="h-5 w-5" />
          {hasUnread && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
          {countLoading && (
            <Loader2 className="absolute -top-1 -right-1 h-3 w-3 animate-spin text-blue-500" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 max-w-[95vw] p-0">
        <NotificationDropdown
          notifications={notifications}
          isLoading={notificationsLoading}
          unreadCount={unreadCount}
          onMarkAllAsRead={() => markAllAsReadMutation.mutate()}
          isMarkingAllAsRead={markAllAsReadMutation.isPending}
          error={notificationsError}
          onRetry={() => refetchNotifications()}
          countError={countError}
          onRetryCount={() => refetchCount()}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}