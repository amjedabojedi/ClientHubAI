import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Loader2 } from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import NotificationDropdown from "./notification-dropdown.tsx";

interface NotificationBellProps {
  className?: string;
}

export default function NotificationBell({ className }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const userId = user?.id || user?.user?.id;

  // Get unread notification count
  const { data: unreadData, isLoading: countLoading } = useQuery({
    queryKey: ["/api/notifications/unread-count", userId],
    enabled: !!userId,
    refetchInterval: 30000, // Refetch every 30 seconds
    queryFn: async () => {
      const params = new URLSearchParams();
      if (userId) params.append('userId', userId.toString());
      
      const response = await fetch(`/api/notifications/unread-count?${params.toString()}`, {
        credentials: "include"
      });
      if (!response.ok) throw new Error('Failed to fetch unread count');
      return response.json();
    },
  });

  // Get notifications when dropdown is opened
  const { data: notificationsData, isLoading: notificationsLoading } = useQuery({
    queryKey: ["/api/notifications", userId],
    enabled: isOpen && !!userId, // Only fetch when dropdown is open and user is authenticated
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (userId) params.append('userId', userId.toString());
        params.append('limit', '20');
        
        const res = await fetch(`/api/notifications?${params.toString()}`, {
          credentials: "include"
        });
        if (!res.ok) {
          return []; // Return empty array for errors
        }
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
        return [];
      }
    },
  });
  
  const notifications = Array.isArray(notificationsData) ? notificationsData : [];

  // Mark all as read mutation
  const markAllAsReadMutation = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      if (userId) params.append('userId', userId.toString());
      return apiRequest(`/api/notifications/mark-all-read?${params.toString()}`, "PUT");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count", userId] });
    },
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
      <DropdownMenuContent align="end" className="w-80 p-0">
        <NotificationDropdown
          notifications={notifications}
          isLoading={notificationsLoading}
          unreadCount={unreadCount}
          onMarkAllAsRead={() => markAllAsReadMutation.mutate()}
          isMarkingAllAsRead={markAllAsReadMutation.isPending}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}