import React from 'react';
import { useLocation } from 'wouter';
import { useRecentItems } from '@/hooks/useRecentItems';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Clock,
  Users,
  Calendar,
  CheckSquare,
  User,
  CalendarDays,
  ClipboardList,
  Trash2,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';

const getStatusColor = (status: string) => {
  const colors = {
    active: 'bg-green-100 text-green-800 border-green-200',
    completed: 'bg-blue-100 text-blue-800 border-blue-200',
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    scheduled: 'bg-blue-100 text-blue-800 border-blue-200',
    cancelled: 'bg-red-100 text-red-800 border-red-200',
    overdue: 'bg-red-100 text-red-800 border-red-200',
    intake: 'bg-purple-100 text-purple-800 border-purple-200',
    assessment: 'bg-orange-100 text-orange-800 border-orange-200',
    psychotherapy: 'bg-green-100 text-green-800 border-green-200',
    closed: 'bg-gray-100 text-gray-800 border-gray-200'
  };
  return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800 border-gray-200';
};

const getPriorityColor = (priority: string) => {
  const colors = {
    urgent: 'bg-red-100 text-red-800 border-red-200',
    high: 'bg-orange-100 text-orange-800 border-orange-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-blue-100 text-blue-800 border-blue-200'
  };
  return colors[priority as keyof typeof colors] || 'bg-gray-100 text-gray-800 border-gray-200';
};

const formatTimeAgo = (date: Date) => {
  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  
  if (diffInMinutes < 1) return 'Just now';
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;
  
  return `${Math.floor(diffInDays / 7)}w ago`;
};

interface RecentItemsSidebarProps {
  className?: string;
}

export default function RecentItemsSidebar({ className }: RecentItemsSidebarProps) {
  const [, setLocation] = useLocation();
  const { recentItems, clearRecentItems } = useRecentItems();

  const hasAnyItems = 
    recentItems.clients.length > 0 || 
    recentItems.sessions.length > 0 || 
    recentItems.tasks.length > 0;

  return (
    <Card className={cn("w-80 h-fit", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4" />
            Recent Items
          </CardTitle>
          {hasAnyItems && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearRecentItems}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              title="Clear recent items"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!hasAnyItems ? (
          <div className="p-4 text-center text-muted-foreground">
            <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No recent items</p>
            <p className="text-xs opacity-75">Items you view will appear here</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="p-4 space-y-4">
              
              {/* Recent Clients */}
              {recentItems.clients.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4 text-blue-600" />
                    <h3 className="font-medium text-sm">Recent Clients</h3>
                  </div>
                  <div className="space-y-2">
                    {recentItems.clients.slice(0, 5).map((client) => (
                      <div
                        key={client.id}
                        className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/clients/${client.id}`)}
                      >
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <User className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {client.fullName}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={cn("text-xs py-0", getStatusColor(client.stage))}>
                              {client.stage}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatTimeAgo(client.viewedAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Separator between sections */}
              {recentItems.clients.length > 0 && (recentItems.sessions.length > 0 || recentItems.tasks.length > 0) && (
                <Separator />
              )}

              {/* Recent Sessions */}
              {recentItems.sessions.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <CalendarDays className="w-4 h-4 text-green-600" />
                    <h3 className="font-medium text-sm">Recent Sessions</h3>
                  </div>
                  <div className="space-y-2">
                    {recentItems.sessions.slice(0, 4).map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/scheduling`)}
                      >
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                          <Calendar className="w-4 h-4 text-green-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {session.clientName}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={cn("text-xs py-0", getStatusColor(session.status))}>
                              {session.status}
                            </Badge>
                            {session.serviceCode && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {session.serviceCode}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {formatTimeAgo(session.viewedAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Separator between sections */}
              {recentItems.sessions.length > 0 && recentItems.tasks.length > 0 && (
                <Separator />
              )}

              {/* Recent Tasks */}
              {recentItems.tasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardList className="w-4 h-4 text-orange-600" />
                    <h3 className="font-medium text-sm">Recent Tasks</h3>
                  </div>
                  <div className="space-y-2">
                    {recentItems.tasks.slice(0, 4).map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/tasks`)}
                      >
                        <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                          <CheckSquare className="w-4 h-4 text-orange-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {task.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {task.clientName}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={cn("text-xs py-0", getPriorityColor(task.priority))}>
                              {task.priority}
                            </Badge>
                            <Badge className={cn("text-xs py-0", getStatusColor(task.status))}>
                              {task.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatTimeAgo(task.viewedAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}