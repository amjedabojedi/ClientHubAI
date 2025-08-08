import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Bell, 
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
  Settings,
  Plus,
  Search,
  Filter,
  Edit
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

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

interface NotificationTrigger {
  id: number;
  name: string;
  event?: string;
  eventType?: string;
  isActive: boolean;
  conditions?: any;
  conditionRules?: any;
  templateId: number;
  createdAt: string;
}

interface NotificationTemplate {
  id: number;
  name: string;
  subject: string;
  message?: string;
  body_template?: string;
  bodyTemplate?: string;
  type: string;
  priority?: string;
  createdAt: string;
}

// Create Trigger Form Component
interface CreateTriggerFormProps {
  onSubmit: (data: any) => void;
  isLoading: boolean;
  templates: NotificationTemplate[];
}

function CreateTriggerForm({ onSubmit, isLoading, templates, trigger }: CreateTriggerFormProps) {
  const [formData, setFormData] = useState({
    name: trigger?.name || "",
    event: trigger?.event || trigger?.eventType || "",
    templateId: trigger?.templateId?.toString() || "",
    isActive: trigger?.isActive ?? true,
    conditions: (() => {
      const conditionsValue = trigger?.conditions || trigger?.conditionRules || {};
      return typeof conditionsValue === 'string' ? conditionsValue : JSON.stringify(conditionsValue, null, 2);
    })()
  });

  // Update form data when trigger changes (for editing)
  useEffect(() => {
    if (trigger) {
      // Trigger data loaded successfully
      const eventValue = trigger.event || trigger.eventType || "";
      const conditionsValue = trigger.conditions || trigger.conditionRules || {};
      const conditionsJson = typeof conditionsValue === 'string' ? conditionsValue : JSON.stringify(conditionsValue, null, 2);
      
      setFormData({
        name: trigger.name || "",
        event: eventValue,
        templateId: trigger.templateId?.toString() || "",
        isActive: trigger.isActive ?? true,
        conditions: conditionsJson
      });
    } else {
      // Reset form for new trigger
      setFormData({
        name: "",
        event: "",
        templateId: "",
        isActive: true,
        conditions: "{}"
      });
    }
  }, [trigger]);
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [simpleConditions, setSimpleConditions] = useState({
    priority: "any",
    status: "any",
    therapistId: "",
    clientType: "any"
  });

  const eventOptions = [
    // Client Events
    { value: "client_created", label: "New Client Created" },
    { value: "client_assigned", label: "Client Assigned to Therapist" },
    { value: "client_status_changed", label: "Client Status Changed" },
    
    // Session Events
    { value: "session_scheduled", label: "Session Scheduled" },
    { value: "session_rescheduled", label: "Session Rescheduled" },
    { value: "session_cancelled", label: "Session Cancelled" },
    { value: "session_completed", label: "Session Completed" },
    { value: "session_overdue", label: "Session Overdue/Missed" },
    
    // Task Events
    { value: "task_assigned", label: "Task Assigned" },
    { value: "task_completed", label: "Task Completed" },
    { value: "task_overdue", label: "Task Overdue" },
    { value: "task_status_changed", label: "Task Status Changed" },
    
    // Document Events
    { value: "document_uploaded", label: "Document Uploaded" },
    { value: "document_needs_review", label: "Document Needs Supervisor Review" },
    { value: "document_reviewed", label: "Document Reviewed" },
    
    // Assessment Events
    { value: "assessment_assigned", label: "Assessment Assigned" },
    { value: "assessment_completed", label: "Assessment Completed" },
    { value: "assessment_overdue", label: "Assessment Overdue" },
    
    // Billing Events
    { value: "payment_overdue", label: "Payment Overdue" },
    { value: "billing_generated", label: "Billing Record Generated" },
    
    // System Events
    { value: "user_login_failed", label: "Failed Login Attempt" },
    { value: "system_backup", label: "System Backup Completed" }
  ];

  // Update conditions based on simple form
  const updateConditions = () => {
    if (!showAdvanced) {
      const conditions: any = {};
      if (simpleConditions.priority && simpleConditions.priority !== "any") conditions.priority = simpleConditions.priority;
      if (simpleConditions.status && simpleConditions.status !== "any") conditions.status = simpleConditions.status;
      if (simpleConditions.therapistId && simpleConditions.therapistId.trim()) conditions.therapistId = simpleConditions.therapistId;
      if (simpleConditions.clientType && simpleConditions.clientType !== "any") conditions.clientType = simpleConditions.clientType;
      
      setFormData(prev => ({ ...prev, conditions: JSON.stringify(conditions, null, 2) }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConditions();
    // Map form fields to API fields
    const submitData = {
      ...formData,
      eventType: formData.event,
      conditionRules: formData.conditions,
      templateId: parseInt(formData.templateId)
    };
    // Remove the form-only fields before sending to API
    delete submitData.event;
    delete submitData.conditions;
    onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Trigger Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter trigger name"
          required
        />
      </div>

      <div>
        <Label htmlFor="event">Event Type</Label>
        <Select value={formData.event} onValueChange={(value) => setFormData({ ...formData, event: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Select event type" />
          </SelectTrigger>
          <SelectContent className="max-h-[350px] overflow-y-auto">
            <div className="py-1 space-y-1">
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">Client Events</div>
              <SelectItem value="client_created">New Client Created</SelectItem>
              <SelectItem value="client_assigned">Client Assigned to Therapist</SelectItem>
              <SelectItem value="client_status_changed">Client Status Changed</SelectItem>
            </div>
            
            <div className="py-1 space-y-1">
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">Session Events</div>
              <SelectItem value="session_scheduled">Session Scheduled</SelectItem>
              <SelectItem value="session_rescheduled">Session Rescheduled</SelectItem>
              <SelectItem value="session_cancelled">Session Cancelled</SelectItem>
              <SelectItem value="session_completed">Session Completed</SelectItem>
              <SelectItem value="session_overdue">Session Overdue/Missed</SelectItem>
            </div>
            
            <div className="py-1 space-y-1">
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">Task Events</div>
              <SelectItem value="task_assigned">Task Assigned</SelectItem>
              <SelectItem value="task_completed">Task Completed</SelectItem>
              <SelectItem value="task_overdue">Task Overdue</SelectItem>
              <SelectItem value="task_status_changed">Task Status Changed</SelectItem>
            </div>
            
            <div className="py-1 space-y-1">
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">Document Events</div>
              <SelectItem value="document_uploaded">Document Uploaded</SelectItem>
              <SelectItem value="document_needs_review">Document Needs Supervisor Review</SelectItem>
              <SelectItem value="document_reviewed">Document Reviewed</SelectItem>
            </div>
            
            <div className="py-1 space-y-1">
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">Assessment Events</div>
              <SelectItem value="assessment_assigned">Assessment Assigned</SelectItem>
              <SelectItem value="assessment_completed">Assessment Completed</SelectItem>
              <SelectItem value="assessment_overdue">Assessment Overdue</SelectItem>
            </div>
            
            <div className="py-1 space-y-1">
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">Billing Events</div>
              <SelectItem value="payment_overdue">Payment Overdue</SelectItem>
              <SelectItem value="billing_generated">Billing Record Generated</SelectItem>
            </div>
            
            <div className="py-1 space-y-1">
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">System Events</div>
              <SelectItem value="user_login_failed">Failed Login Attempt</SelectItem>
              <SelectItem value="system_backup">System Backup Completed</SelectItem>
            </div>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="templateId">Notification Template</Label>
        <Select value={formData.templateId} onValueChange={(value) => setFormData({ ...formData, templateId: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Select template" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id.toString()}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>When should this trigger activate?</Label>
        <div className="mt-2">
          <Button 
            type="button"
            variant={showAdvanced ? "outline" : "default"}
            size="sm"
            onClick={() => {
              setShowAdvanced(false);
              updateConditions();
            }}
          >
            Simple Setup
          </Button>
          <Button 
            type="button"
            variant={showAdvanced ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAdvanced(true)}
            className="ml-2"
          >
            Advanced Setup
          </Button>
        </div>

        {!showAdvanced ? (
          // Simple condition builder
          <div className="mt-4 space-y-3 p-4 border rounded-lg bg-gray-50">
            <p className="text-sm font-medium text-gray-700">Set conditions (leave blank for all events):</p>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Priority Level</Label>
                <Select value={simpleConditions.priority} onValueChange={(value) => setSimpleConditions(prev => ({ ...prev, priority: value }))}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Any priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any priority</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Status/Stage</Label>
                <Select value={simpleConditions.status} onValueChange={(value) => setSimpleConditions(prev => ({ ...prev, status: value }))}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Any status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="pending_review">Pending Review</SelectItem>
                    <SelectItem value="needs_approval">Needs Approval</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Client Type</Label>
                <Select value={simpleConditions.clientType} onValueChange={(value) => setSimpleConditions(prev => ({ ...prev, clientType: value }))}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Any client type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any client type</SelectItem>
                    <SelectItem value="new">New clients</SelectItem>
                    <SelectItem value="existing">Existing clients</SelectItem>
                    <SelectItem value="vip">VIP clients</SelectItem>
                    <SelectItem value="intake">Intake phase</SelectItem>
                    <SelectItem value="ongoing">Ongoing therapy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Specific Therapist ID</Label>
                <Input 
                  value={simpleConditions.therapistId}
                  onChange={(e) => setSimpleConditions(prev => ({ ...prev, therapistId: e.target.value }))}
                  placeholder="Leave blank for all"
                  className="h-8"
                />
              </div>
            </div>
            
            <div className="mt-3 p-3 bg-blue-50 rounded border-l-4 border-blue-400">
              <p className="text-sm font-medium text-blue-800 mb-2">Common Notification Scenarios:</p>
              <div className="text-xs text-blue-700 space-y-1">
                <p><strong>New client assignment:</strong> Event = "Client Assigned to Therapist"</p>
                <p><strong>Document review needed:</strong> Event = "Document Needs Supervisor Review"</p>
                <p><strong>Task overdue:</strong> Event = "Task Overdue", Priority = "High"</p>
                <p><strong>Payment issues:</strong> Event = "Payment Overdue"</p>
                <p><strong>Assessment completion:</strong> Event = "Assessment Completed"</p>
              </div>
            </div>
            
            <div className="text-xs text-gray-600 mt-2">
              <strong>How it works:</strong> The notification will only be sent when ALL selected conditions match. 
              Leave fields blank to ignore that condition.
            </div>
          </div>
        ) : (
          // Advanced JSON editor
          <div className="mt-4">
            <Label htmlFor="conditions">Advanced Conditions (JSON)</Label>
            <Textarea
              id="conditions"
              value={formData.conditions}
              onChange={(e) => setFormData({ ...formData, conditions: e.target.value })}
              placeholder='{"priority": "high", "clientType": "new"}'
              className="font-mono text-sm mt-2"
              rows={4}
            />
            <p className="text-xs text-gray-500 mt-1">
              Advanced users can write custom JSON conditions here
            </p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {trigger ? "Update Trigger" : "Create Trigger"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create Template Form Component
interface CreateTemplateFormProps {
  onSubmit: (data: any) => void;
  isLoading: boolean;
  template?: NotificationTemplate;
}

// Create Trigger Form Component - support editing
interface CreateTriggerFormProps {
  onSubmit: (data: any) => void;
  isLoading: boolean;
  templates: NotificationTemplate[];
  trigger?: NotificationTrigger;
}

function CreateTemplateForm({ onSubmit, isLoading, template }: CreateTemplateFormProps) {
  const [formData, setFormData] = useState({
    name: template?.name || "",
    subject: template?.subject || "",
    message: template?.bodyTemplate || template?.body_template || template?.message || "",
    type: template?.type || "system",
    priority: template?.priority || "medium"
  });

  // Update form data when template changes (for editing)
  useEffect(() => {
    if (template) {
      // Template data loaded successfully
      setFormData({
        name: template.name || "",
        subject: template.subject || "",
        message: template.bodyTemplate || template.body_template || template.message || "",
        type: template.type || "system",
        priority: template.priority || "medium"
      });
    } else {
      // Reset form for new template
      setFormData({
        name: "",
        subject: "",
        message: "",
        type: "system",
        priority: "medium"
      });
    }
  }, [template]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Map message to bodyTemplate for API
    const submitData = {
      ...formData,
      bodyTemplate: formData.message
    };
    onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="template-name">Template Name</Label>
        <Input
          id="template-name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter template name"
          required
        />
      </div>

      <div>
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          value={formData.subject}
          onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
          placeholder="Notification subject"
          required
        />
      </div>

      <div>
        <Label htmlFor="message">Message</Label>
        <Textarea
          id="message"
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          placeholder="Notification message content"
          required
        />
      </div>

      <div>
        <Label htmlFor="priority">Priority</Label>
        <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Select priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {template ? "Update Template" : "Create Template"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function NotificationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [activeTab, setActiveTab] = useState("notifications");
  const [isCreateTriggerOpen, setIsCreateTriggerOpen] = useState(false);
  const [isCreateTemplateOpen, setIsCreateTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [editingTrigger, setEditingTrigger] = useState<NotificationTrigger | null>(null);
  const [deletingTrigger, setDeletingTrigger] = useState<NotificationTrigger | null>(null);

  // Fetch notifications
  const { data: notifications = [], isLoading: notificationsLoading } = useQuery({
    queryKey: ["/api/notifications"],
    queryFn: () => fetch("/api/notifications?limit=100").then(res => res.json()).then(data => Array.isArray(data) ? data : []),
  });

  // Fetch triggers
  const { data: triggers = [], isLoading: triggersLoading, error: triggersError } = useQuery({
    queryKey: ["/api/notifications/triggers"],
    queryFn: () => fetch("/api/notifications/triggers", {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    }).then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json();
    }).then(data => Array.isArray(data) ? data : []),
    retry: 1
  });

  // Fetch templates
  const { data: templates = [], isLoading: templatesLoading, error: templatesError } = useQuery({
    queryKey: ["/api/notifications/templates"],
    queryFn: () => fetch("/api/notifications/templates", {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    }).then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json();
    }).then(data => Array.isArray(data) ? data : []),
    retry: 1
  });

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: number) => 
      apiRequest(`/api/notifications/${notificationId}/read`, "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Notification marked as read" });
    },
  });

  // Delete notification
  const deleteNotificationMutation = useMutation({
    mutationFn: (notificationId: number) => 
      apiRequest(`/api/notifications/${notificationId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Notification deleted" });
    },
  });

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: () => apiRequest("/api/notifications/mark-all-read", "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  // Toggle trigger active status
  const toggleTriggerMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => 
      apiRequest(`/api/notifications/triggers/${id}`, "PUT", { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/triggers"] });
      toast({ title: "Trigger updated" });
    },
  });

  // Create trigger mutation
  const createTriggerMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/notifications/triggers", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/triggers"] });
      setIsCreateTriggerOpen(false);
      toast({ title: "Trigger created successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error creating trigger", 
        description: error.message || "Failed to create trigger",
        variant: "destructive" 
      });
    }
  });

  // Create template mutation
  const createTemplateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/notifications/templates", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/templates"] });
      setIsCreateTemplateOpen(false);
      toast({ title: "Template created successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error creating template", 
        description: error.message || "Failed to create template",
        variant: "destructive" 
      });
    }
  });

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/notifications/templates/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/templates"] });
      setEditingTemplate(null);
      toast({ title: "Template updated successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error updating template", 
        description: error.message || "Failed to update template",
        variant: "destructive" 
      });
    }
  });

  // Update trigger mutation
  const updateTriggerMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/notifications/triggers/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/triggers"] });
      setEditingTrigger(null);
      toast({ title: "Trigger updated successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error updating trigger", 
        description: error.message || "Failed to update trigger",
        variant: "destructive" 
      });
    },
  });

  // Delete trigger mutation
  const deleteTriggerMutation = useMutation({
    mutationFn: (id: number) => 
      apiRequest(`/api/notifications/triggers/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/triggers"] });
      setDeletingTrigger(null);
      toast({ title: "Trigger deleted successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error deleting trigger", 
        description: error.message || "Failed to delete trigger",
        variant: "destructive" 
      });
    },
  });

  // Helper functions
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'client_created': return <User className="h-4 w-4" />;
      case 'client_updated': return <User className="h-4 w-4" />;
      case 'session_created': return <Calendar className="h-4 w-4" />;
      case 'session_updated': return <Calendar className="h-4 w-4" />;
      case 'task_assigned': return <ClipboardList className="h-4 w-4" />;
      case 'task_completed': return <CheckCircle className="h-4 w-4" />;
      case 'overdue_session': return <AlertTriangle className="h-4 w-4" />;
      default: return <Bell className="h-4 w-4" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleActionClick = (notification: Notification) => {
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl;
    }
  };

  // Filter notifications
  const filteredNotifications = notifications.filter(notification => {
    const matchesSearch = notification.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         notification.message.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || 
                         (filterStatus === 'unread' && !notification.isRead) ||
                         (filterStatus === 'read' && notification.isRead);
    return matchesSearch && matchesStatus;
  });

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Notification Center
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Manage notifications, triggers, and templates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            {unreadCount} unread
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search notifications..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="all">All</option>
                <option value="unread">Unread</option>
                <option value="read">Read</option>
              </select>
              <Button 
                onClick={() => markAllAsReadMutation.mutate()}
                disabled={markAllAsReadMutation.isPending || unreadCount === 0}
                variant="outline"
                size="sm"
              >
                {markAllAsReadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Mark All Read
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Recent Notifications
              </CardTitle>
            </CardHeader>
            <CardContent>
              {notificationsLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Loading notifications...</span>
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="text-center p-8">
                  <Bell className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-gray-600 dark:text-gray-300">
                    {searchTerm || filterStatus !== 'all' ? 'No notifications match your criteria' : 'No notifications yet'}
                  </p>
                  {!searchTerm && filterStatus === 'all' && (
                    <p className="text-sm text-gray-400 mt-2">
                      Notifications will appear here when clients are created, tasks assigned, or sessions updated
                    </p>
                  )}
                </div>
              ) : (
                <ScrollArea className="h-[600px]">
                  <div className="space-y-4">
                    {filteredNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={cn(
                          "p-4 border rounded-lg transition-colors hover:bg-gray-50 dark:hover:bg-gray-800",
                          !notification.isRead && "bg-blue-50/50 dark:bg-blue-900/10 border-blue-200"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "p-2 rounded-full flex-shrink-0 mt-0.5",
                            !notification.isRead ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          )}>
                            {getNotificationIcon(notification.type)}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className={cn(
                                "text-sm font-medium",
                                !notification.isRead ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"
                              )}>
                                {notification.title}
                              </h4>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Badge 
                                  variant="outline"
                                  className={cn("text-xs", getPriorityColor(notification.priority))}
                                >
                                  {notification.priority}
                                </Badge>
                                {!notification.isRead && (
                                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                )}
                              </div>
                            </div>
                            
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                              {notification.message}
                            </p>
                            
                            <div className="flex items-center justify-between mt-3">
                              <span className="text-xs text-gray-400">
                                {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                              </span>
                              
                              <div className="flex items-center gap-1">
                                {notification.actionUrl && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleActionClick(notification)}
                                    className="text-xs h-7 px-2"
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
                                    className="text-xs h-7 px-2"
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
                                  className="text-xs h-7 px-2 text-red-600 hover:text-red-700"
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
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Triggers Tab */}
        <TabsContent value="triggers" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Notification Triggers
                </CardTitle>
                <Dialog open={isCreateTriggerOpen} onOpenChange={setIsCreateTriggerOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Add Trigger
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Create Notification Trigger</DialogTitle>
                      <DialogDescription>
                        Add a new trigger to automatically create notifications based on system events.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[70vh] overflow-y-auto">
                      <CreateTriggerForm 
                        onSubmit={(data) => createTriggerMutation.mutate(data)}
                        isLoading={createTriggerMutation.isPending}
                        templates={templates}
                      />
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {triggersLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Loading triggers...</span>
                </div>
              ) : triggers.length === 0 ? (
                <div className="text-center p-8">
                  <Settings className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-gray-600 dark:text-gray-300">No notification triggers configured</p>
                  <p className="text-sm text-gray-400 mt-2">
                    Add triggers to automatically create notifications based on system events
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {triggers.map((trigger) => (
                    <div
                      key={trigger.id}
                      className="p-4 border rounded-lg flex items-center justify-between"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{trigger.name}</h4>
                          <Badge variant={trigger.isActive ? "default" : "secondary"}>
                            {trigger.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                          Event: {trigger.event || trigger.eventType}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          Created {formatDistanceToNow(new Date(trigger.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingTrigger(trigger)}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleTriggerMutation.mutate({ 
                            id: trigger.id, 
                            isActive: !trigger.isActive 
                          })}
                          disabled={toggleTriggerMutation.isPending}
                        >
                          {trigger.isActive ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeletingTrigger(trigger)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Notification Templates
                </CardTitle>
                <Dialog open={isCreateTemplateOpen} onOpenChange={setIsCreateTemplateOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Add Template
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Create Notification Template</DialogTitle>
                      <DialogDescription>
                        Create a reusable template for notifications.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[70vh] overflow-y-auto">
                      <CreateTemplateForm 
                        onSubmit={(data: any) => createTemplateMutation.mutate(data)}
                        isLoading={createTemplateMutation.isPending}
                      />
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {templatesLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Loading templates...</span>
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center p-8">
                  <ClipboardList className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-gray-600 dark:text-gray-300">No notification templates configured</p>
                  <p className="text-sm text-gray-400 mt-2">
                    Create templates to standardize notification messages
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="p-4 border rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">{template.name}</h4>
                        <div className="flex items-center gap-2">
                          {template.priority && (
                            <Badge variant="outline" className={getPriorityColor(template.priority)}>
                              {template.priority}
                            </Badge>
                          )}
                          <Badge variant="secondary">
                            {template.type}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingTemplate(template)}
                          >
                            Edit
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {template.subject}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                        {template.bodyTemplate || template.body_template || template.message || 'No message content'}
                      </p>
                      <p className="text-xs text-gray-400 mt-2">
                        Created {formatDistanceToNow(new Date(template.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      {/* Edit Template Dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Notification Template</DialogTitle>
            <DialogDescription>
              Modify the notification template details.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            {editingTemplate && (
              <CreateTemplateForm 
                template={editingTemplate}
                onSubmit={(data: any) => updateTemplateMutation.mutate({ id: editingTemplate.id, data })}
                isLoading={updateTemplateMutation.isPending}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Trigger Dialog */}
      <Dialog open={!!editingTrigger} onOpenChange={(open) => !open && setEditingTrigger(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Notification Trigger</DialogTitle>
            <DialogDescription>
              Modify the notification trigger settings.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            {editingTrigger && (
              <CreateTriggerForm 
                trigger={editingTrigger}
                onSubmit={(data: any) => updateTriggerMutation.mutate({ id: editingTrigger.id, data })}
                isLoading={updateTriggerMutation.isPending}
                templates={templates}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Trigger Confirmation */}
      <Dialog open={!!deletingTrigger} onOpenChange={(open) => !open && setDeletingTrigger(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Notification Trigger</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this trigger? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deletingTrigger && (
            <div className="py-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <strong>Trigger:</strong> {deletingTrigger.name}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                <strong>Event:</strong> {deletingTrigger.event}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setDeletingTrigger(null)}
              disabled={deleteTriggerMutation.isPending}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => deleteTriggerMutation.mutate(deletingTrigger?.id!)}
              disabled={deleteTriggerMutation.isPending}
            >
              {deleteTriggerMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete Trigger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}