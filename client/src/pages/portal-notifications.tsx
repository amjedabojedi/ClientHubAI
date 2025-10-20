import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Bell, Check, Clock, HelpCircle, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { formatDateTimeDisplay } from "@/lib/datetime";

interface Notification {
  id: number;
  clientId: number;
  title: string;
  message: string;
  notificationType: string;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
  metadata: Record<string, any> | null;
}

export default function PortalNotifications() {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/portal/notifications"],
  });

  const unreadNotifications = notifications?.filter(n => !n.isRead).length || 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/portal/dashboard">
              <Button variant="ghost" size="sm" data-testid="button-back-to-dashboard">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>

        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-sm text-gray-600">Loading notifications...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/portal/dashboard">
            <Button variant="ghost" size="sm" data-testid="button-back-to-dashboard">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Help Section */}
        <Collapsible
          open={isHelpOpen}
          onOpenChange={setIsHelpOpen}
          className="mb-6"
        >
          <Card className="border-orange-200 bg-orange-50">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-orange-100 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-orange-600" />
                    <CardTitle className="text-base">Understanding Your Notifications</CardTitle>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-orange-600 transition-transform ${isHelpOpen ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                  <div>
                    <p className="font-medium text-sm">Types of Notifications</p>
                    <p className="text-xs text-gray-600">You'll receive updates about: Appointment confirmations, 24-hour reminders, schedule changes, billing updates, and important messages from your therapist</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                  <div>
                    <p className="font-medium text-sm">Unread vs Read</p>
                    <p className="text-xs text-gray-600">New notifications appear with an orange background and <span className="font-semibold">"New"</span> badge. Once opened, they turn white and show a checkmark to indicate you've seen them</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                  <div>
                    <p className="font-medium text-sm">Automatic Marking</p>
                    <p className="text-xs text-gray-600">Notifications are automatically marked as read when you view this page. No manual action needed!</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</div>
                  <div>
                    <p className="font-medium text-sm">Stay Informed</p>
                    <p className="text-xs text-gray-600">Check back regularly for updates. The dashboard shows your unread count at the top</p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-orange-100 rounded-lg">
                  <p className="text-xs text-orange-900">
                    <strong>💡 Tip:</strong> Important notifications like appointment reminders are sent 24 hours before your session. Make sure to check your notifications daily to stay on track with your appointments and any action items.
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-orange-600" />
                  Notifications
                </CardTitle>
                <CardDescription>
                  {unreadNotifications > 0 
                    ? `${unreadNotifications} unread notification${unreadNotifications === 1 ? '' : 's'}`
                    : notifications && notifications.length > 0
                    ? `${notifications.length} notification${notifications.length === 1 ? '' : 's'}`
                    : 'No notifications'
                  }
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!notifications || notifications.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Bell className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-sm">No notifications yet</p>
                <p className="text-xs">You'll see updates about your appointments and billing here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((notification) => (
                  <div 
                    key={notification.id}
                    className={`p-4 border rounded-lg transition-colors ${
                      notification.isRead 
                        ? 'bg-white hover:bg-gray-50' 
                        : 'bg-orange-50 border-orange-200 hover:bg-orange-100'
                    }`}
                    data-testid={`notification-${notification.id}`}
                  >
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 mt-1">
                        {notification.isRead ? (
                          <Check className="w-5 h-5 text-gray-400" />
                        ) : (
                          <Bell className="w-5 h-5 text-orange-600" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <h3 className={`font-semibold ${
                            notification.isRead ? 'text-gray-900' : 'text-gray-900 font-bold'
                          }`}>
                            {notification.title}
                          </h3>
                          {!notification.isRead && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 flex-shrink-0">
                              New
                            </span>
                          )}
                        </div>
                        
                        <p className="text-sm text-gray-700 mb-2 whitespace-pre-wrap">
                          {notification.message}
                        </p>
                        
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Clock className="w-3 h-3" />
                          <span>{formatDateTimeDisplay(notification.createdAt)}</span>
                          {notification.readAt && (
                            <span className="text-gray-400">
                              • Read {formatDateTimeDisplay(notification.readAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
