import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatTime, generateTimeSlots } from "@/lib/datetime";

// UI Components
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

// Icons
import { 
  AlertCircle,
  ArrowLeft, 
  Calendar,
  CalendarDays, 
  CheckCircle,
  CheckSquare, 
  ChevronDown,
  Clock,
  ClipboardList, 
  CreditCard, 
  Download, 
  Edit, 
  Eye,
  ExternalLink,
  FileText, 
  FolderOpen, 
  Home,
  Mail,
  MapPin,
  MoreVertical,
  Phone,
  Plus, 
  Printer,
  RotateCw,
  Search, 
  Trash2,
  Upload, 
  User as UserIcon, 
  Video,
  X
} from "lucide-react";

// Utils and Hooks
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useRecentItems } from "@/hooks/useRecentItems";
import { useRealTimeConflictCheck } from "@/hooks/useConflictDetection";
import { getClientStageColor } from "@/lib/task-utils";

// Types

// Practice Header Component for Invoice Preview
const PracticeHeader = () => {
  const { data: practiceSettings } = useQuery({
    queryKey: ['/api/system-options/categories/practice_settings'],
    queryFn: async () => {
      // Try to find practice_settings category by key
      const categoriesResponse = await fetch("/api/system-options/categories");
      const categoriesData = await categoriesResponse.json();
      const practiceCategory = categoriesData.find((cat: any) => cat.categoryKey === 'practice_settings');
      
      if (!practiceCategory) {
        return {
          options: []
        };
      }
      
      const response = await fetch(`/api/system-options/categories/${practiceCategory.id}`);
      return await response.json();
    },
  });

  const options = practiceSettings?.options || [];
  const practiceName = options.find((o: any) => o.optionKey === 'practice_name')?.optionLabel || "";
  const practiceDescription = options.find((o: any) => o.optionKey === 'practice_description')?.optionLabel || "";
  const practiceSubtitle = options.find((o: any) => o.optionKey === 'practice_subtitle')?.optionLabel || "";
  const practiceAddress = options.find((o: any) => o.optionKey === 'practice_address')?.optionLabel || "";
  const practicePhone = options.find((o: any) => o.optionKey === 'practice_phone')?.optionLabel || "";
  const practiceEmail = options.find((o: any) => o.optionKey === 'practice_email')?.optionLabel || "";
  const practiceWebsite = options.find((o: any) => o.optionKey === 'practice_website')?.optionLabel || "";

  return (
    <>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{practiceName}</h3>
      <div className="mt-2 text-sm text-slate-600">
        <p className="whitespace-pre-line">{practiceAddress}</p>
        <p>Phone: {practicePhone}</p>
        <p>Email: {practiceEmail}</p>
        <p>Website: {practiceWebsite}</p>
      </div>
    </>
  );
};

import type { Client, Task, Document, User, Session } from "@shared/schema";

// Utility function to parse UTC date strings without timezone shift
const parseSessionDate = (dateString: string): Date => {
  // If date is already in YYYY-MM-DD format, add time to avoid timezone issues
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(dateString + 'T12:00:00');
  }
  // Handle ISO strings properly - keep the original time but ensure consistent parsing
  if (dateString.includes('T')) {
    return new Date(dateString);
  }
  // Fallback for other formats
  return new Date(dateString);
};

// Define types for checklists and assessments to fix 'unknown' type errors
interface ChecklistTemplate {
  id: number;
  name: string;
  category: string;
  description?: string;
  items?: ChecklistItem[];
}

interface ChecklistItem {
  id: number;
  title: string;
  description?: string;
  isRequired: boolean;
  sortOrder: number;
}

interface ClientChecklist {
  id: number;
  clientId: number;
  templateId: number;
  template: ChecklistTemplate;
  isCompleted: boolean;
  completedAt?: string;
  dueDate?: string;
  notes?: string;
}

interface ClientChecklistItem {
  id: number;
  clientChecklistId: number;
  checklistItemId: number;
  isCompleted: boolean;
  completedAt?: string;
  notes?: string;
  templateItem: ChecklistItem;
}

interface AssessmentAssignment {
  id: number;
  clientId: number;
  templateId: number;
  assignedDate: string;
  completedDate?: string;
  status: string;
  template: {
    id: number;
    name: string;
    description?: string;
  };
}

// Components
import EditClientModal from "@/components/client-management/edit-client-modal";
import DeleteClientDialog from "@/components/client-management/delete-client-dialog";
import SessionNotesManager from "@/components/session-notes/session-notes-manager";
import QuickTaskForm from "@/components/task-management/quick-task-form";
import ProcessChecklistComponent from "@/components/checklist/process-checklist";
import EmailHistory from "@/components/communications/email-history";

// Client Checklists Display Component
function ClientChecklistsDisplay({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const { data: checklists = [], isLoading, refetch } = useQuery<ClientChecklist[]>({
    queryKey: [`/api/clients/${clientId}/checklists`],
  });

  // Add refresh button for testing
  const handleRefresh = () => {
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (checklists.length === 0) {
    return (
      <div className="text-center py-12">
        <ClipboardList className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-slate-900 mb-2">No Checklists Assigned</h3>
        <p className="text-slate-500 mb-6">Click "Assign Checklist Template" to select a process checklist for this client.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-slate-900">Assigned Checklists ({checklists.length})</h4>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          Refresh
        </Button>
      </div>
      {checklists.map((checklist: any) => (
        <div key={checklist.id} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h5 className="font-medium">
              {checklist.template ? checklist.template.name : `Template ${checklist.templateId}`}
            </h5>
            <Badge variant={checklist.isCompleted ? "default" : "secondary"}>
              {checklist.isCompleted ? "Completed" : "In Progress"}
            </Badge>
          </div>
          <div className="text-sm text-slate-600 space-y-1">
            {checklist.template && (
              <p className="text-blue-600 font-medium">
                Category: {checklist.template.category}
              </p>
            )}
            {checklist.template && checklist.template.description && (
              <p>{checklist.template.description}</p>
            )}
            <p>Assigned: {new Date(checklist.createdAt).toLocaleDateString()}</p>
            {checklist.dueDate && (
              <p>Due: {new Date(checklist.dueDate).toLocaleDateString()}</p>
            )}
          </div>
          
          <div className="mt-3 pt-3 border-t">
            <ChecklistItemsDisplay 
              clientChecklistId={checklist.id} 
              templateId={checklist.templateId}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Checklist Items Display Component
function ChecklistItemsDisplay({ clientChecklistId, templateId }: { clientChecklistId: number; templateId: number }) {
  const [showItems, setShowItems] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get template items
  const { data: templateItems = [] } = useQuery({
    queryKey: [`/api/checklist-items`, { templateId }],
    enabled: showItems,
  });

  // Get client checklist items
  const { data: clientItems = [] } = useQuery<ClientChecklistItem[]>({
    queryKey: [`/api/client-checklist-items/${clientChecklistId}`],
    enabled: showItems,
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, isCompleted, notes }: { itemId: number; isCompleted: boolean; notes?: string }) =>
      apiRequest(`/api/client-checklist-items/${itemId}`, "PUT", { isCompleted, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/client-checklist-items/${clientChecklistId}`] });
      toast({ title: "Item updated successfully" });
    },
  });

  const handleItemToggle = (itemId: number, isCompleted: boolean) => {
    updateItemMutation.mutate({ itemId, isCompleted });
  };

  if (!showItems) {
    return (
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => setShowItems(true)}
      >
        <CheckSquare className="w-4 h-4 mr-2" />
        View Items ({Array.isArray(templateItems) ? templateItems.length : 0})
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h6 className="font-medium text-sm">Checklist Items</h6>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setShowItems(false)}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      
      {clientItems
        .sort((a, b) => {
          // Sort by item order - respect the original sequence
          const orderA = a.templateItem?.sortOrder || 0;
          const orderB = b.templateItem?.sortOrder || 0;
          return orderA - orderB;
        })
        .map((clientItem) => {
        const templateItem = clientItem.templateItem;
        const isCompleted = clientItem.isCompleted || false;
        const itemId = clientItem.id;
        
        return (
          <div key={itemId} className="border rounded p-3 bg-slate-50">
            <div className="flex items-start space-x-3">
              <Checkbox
                checked={isCompleted}
                onCheckedChange={(checked) => {
                  handleItemToggle(itemId, checked as boolean);
                }}
              />
              <div className="flex-1">
                <div>
                  <h6 className="font-medium text-sm">{templateItem?.title || 'Unknown Item'}</h6>
                  {templateItem?.description && (
                    <p className="text-xs text-slate-600">{templateItem.description}</p>
                  )}
                  {templateItem?.isRequired && (
                    <Badge variant="destructive" className="text-xs">Required</Badge>
                  )}
                </div>

                {clientItem.completedAt && (
                  <p className="text-xs text-green-600 mt-2">
                    Completed: {new Date(clientItem.completedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Checklist Assignment Form Component  
function ChecklistAssignmentForm({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: templates = [] } = useQuery<ChecklistTemplate[]>({
    queryKey: ["/api/checklist-templates"],
  });

  const assignMutation = useMutation({
    mutationFn: (data: { templateId: number; dueDate?: string }) => 
      apiRequest(`/api/clients/${clientId}/checklists`, "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/checklists`] });
      toast({ title: "Checklist template assigned successfully" });
      onClose();
    },
    onError: () => {
      toast({ title: "Failed to assign checklist template", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (selectedTemplateId) {
      assignMutation.mutate({
        templateId: selectedTemplateId,
        dueDate: dueDate || undefined,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="template">Select Checklist Template</Label>
        <Select value={selectedTemplateId?.toString() || ""} onValueChange={(value) => setSelectedTemplateId(parseInt(value))}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a checklist template" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id.toString()}>
                {template.name} ({template.category})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      <div>
        <Label htmlFor="dueDate">Due Date (Optional)</Label>
        <Input
          id="dueDate"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button 
          onClick={handleSubmit} 
          disabled={!selectedTemplateId || assignMutation.isPending}
        >
          {assignMutation.isPending ? "Assigning..." : "Assign Checklist"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Docx File Viewer Component
function DocxFileViewer({ clientId, document }: { clientId: string; document: Document }) {
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDocxContent = async () => {
      try {
        const response = await fetch(`/api/clients/${clientId}/documents/${document.id}/docx-viewer`);
        if (!response.ok) {
          throw new Error('Failed to load document');
        }
        const data = await response.json();
        setHtmlContent(data.html);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchDocxContent();
  }, [clientId, document.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2">Loading document...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-600 p-4">
        <p>Error loading document: {error}</p>
        <Button 
          onClick={() => window.open(`/api/clients/${clientId}/documents/${document.id}/file`, '_blank')}
          className="mt-2"
        >
          Download Document
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <div className="mb-4 flex justify-between items-center">
        <h3 className="text-lg font-semibold">{document.fileName}</h3>
        <Button 
          onClick={() => window.open(`/api/clients/${clientId}/documents/${document.id}/file`, '_blank')}
          variant="outline"
          size="sm"
        >
          <Download className="w-4 h-4 mr-2" />
          Download
        </Button>
      </div>
      <div 
        className="prose max-w-none docx-content" 
        dangerouslySetInnerHTML={{ __html: htmlContent }}
        style={{
          lineHeight: '1.6',
          fontFamily: 'Times New Roman, serif',
          fontSize: '14px'
        }}
      />
    </div>
  );
}

// Text File Viewer Component
function TextFileViewer({ clientId, document }: { clientId: string; document: Document }) {
  const [textContent, setTextContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTextContent = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/clients/${clientId}/documents/${document.id}/preview`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        setTextContent(data.content || "No content available");
      } catch (err) {

        setError("Failed to load text file content");
      } finally {
        setLoading(false);
      }
    };

    fetchTextContent();
  }, [clientId, document.id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600 mb-4"></div>
        <p className="text-slate-600">Loading text content...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-red-600 mb-4">{error}</p>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => window.open(`/api/clients/${clientId}/documents/${document.id}/download`, '_blank')}
        >
          <Download className="w-4 h-4 mr-2" />
          Download File
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white border rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b">
          <div className="flex items-center space-x-3">
            <FileText className="w-6 h-6 text-blue-500" />
            <div>
              <h3 className="font-semibold text-slate-900">{document.fileName}</h3>
              <p className="text-sm text-slate-500">
                {Math.round(document.fileSize / 1024)} KB • Text Document
              </p>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.open(`/api/clients/${clientId}/documents/${document.id}/download`, '_blank')}
          >
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>
        </div>
        
        <div className="bg-slate-50 rounded-lg p-4 max-h-96 overflow-y-auto">
          <pre className="whitespace-pre-wrap text-sm font-mono text-slate-800 leading-relaxed">
            {textContent}
          </pre>
        </div>
      </div>
    </div>
  );
}

// Session form schema for editing
const sessionFormSchema = z.object({
  clientId: z.coerce.number().int().min(1, "Client is required"),
  therapistId: z.coerce.number().int().min(1, "Therapist is required"),
  sessionDate: z.string().min(1, "Date is required"),
  sessionTime: z.string().min(1, "Time is required"),
  serviceId: z.coerce.number().int().min(1, "Service is required"),
  roomId: z.coerce.number().int().min(1, "Room is required"),
  sessionType: z.enum(["assessment", "psychotherapy", "consultation"]),
  notes: z.string().optional(),
  zoomEnabled: z.boolean().optional().default(false),
});

type SessionFormData = z.infer<typeof sessionFormSchema>;

// Utility to convert local date/time to UTC
const localToUTC = (date: string, time: string): Date => {
  const localDateTime = new Date(`${date}T${time}:00`);
  return localDateTime;
};

// Get time slots with labels for display
const getTimeSlotsWithLabels = (intervalMinutes = 30): Array<{value: string, label: string}> => {
  const slots = generateTimeSlots(8, 18, intervalMinutes);
  return slots.map(time => ({
    value: time,
    label: formatTime(time)
  }));
};

export default function ClientDetailPage() {
  // Routing
  const [match, params] = useRoute("/clients/:id");
  const [, setLocation] = useLocation();
  const clientId = params?.id ? parseInt(params.id) : null;
  
  // Authentication
  const { user } = useAuth();
  
  // Recent items tracking
  const { addRecentClient } = useRecentItems();
  
  // Check URL parameters for tab selection and session highlighting
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab') || "overview";
  const sessionIdFromUrl = urlParams.get('sessionId');
  
  // State
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [documentForm, setDocumentForm] = useState({
    name: '',
    category: 'uploaded',
    description: ''
  });
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [preSelectedSessionId, setPreSelectedSessionId] = useState<number | null>(
    sessionIdFromUrl ? parseInt(sessionIdFromUrl) : null
  );
  const [preSelectedNoteId, setPreSelectedNoteId] = useState<number | null>(null);
  const [isInvoicePreviewOpen, setIsInvoicePreviewOpen] = useState(false);
  const [sessionStatusFilter, setSessionStatusFilter] = useState<string>("all");
  const [noteStatusFilter, setNoteStatusFilter] = useState<string>("all");
  const [selectedBillingRecord, setSelectedBillingRecord] = useState<any>(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [paymentBillingRecord, setPaymentBillingRecord] = useState<any>(null);
  const [paymentForm, setPaymentForm] = useState({
    status: 'paid',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    reference: '',
    method: 'cash',
    notes: ''
  });
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedChecklistId, setSelectedChecklistId] = useState<number | null>(null);
  const [showItemsDialog, setShowItemsDialog] = useState(false);
  const [isEditSessionModalOpen, setIsEditSessionModalOpen] = useState(false);
  const [selectedSessionForModal, setSelectedSessionForModal] = useState<Session | null>(null);
  const [isFullEditModalOpen, setIsFullEditModalOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [provisionalDuration, setProvisionalDuration] = useState<number>(60);
  const [userConfirmedConflicts, setUserConfirmedConflicts] = useState(false);
  const [isSessionNotesDialogOpen, setIsSessionNotesDialogOpen] = useState(false);

  // Session editing form
  const sessionForm = useForm<SessionFormData>({
    resolver: zodResolver(sessionFormSchema),
    defaultValues: {
      clientId: clientId || undefined,
      therapistId: undefined,
      sessionType: "psychotherapy",
      sessionDate: "",
      sessionTime: "",
      serviceId: undefined,
      roomId: undefined,
      notes: "",
      zoomEnabled: false,
    },
  });

  // Watch form fields for conflict detection
  const watchedDate = sessionForm.watch('sessionDate');
  const watchedTime = sessionForm.watch('sessionTime');
  const watchedTherapistId = sessionForm.watch('therapistId');
  const watchedRoomId = sessionForm.watch('roomId');
  const watchedServiceId = sessionForm.watch('serviceId');

  // React to URL parameter changes for dynamic navigation
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const newTab = urlParams.get('tab') || "overview";
    const newSessionId = urlParams.get('sessionId');
    
    // Update tab if different
    if (newTab !== activeTab) {
      setActiveTab(newTab);
    }
    
    // Update preselected session if different
    const newSessionIdNum = newSessionId ? parseInt(newSessionId) : null;
    if (newSessionIdNum !== preSelectedSessionId) {
      setPreSelectedSessionId(newSessionIdNum);
    }
  }, [window.location.search]); // React to URL search parameter changes

  // ==================== React Query Setup ====================
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ==================== API Mutations ====================
  
  // Session Status Update Mutation
  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: number; status: string }) => {
      return apiRequest(`/api/sessions/${sessionId}/status`, "PUT", { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/sessions`] });
      toast({
        title: "Success",
        description: "Session status updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update session status",
        variant: "destructive",
      });
    },
  });

  const updateSessionStatus = (sessionId: number, status: string) => {
    updateSessionMutation.mutate({ sessionId, status });
  };

  // Session Note PDF Handlers
  const handlePreviewNotePDF = async (noteId: number) => {
    try {
      const response = await fetch(`/api/session-notes/${noteId}/pdf`);
      if (!response.ok) throw new Error('Failed to generate PDF');
      
      const html = await response.text();
      const previewWindow = window.open('', '_blank');
      if (previewWindow) {
        previewWindow.document.write(html);
        previewWindow.document.close();
      }
    } catch (error) {
      toast({ 
        title: "Error generating PDF preview", 
        description: error instanceof Error ? error.message : "Failed to generate PDF",
        variant: "destructive" 
      });
    }
  };

  const handleDownloadNotePDF = async (noteId: number) => {
    try {
      const response = await fetch(`/api/session-notes/${noteId}/pdf`);
      if (!response.ok) throw new Error('Failed to generate PDF');
      
      const html = await response.text();
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => {
          printWindow.print();
        }, 250);
      }
    } catch (error) {
      toast({ 
        title: "Error downloading PDF", 
        description: error instanceof Error ? error.message : "Failed to download PDF",
        variant: "destructive" 
      });
    }
  };

  // ==================== Basic Event Handlers ====================
  
  const handleEditClient = () => setIsEditModalOpen(true);
  const handleDeleteClient = () => setIsDeleteDialogOpen(true);
  const handleDeleteSuccess = () => setLocation("/clients");
  const handleUploadDocument = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setDocumentForm({
      name: '',
      category: 'uploaded',
      description: ''
    });
    setIsUploadDialogOpen(true);
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    
    // Auto-populate document name with file name (without extension)
    const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");
    setDocumentForm(prev => ({
      ...prev,
      name: nameWithoutExtension
    }));
    
    // Generate preview URL for images
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const handleUploadSubmit = async () => {
    if (selectedFile && documentForm.name.trim()) {
      try {
        // Convert file to base64 for storage
        const fileContent = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result) {
              const base64 = (reader.result as string).split(',')[1]; // Remove data:mime;base64, prefix
              resolve(base64);
            } else {
              reject(new Error('Failed to read file'));
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(selectedFile);
        });

        uploadDocumentMutation.mutate({
          fileName: documentForm.name.trim(),
          originalName: selectedFile.name,
          fileType: selectedFile.type,
          fileSize: selectedFile.size,
          category: documentForm.category,
          description: documentForm.description.trim(),
          fileContent // Include actual file content
        });
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to read file. Please try again.",
          variant: "destructive"
        });
      }
    }
  };

  const handleUploadCancel = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setDocumentForm({
      name: '',
      category: 'uploaded',
      description: ''
    });
    setIsUploadDialogOpen(false);
  };

  const handlePreviewDocument = (doc: Document) => {
    // For PDFs, open directly in new tab instead of modal
    if (doc.mimeType === 'application/pdf') {
      window.open(`/api/clients/${clientId}/documents/${doc.id}/file`, '_blank');
    } else {
      setPreviewDocument(doc);
      setIsPreviewDialogOpen(true);
    }
  };

  const handleGenerateInvoice = async (action: 'download' | 'print' | 'email' | 'preview', billingId?: number) => {
    try {
      if (billingRecords.length === 0) {
        toast({
          title: "No billing records",
          description: "Complete a session to generate billing records first.",
          variant: "destructive",
        });
        return;
      }

      // For preview action, just set the selected billing record and open modal
      if (action === 'preview') {
        const record = billingRecords.find(r => r.id === billingId);
        if (record) {
          setSelectedBillingRecord(record);
          setIsInvoicePreviewOpen(true);
        }
        return;
      }

      const response = await apiRequest(`/api/clients/${clientId}/invoice`, 'POST', { action, billingId });

      if (action === 'download') {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${client?.clientId}-${billingId?.toString() || 'all'}-${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        toast({
          title: "Invoice downloaded",
          description: "Invoice has been downloaded successfully.",
        });
      } else if (action === 'print') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          const htmlContent = await response.text();
          printWindow.document.write(htmlContent);
          printWindow.document.close();
          printWindow.focus();
          printWindow.print();
        }
      } else if (action === 'email') {
        const result = await response.json();
        
        // Check if client has an email address
        if (!client?.email) {
          toast({
            title: "No email address",
            description: "Client doesn't have an email address. Please add one in their profile first.",
            variant: "destructive",
          });
          return;
        }
        
        toast({
          title: "Email sent successfully!",
          description: result.message || `Invoice has been sent to ${client.email}`,
        });
      }
    } catch (error: any) {
      console.error('Invoice generation error:', error);
      toast({
        title: "Invoice Error",
        description: error.message || "Failed to generate invoice. Please try again.",
        variant: "destructive",
      });
    }
  };

  const renderDocumentPreview = (doc: Document) => {
    if (!doc) return null;

    const isImage = doc.mimeType?.startsWith('image/');
    const isPDF = doc.mimeType === 'application/pdf';
    const isText = doc.mimeType?.startsWith('text/') || doc.mimeType === 'application/txt';

    if (isImage) {
      return (
        <div className="flex justify-center">
          <img 
            src={`/api/clients/${clientId}/documents/${doc.id}/preview`} 
            alt={doc.fileName}
            className="max-w-full max-h-96 object-contain rounded-lg"
          />
        </div>
      );
    }

    if (isPDF) {
      return (
        <div className="text-center py-8">
          <FileText className="w-16 h-16 mx-auto text-red-500 mb-4" />
          <p className="text-slate-600 mb-4">PDF Document</p>
          <p className="text-sm text-slate-500">
            File: {doc.fileName} ({Math.round(doc.fileSize / 1024)} KB)
          </p>
          <p className="text-sm text-slate-500 mt-2">
            PDF opens directly in new tab when clicking Preview
          </p>
        </div>
      );
    }

    if (isText) {
      return <TextFileViewer clientId={clientId?.toString() || ''} document={doc} />;
    }

    // Check if it's a Word document
    const isDocx = doc.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                   doc.fileName?.toLowerCase().endsWith('.docx') || 
                   doc.fileName?.toLowerCase().endsWith('.doc');
    if (isDocx) {
      return <DocxFileViewer clientId={clientId?.toString() || ''} document={doc} />;
    }

    return (
      <div className="text-center py-8">
        <FolderOpen className="w-16 h-16 mx-auto text-slate-400 mb-4" />
        <p className="text-slate-600 mb-4">File Preview</p>
        <p className="text-sm text-slate-500">
          File: {doc.fileName} ({Math.round(doc.fileSize / 1024)} KB)
        </p>
        <p className="text-sm text-slate-500 mt-2">
          Preview not available for this file type
        </p>
      </div>
    );
  };

  // Document delete mutation
  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: number) => {
      await apiRequest(`/api/clients/${clientId}/documents/${documentId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/documents`] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Success",
        description: "Document deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete document. Please try again.",
        variant: "destructive"
      });
    }
  });

  const handleDeleteDocument = (doc: Document) => {
    if (window.confirm(`Are you sure you want to delete "${doc.fileName}"? This action cannot be undone.`)) {
      deleteDocumentMutation.mutate(doc.id);
    }
  };

  // Document upload mutation
  const uploadDocumentMutation = useMutation({
    mutationFn: async (data: { 
      fileName: string; 
      originalName: string; 
      fileType: string; 
      fileSize: number; 
      category: string; 
      description?: string;
      fileContent?: string;
    }) => {
      const response = await apiRequest(`/api/clients/${clientId}/documents`, "POST", {
        fileName: data.fileName,
        originalName: data.originalName,
        mimeType: data.fileType,
        fileSize: data.fileSize,
        category: data.category,
        fileContent: data.fileContent // Include file content for server storage
      });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/documents`] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });
      handleUploadCancel();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to upload document: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    }
  });

  // Payment update mutation
  const updatePaymentStatusMutation = useMutation({
    mutationFn: async ({ billingId, paymentData }: { billingId: number; paymentData: any }) => {
      const response = await apiRequest(`/api/billing/${billingId}/payment`, 'PUT', paymentData);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/billing`] });
      toast({
        title: "Payment recorded",
        description: "Payment details have been updated successfully.",
      });
      setIsPaymentDialogOpen(false);
      setPaymentBillingRecord(null);
      setPaymentForm({
        status: 'paid',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        reference: '',
        method: 'cash',
        notes: ''
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update payment details. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleRecordPayment = (billing: any) => {
    setPaymentBillingRecord(billing);
    setPaymentForm({
      status: 'paid',
      amount: billing.totalAmount || billing.amount || '',
      date: new Date().toISOString().split('T')[0],
      reference: '',
      method: 'cash',
      notes: ''
    });
    setIsPaymentDialogOpen(true);
  };

  const handlePaymentSubmit = () => {
    if (paymentBillingRecord && paymentForm.amount && paymentForm.date) {
      updatePaymentStatusMutation.mutate({
        billingId: paymentBillingRecord.id,
        paymentData: {
          status: paymentForm.status,
          amount: parseFloat(paymentForm.amount),
          date: paymentForm.date,
          reference: paymentForm.reference || null,
          method: paymentForm.method,
          notes: paymentForm.notes || null
        }
      });
    } else {
      toast({
        title: "Missing Information",
        description: "Please fill in the payment amount and date.",
        variant: "destructive",
      });
    }
  };

  // ==================== Assessment Management ====================
  
  // Assessment assign mutation
  const assignAssessmentMutation = useMutation({
    mutationFn: async (templateId: number) => {
      return await apiRequest(`/api/clients/${clientId}/assessments`, "POST", {
        templateId,
        assignedDate: new Date().toISOString(),
        assignedBy: 17, // Use valid therapist ID - Abi Cherian
        status: 'pending'
      });
    },
    onSuccess: () => {
      // Invalidate and refetch assessment data immediately
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/assessments`] });
      queryClient.refetchQueries({ queryKey: [`/api/clients/${clientId}/assessments`] });
      
      toast({
        title: "Assessment assigned",
        description: "Assessment template has been assigned to client successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign assessment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleAssignAssessment = (templateId: number) => {
    assignAssessmentMutation.mutate(templateId);
  };

  const handleCompleteAssessment = (assessmentId: number) => {
    // Navigate to assessment completion page
    window.location.href = `/assessments/${assessmentId}/complete`;
  };

  const handleViewAssessmentReport = (assessmentId: number) => {
    // Navigate to assessment report page
    window.location.href = `/assessments/${assessmentId}/report`;
  };

  // Delete assessment mutation
  const deleteAssessmentMutation = useMutation({
    mutationFn: async (assessmentId: number) => {
      return await apiRequest(`/api/assessments/assignments/${assessmentId}`, "DELETE");
    },
    onSuccess: () => {
      // Invalidate and refetch assessment data immediately
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/assessments`] });
      queryClient.refetchQueries({ queryKey: [`/api/clients/${clientId}/assessments`] });
      
      toast({
        title: "Assessment deleted",
        description: "Assessment assignment has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete assessment",
        variant: "destructive",
      });
    },
  });

  const handleDeleteAssessment = (assessmentId: number) => {
    if (window.confirm("Are you sure you want to delete this assessment assignment? This action cannot be undone.")) {
      deleteAssessmentMutation.mutate(assessmentId);
    }
  };

  // ==================== Component Event Handlers ====================

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: [`/api/clients/${clientId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  // Track client viewing for recent items
  useEffect(() => {
    if (client && !isLoading) {
      addRecentClient({
        id: client.id,
        fullName: client.fullName,
        stage: client.stage || 'active',
      });
    }
  }, [client?.id, isLoading]); // Remove addRecentClient from dependencies to prevent infinite loop

  // Access Control - Redirect if user doesn't have access to this client
  useEffect(() => {
    if (client && user?.role === 'therapist' && user.id !== client.assignedTherapistId) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to view this client profile.",
        variant: "destructive",
      });
      setLocation("/clients");
    }
  }, [client, user, setLocation, toast]);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: [`/api/clients/${clientId}/sessions`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  // Session Notes query (for inline note management in Session History)
  const { data: sessionNotes = [] } = useQuery<any[]>({
    queryKey: [`/api/clients/${clientId}/session-notes`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  // Helper function to find note for a session
  const getSessionNote = (sessionId: number) => {
    return sessionNotes.find((note: any) => note.sessionId === sessionId);
  };

  // Session conflicts query
  const { data: sessionConflicts } = useQuery<{
    conflictDates: string[];
    conflicts: Array<{
      date: string;
      sessions: any[];
      type: 'same_service' | 'different_service';
    }>;
  }>({
    queryKey: [`/api/clients/${clientId}/session-conflicts`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: notes = [] } = useQuery<any[]>({
    queryKey: [`/api/clients/${clientId}/notes`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: [`/api/clients/${clientId}/tasks`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: [`/api/clients/${clientId}/documents`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: billingRecords = [] } = useQuery<any[]>({
    queryKey: [`/api/clients/${clientId}/billing`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  // Assessment queries
  const { data: availableTemplates = [] } = useQuery({
    queryKey: ['/api/assessments/templates'],
    queryFn: getQueryFn({ on401: "throw" }),
    select: (data: any[]) => data.map(template => ({
      ...template,
      title: template.name || template.title, // Map name to title for consistency
      sectionCount: template.sectionsCount || template.sectionCount || 0,
      questionCount: template.questionCount || 0
    }))
  });

  // Query for available checklist templates
  const { data: checklistTemplates = [] } = useQuery<ChecklistTemplate[]>({
    queryKey: ['/api/checklist-templates'],
    queryFn: getQueryFn({ on401: "throw" })
  });

  const { data: assignedAssessments = [] } = useQuery<AssessmentAssignment[]>({
    queryKey: [`/api/clients/${clientId}/assessments`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  // Queries for session editing
  const { data: therapists = [] } = useQuery<User[]>({
    queryKey: ["/api/therapists"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: services = [] } = useQuery<any[]>({
    queryKey: ["/api/services", { currentUserRole: user?.role }],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: rooms = [] } = useQuery<any[]>({
    queryKey: ["/api/rooms"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Get service duration for conflict detection
  const selectedService = services.find(s => s.id === watchedServiceId);
  const serviceDuration = selectedService?.duration;

  // Real-time conflict detection - only enabled when service + day + room selected
  const { data: conflictData, isLoading: isCheckingConflicts } = useRealTimeConflictCheck(
    watchedTherapistId,
    watchedDate,
    watchedTime,
    editingSessionId || undefined,
    watchedRoomId,
    serviceDuration
  );

  // Session update mutation
  const updateFullSessionMutation = useMutation({
    mutationFn: (data: SessionFormData) => {
      const utcDateTime = localToUTC(data.sessionDate, data.sessionTime);
      const sessionData = {
        ...data,
        sessionDate: utcDateTime.toISOString(),
        ignoreConflicts: userConfirmedConflicts, // Only ignore conflicts if user explicitly confirmed
      };
      return apiRequest(`/api/sessions/${editingSessionId}`, "PUT", sessionData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/sessions`] });
      toast({
        title: "Success",
        description: "Session updated successfully",
      });
      setIsFullEditModalOpen(false);
      setEditingSessionId(null);
      setUserConfirmedConflicts(false);
      sessionForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update session",
        variant: "destructive",
      });
    },
  });

  // Handle session form submission with conflict check
  const handleSessionSubmit = (data: SessionFormData) => {
    // Check for conflicts before submitting
    if (conflictData?.hasConflict && !userConfirmedConflicts) {
      toast({
        title: "Scheduling Conflict Detected",
        description: "Please review the conflicts and confirm to proceed.",
        variant: "destructive",
      });
      return;
    }
    updateFullSessionMutation.mutate(data);
  };

  // Generate available time slots for specific room
  const generateAvailableTimeSlotsForSpecificRoom = (
    selectedDate: string, 
    serviceDuration: number,
    therapistId: number, 
    roomId: number,
    fallbackDuration?: number
  ): Array<{time: string, isAvailable: boolean}> => {
    const effectiveDuration = provisionalDuration || serviceDuration || fallbackDuration || 60;
    
    if (!selectedDate || !therapistId || !roomId || !effectiveDuration || effectiveDuration <= 0) return [];
    if (typeof roomId !== 'number' || typeof therapistId !== 'number') return [];
    if (!rooms || rooms.length === 0) return [];
    
    const results: Array<{ time: string, isAvailable: boolean }> = [];
    const timeSlots = generateTimeSlots(8, 18, effectiveDuration);
    
    const allSessionsData = sessions || [];
    const targetDate = new Date(selectedDate + 'T12:00:00');
    
    const daySessionsForRoom = allSessionsData.filter(s => {
      const dt = new Date(s.sessionDate);
      return dt.toDateString() === targetDate.toDateString() && s.roomId === roomId;
    });
    
    for (const timeSlot of timeSlots) {
      const slotStart = new Date(`${selectedDate}T${timeSlot}:00`);
      const slotEnd = new Date(slotStart.getTime() + effectiveDuration * 60000);
      
      const businessEnd = new Date(`${selectedDate}T18:00:00`);
      if (slotEnd > businessEnd) continue;

      const roomBusy = daySessionsForRoom.some(s => {
        const sStart = new Date(s.sessionDate).getTime();
        const sEnd = sStart + (((s.service as any)?.duration || 60) * 60000);
        return slotStart.getTime() < sEnd && slotEnd.getTime() > sStart;
      });

      results.push({ time: timeSlot, isAvailable: !roomBusy });
    }
    
    return results;
  };

  // Checklist assignment mutation
  const assignChecklistMutation = useMutation({
    mutationFn: async (templateId: number) => {
      return apiRequest(`/api/clients/${clientId}/checklists`, "POST", { 
        templateId,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
      });
    },
    onSuccess: (_, templateId) => {
      const template = (checklistTemplates as ChecklistTemplate[]).find((t: ChecklistTemplate) => t.id === templateId);
      setShowAssignDialog(false);
      toast({ 
        title: "Checklist assigned successfully",
        description: `${template?.name} has been assigned to the client.`
      });
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/checklists`] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign checklist",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading client details...</p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Client Not Found</h2>
          <p className="text-slate-600 mb-4">The requested client could not be found.</p>
          <Button onClick={() => window.history.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  // Use shared utility functions
  const getStageColor = getClientStageColor;

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center space-x-2 text-sm">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => setLocation("/clients")}
          className="flex items-center space-x-1 h-8 px-2"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>Back to Clients</span>
        </Button>
      </div>

      {/* Main Content */}
      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-10">
            <TabsTrigger value="overview" className="flex items-center space-x-2">
              <UserIcon className="w-4 h-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="sessions" className="flex items-center space-x-2">
              <Calendar className="w-4 h-4" />
              <span>Sessions</span>
            </TabsTrigger>

            <TabsTrigger value="assessments" className="flex items-center space-x-2">
              <ClipboardList className="w-4 h-4" />
              <span>Assessments</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center space-x-2">
              <FolderOpen className="w-4 h-4" />
              <span>Documents</span>
            </TabsTrigger>
            <TabsTrigger value="billing" className="flex items-center space-x-2">
              <CreditCard className="w-4 h-4" />
              <span>Billing</span>
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex items-center space-x-2">
              <CheckSquare className="w-4 h-4" />
              <span>Tasks</span>
            </TabsTrigger>
            <TabsTrigger value="checklist" className="flex items-center space-x-2">
              <ClipboardList className="w-4 h-4" />
              <span>Checklists</span>
            </TabsTrigger>
            <TabsTrigger value="communications" className="flex items-center space-x-2" data-testid="tab-communications">
              <Mail className="w-4 h-4" />
              <span>Communications</span>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-8">
            {/* Client Summary Header */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="bg-blue-100 p-3 rounded-full">
                    <UserIcon className="w-8 h-8 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">{client.fullName}</h2>
                    <p className="text-slate-600 flex items-center space-x-4">
                      <span>ID: {client.clientId}</span>
                      {client.dateOfBirth && (
                        <span>• Age: {Math.floor((new Date().getTime() - new Date(client.dateOfBirth).getTime()) / (1000 * 3600 * 24 * 365))}</span>
                      )}
                      {client.clientType && (
                        <span>• {client.clientType.charAt(0).toUpperCase() + client.clientType.slice(1)} Client</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Badge className={`${getStageColor(client.stage || 'intake')} px-3 py-1 text-sm font-medium`}>
                    {client.stage ? client.stage.charAt(0).toUpperCase() + client.stage.slice(1) : 'Intake'}
                  </Badge>
                  <Button onClick={handleEditClient} variant="outline" size="sm">
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDeleteClient} className="border-red-200 text-red-600 hover:bg-red-50">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>

            {/* Main Information Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Contact Information Card */}
              <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="bg-slate-50 rounded-t-lg">
                  <CardTitle className="flex items-center space-x-2 text-lg">
                    <Phone className="w-5 h-5 text-blue-600" />
                    <span>Contact Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {client.phone && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <div className="flex items-center space-x-3">
                        <Phone className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-600">Primary Phone</span>
                      </div>
                      <span className="text-slate-900 font-medium">{client.phone}</span>
                    </div>
                  )}
                  {client.email && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <div className="flex items-center space-x-3">
                        <Mail className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-600">Email</span>
                      </div>
                      <span className="text-slate-900 font-medium">{client.email}</span>
                    </div>
                  )}
                  {(client.streetAddress1 || client.address || client.city || client.province || client.state) && (
                    <div className="flex items-start justify-between py-2 border-b border-slate-100">
                      <div className="flex items-center space-x-3">
                        <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                        <span className="text-sm font-medium text-slate-600">Address</span>
                      </div>
                      <div className="text-right text-slate-900 font-medium">
                        {(client.streetAddress1 || client.address) && (
                          <div>{client.streetAddress1 || client.address}</div>
                        )}
                        {client.streetAddress2 && <div>{client.streetAddress2}</div>}
                        <div>{[client.city, client.province || client.state, client.postalCode || client.zipCode].filter(Boolean).join(', ')}</div>
                      </div>
                    </div>
                  )}
                  {client.emergencyContactName && (
                    <div className="bg-orange-50 p-3 rounded-lg">
                      <div className="text-sm font-medium text-orange-800 mb-1">Emergency Contact</div>
                      <div className="text-orange-700">
                        <div className="font-medium">{client.emergencyContactName}</div>
                        {client.emergencyContactPhone && <div>{client.emergencyContactPhone}</div>}
                        {client.emergencyContactRelationship && (
                          <div className="text-sm">({client.emergencyContactRelationship})</div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Personal Demographics Card */}
              <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="bg-slate-50 rounded-t-lg">
                  <CardTitle className="flex items-center space-x-2 text-lg">
                    <UserIcon className="w-5 h-5 text-purple-600" />
                    <span>Personal Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {client.dateOfBirth && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Date of Birth</span>
                      <span className="text-slate-900 font-medium">
                        {new Date(client.dateOfBirth).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {client.gender && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Gender</span>
                      <span className="text-slate-900 font-medium">
                        {client.gender.charAt(0).toUpperCase() + client.gender.slice(1)}
                      </span>
                    </div>
                  )}
                  {client.maritalStatus && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Marital Status</span>
                      <span className="text-slate-900 font-medium">
                        {client.maritalStatus.charAt(0).toUpperCase() + client.maritalStatus.slice(1).toLowerCase()}
                      </span>
                    </div>
                  )}
                  {client.preferredLanguage && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Preferred Language</span>
                      <span className="text-slate-900 font-medium">{client.preferredLanguage}</span>
                    </div>
                  )}
                  {client.referenceNumber && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Reference Number</span>
                      <span className="text-slate-900 font-medium">{client.referenceNumber}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Clinical Status Row */}
            <div className="grid grid-cols-1 gap-8">
              {/* Clinical Status Card */}
              <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="bg-slate-50 rounded-t-lg">
                  <CardTitle className="flex items-center space-x-2 text-lg">
                    <Clock className="w-5 h-5 text-green-600" />
                    <span>Clinical Status</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-sm font-medium text-slate-600">Treatment Stage</span>
                    <Badge className={`${getStageColor(client.stage || 'intake')} px-3 py-1`}>
                      {(client.stage || 'intake').charAt(0).toUpperCase() + (client.stage || 'intake').slice(1)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-sm font-medium text-slate-600">Client Type</span>
                    <span className="text-slate-900 font-medium">
                      {(client.clientType || 'Individual').charAt(0).toUpperCase() + (client.clientType || 'Individual').slice(1)}
                    </span>
                  </div>
                  {client.serviceType && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Service Type</span>
                      <span className="text-slate-900 font-medium">
                        {client.serviceType.replace('_', ' ').charAt(0).toUpperCase() + client.serviceType.replace('_', ' ').slice(1)}
                      </span>
                    </div>
                  )}
                  {client.serviceFrequency && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Frequency</span>
                      <span className="text-slate-900 font-medium">
                        {client.serviceFrequency.charAt(0).toUpperCase() + client.serviceFrequency.slice(1)}
                      </span>
                    </div>
                  )}
                  {sessions.length > 0 && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Start Date</span>
                      <span className="text-slate-900 font-medium">
                        {(() => {
                          const firstSessionDate = new Date(Math.min(...sessions.map((s: Session) => new Date(s.sessionDate).getTime())));
                          return `${firstSessionDate.getFullYear()}-${String(firstSessionDate.getMonth() + 1).padStart(2, '0')}-${String(firstSessionDate.getDate()).padStart(2, '0')}`;
                        })()}
                      </span>
                    </div>
                  )}
                  <div className="bg-green-50 p-3 rounded-lg">
                    <div className="text-sm font-medium text-green-800 mb-1">Session Progress</div>
                    <div className="text-2xl font-bold text-green-700">
                      {sessions.filter((s: Session) => s.status === 'completed').length}
                    </div>
                    <div className="text-sm text-green-600">Completed Sessions</div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Additional Information Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Assigned Therapist */}
              <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="bg-slate-50 rounded-t-lg">
                  <CardTitle className="flex items-center space-x-2">
                    <UserIcon className="w-5 h-5 text-purple-600" />
                    <span>Assigned Therapist</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  {client.assignedTherapistId ? (
                    <div className="text-center">
                      <div className="bg-purple-100 p-3 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                        <UserIcon className="w-8 h-8 text-purple-600" />
                      </div>
                      <h4 className="font-semibold text-slate-900 mb-1">{therapists.find(t => t.id === client.assignedTherapistId)?.fullName || 'Therapist Assigned'}</h4>
                      <p className="text-slate-600 text-sm">{therapists.find(t => t.id === client.assignedTherapistId)?.role || ''}</p>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <div className="bg-gray-100 p-3 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                        <UserIcon className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-slate-500">No therapist assigned</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Portal Access */}
              <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="bg-slate-50 rounded-t-lg">
                  <CardTitle className="flex items-center space-x-2">
                    <CreditCard className="w-5 h-5 text-indigo-600" />
                    <span>Portal Access</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="text-center">
                    <div className={`p-3 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center ${
                      client.hasPortalAccess ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      <CreditCard className={`w-8 h-8 ${client.hasPortalAccess ? 'text-green-600' : 'text-gray-400'}`} />
                    </div>
                    <Badge className={`mb-2 px-3 py-1 ${client.hasPortalAccess ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {client.hasPortalAccess ? 'Access Enabled' : 'Access Disabled'}
                    </Badge>
                    {client.portalEmail && (
                      <p className="text-slate-600 text-sm mt-2">{client.portalEmail}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Insurance Information */}
              <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="bg-slate-50 rounded-t-lg">
                  <CardTitle className="flex items-center space-x-2">
                    <CreditCard className="w-5 h-5 text-blue-600" />
                    <span>Insurance</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  {client.insuranceProvider ? (
                    <div className="space-y-2">
                      <div className="text-center mb-3">
                        <div className="bg-blue-100 p-3 rounded-full w-16 h-16 mx-auto mb-2 flex items-center justify-center">
                          <CreditCard className="w-8 h-8 text-blue-600" />
                        </div>
                        <h4 className="font-semibold text-slate-900">{client.insuranceProvider}</h4>
                      </div>
                      {client.policyNumber && (
                        <p className="text-sm text-slate-600">Policy: {client.policyNumber}</p>
                      )}
                      {client.copayAmount && (
                        <p className="text-sm text-slate-600">Copay: ${client.copayAmount}</p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <div className="bg-gray-100 p-3 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                        <CreditCard className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-slate-500 text-sm">No insurance information</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Referral Information */}
            <Card className="shadow-sm">
              <CardHeader className="bg-slate-50 rounded-t-lg">
                <CardTitle className="flex items-center space-x-2">
                  <FileText className="w-5 h-5 text-orange-600" />
                  <span>Referral Information</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {(client.referrerName || client.referralDate || client.clientSource) ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {client.referrerName && (
                      <div className="text-center p-4 bg-orange-50 rounded-lg">
                        <div className="text-sm font-medium text-orange-800 mb-1">Referred By</div>
                        <div className="text-orange-700 font-semibold">{client.referrerName}</div>
                      </div>
                    )}
                    {client.referralDate && (
                      <div className="text-center p-4 bg-blue-50 rounded-lg">
                        <div className="text-sm font-medium text-blue-800 mb-1">Referral Date</div>
                        <div className="text-blue-700 font-semibold">
                          {new Date(client.referralDate).toLocaleDateString()}
                        </div>
                      </div>
                    )}
                    {client.clientSource && (
                      <div className="text-center p-4 bg-green-50 rounded-lg">
                        <div className="text-sm font-medium text-green-800 mb-1">Source</div>
                        <div className="text-green-700 font-semibold">
                          {client.clientSource.replace('_', ' ').charAt(0).toUpperCase() + client.clientSource.replace('_', ' ').slice(1)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="bg-gray-100 p-3 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                      <FileText className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-slate-500 mb-2">No referral information available</p>
                    <p className="text-slate-400 text-sm">Referred By, Referral Date, and Source will appear here when added</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sessions Tab */}
          <TabsContent value="sessions" className="space-y-6">
            <h2 className="text-xl font-semibold text-slate-900 mb-6">Session Management</h2>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-blue-600">{sessions.length}</div>
                  <p className="text-sm text-slate-600">Total Sessions</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-green-600">
                    {sessions.filter((s: Session) => s.status === 'completed').length}
                  </div>
                  <p className="text-sm text-slate-600">Completed</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-yellow-600">
                    {sessions.filter((s: Session) => s.status === 'scheduled').length}
                  </div>
                  <p className="text-sm text-slate-600">Scheduled</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-red-600">
                    {sessions.filter((s: Session) => s.status === 'cancelled' || s.status === 'no_show').length}
                  </div>
                  <p className="text-sm text-slate-600">Missed/Cancelled</p>
                </CardContent>
              </Card>
              {/* Session Conflicts Card */}
              <Card className={sessionConflicts?.conflicts?.length ? 'border-orange-200 bg-orange-50' : ''}>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-orange-600">
                    {sessionConflicts?.conflicts?.length || 0}
                  </div>
                  <p className="text-sm text-slate-600">Conflicts</p>
                  {(sessionConflicts?.conflicts?.length || 0) > 0 && (
                    <p className="text-xs text-orange-600 mt-1">Needs Review</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Session History</h3>
              <div className="flex items-center space-x-2">
                <Button 
                  size="sm"
                  onClick={() => window.location.href = `/scheduling?clientId=${client.id}&clientName=${encodeURIComponent(client.fullName)}&therapistId=${client.assignedTherapistId || ''}&therapistName=${encodeURIComponent('')}`}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Schedule Session
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => window.location.href = '/scheduling'}
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  View Calendar
                </Button>
              </div>
            </div>

            {/* Filters: Session Status & Note Status */}
            <div className="mb-4 space-y-3">
              <div className="flex items-center gap-4 flex-wrap">
                {/* Session Status Filter */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">Status:</span>
                  <Select 
                    value={sessionStatusFilter} 
                    onValueChange={setSessionStatusFilter}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="rescheduled">Rescheduled</SelectItem>
                      <SelectItem value="no_show">No Show</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Note Status Filter */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">Note:</span>
                  <Select 
                    value={noteStatusFilter} 
                    onValueChange={setNoteStatusFilter}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="All Notes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sessions</SelectItem>
                      <SelectItem value="finalized">Has Finalized Note</SelectItem>
                      <SelectItem value="draft">Has Draft Note</SelectItem>
                      <SelectItem value="no_note">No Note</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Clear Filters Button */}
                {(sessionStatusFilter !== "all" || noteStatusFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSessionStatusFilter("all");
                      setNoteStatusFilter("all");
                    }}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Clear Filters
                  </Button>
                )}
              </div>
              {/* Results Count */}
              <div className="text-sm text-slate-500">
                Showing {sessions.filter((s: Session) => {
                  const matchesStatus = sessionStatusFilter === "all" || s.status === sessionStatusFilter;
                  const sessionNote = getSessionNote(s.id);
                  let matchesNote = true;
                  if (noteStatusFilter === "finalized") {
                    matchesNote = sessionNote?.isFinalized === true;
                  } else if (noteStatusFilter === "draft") {
                    matchesNote = sessionNote?.isDraft === true;
                  } else if (noteStatusFilter === "no_note") {
                    matchesNote = !sessionNote;
                  }
                  return matchesStatus && matchesNote;
                }).length} of {sessions.length} sessions
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Session History</CardTitle>
              </CardHeader>
              <CardContent>
                {sessions.length > 0 ? (
                  <div className="space-y-3">
                    {sessions
                      .filter((session: Session) => {
                        // Filter by session status
                        const matchesStatus = sessionStatusFilter === "all" || session.status === sessionStatusFilter;
                        
                        // Filter by note status
                        const sessionNote = getSessionNote(session.id);
                        let matchesNote = true;
                        
                        if (noteStatusFilter === "finalized") {
                          matchesNote = sessionNote?.isFinalized === true;
                        } else if (noteStatusFilter === "draft") {
                          matchesNote = sessionNote?.isDraft === true;
                        } else if (noteStatusFilter === "no_note") {
                          matchesNote = !sessionNote;
                        }
                        
                        return matchesStatus && matchesNote;
                      })
                      .map((session: Session) => {
                      // Check if this session's date has conflicts
                      const sessionDate = session.sessionDate ? parseSessionDate(session.sessionDate.toString()).toISOString().split('T')[0] : null;
                      const hasConflicts = sessionDate && sessionConflicts?.conflictDates?.includes(sessionDate);
                      const conflictInfo = hasConflicts ? sessionConflicts?.conflicts?.find(c => c.date === sessionDate) : null;
                      
                      return (
                      <div key={session.id} className={`bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow ${
                        hasConflicts ? 'border-orange-300 bg-orange-50' : 'border-slate-200'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-3">
                            <div className={`w-3 h-3 rounded-full ${
                              session.status === 'completed' ? 'bg-green-500' :
                              session.status === 'scheduled' ? 'bg-blue-500' :
                              'bg-red-500'
                            }`}></div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-slate-900">
                                  {session.sessionType?.charAt(0).toUpperCase() + session.sessionType?.slice(1) || 'Session'}
                                </h4>
                                {hasConflicts && (
                                  <Badge variant="outline" className="text-orange-600 border-orange-300">
                                    <AlertCircle className="w-3 h-3 mr-1" />
                                    {conflictInfo?.type === 'same_service' ? 'Duplicate' : 'Multiple Services'}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-sm space-y-0.5">
                                {/* Line 1: Date and Time */}
                                <p className="text-slate-600">
                                  {session.sessionDate ? (() => {
                                    const sessionDateObj = new Date(session.sessionDate);
                                    return formatInTimeZone(sessionDateObj, 'America/New_York', 'MMM d, yyyy \'at\' h:mm a');
                                  })() : 'Date TBD'}
                                  <span className="text-slate-400 ml-1">EST</span>
                                </p>
                                
                                {/* Line 2: Therapist, Room, and Service Code */}
                                <p className="text-slate-600">
                                  {(session as any).therapistName && (
                                    <span>{(session as any).therapistName}</span>
                                  )}
                                  {(session as any).room?.roomName && (
                                    <span className="ml-2">
                                      <MapPin className="w-3 h-3 inline mr-1" />{(session as any).room.roomName}
                                    </span>
                                  )}
                                  {(session as any).service?.serviceCode && (
                                    <span className="text-slate-500 ml-2">
                                      <span className="font-mono">{(session as any).service.serviceCode}</span>
                                    </span>
                                  )}
                                </p>
                                
                                {/* Line 3: Conflict Warning */}
                                {hasConflicts && conflictInfo && (
                                  <p className="text-orange-600">
                                    {conflictInfo.sessions.length} sessions on same day
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* Clean action layout: Status badge + Primary action + Zoom (if available) + Overflow menu */}
                          <div className="flex items-center gap-3">
                            {/* Session Status Badge (Read-only visual indicator) */}
                            <Badge 
                              variant="outline"
                              className={`
                                ${session.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
                                session.status === 'scheduled' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                session.status === 'cancelled' ? 'bg-red-50 text-red-700 border-red-200' :
                                session.status === 'rescheduled' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                session.status === 'no_show' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                'bg-gray-50 text-gray-700 border-gray-200'}
                              `}
                            >
                              {session.status?.charAt(0).toUpperCase() + session.status?.slice(1)}
                            </Badge>

                            {/* Note Status & Primary Action */}
                            {(() => {
                              const sessionNote = getSessionNote(session.id);
                              
                              if (!sessionNote) {
                                // No note - Primary action: Add Note
                                return (
                                  <Button 
                                    variant="default" 
                                    size="sm"
                                    onClick={() => {
                                      setPreSelectedSessionId(session.id);
                                      setIsSessionNotesDialogOpen(true);
                                    }}
                                    data-testid={`button-add-note-${session.id}`}
                                  >
                                    <FileText className="w-4 h-4 mr-2" />
                                    Add Note
                                  </Button>
                                );
                              } else if (sessionNote.isDraft) {
                                // Draft note - Primary action: Continue editing
                                return (
                                  <>
                                    <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50">
                                      Draft
                                    </Badge>
                                    <Button 
                                      variant="default" 
                                      size="sm"
                                      onClick={() => {
                                        setPreSelectedNoteId(sessionNote.id);
                                        setIsSessionNotesDialogOpen(true);
                                      }}
                                      data-testid={`button-edit-note-${session.id}`}
                                    >
                                      <Edit className="w-4 h-4 mr-2" />
                                      Continue Note
                                    </Button>
                                  </>
                                );
                              } else if (sessionNote.isFinalized) {
                                // Finalized note - Primary action: View PDF
                                return (
                                  <>
                                    <Badge variant="default" className="bg-green-600">
                                      Finalized
                                    </Badge>
                                    <Button 
                                      variant="default" 
                                      size="sm"
                                      onClick={() => handlePreviewNotePDF(sessionNote.id)}
                                      data-testid={`button-preview-pdf-${session.id}`}
                                    >
                                      <Eye className="w-4 h-4 mr-2" />
                                      View PDF
                                    </Button>
                                  </>
                                );
                              }
                              return null;
                            })()}

                            {/* Zoom Button - Keep visible for easy access (only if not finalized) */}
                            {(() => {
                              const sessionNote = getSessionNote(session.id);
                              const isNoteFinalized = sessionNote?.isFinalized;
                              
                              if (!isNoteFinalized && (session as any).zoomEnabled && (session as any).zoomJoinUrl) {
                                return (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                    onClick={() => window.open((session as any).zoomJoinUrl, '_blank')}
                                    data-testid={`button-zoom-join-${session.id}`}
                                  >
                                    <Video className="w-4 h-4 mr-2" />
                                    Join Zoom
                                  </Button>
                                );
                              }
                              return null;
                            })()}

                            {/* Overflow Menu - All secondary actions */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                {/* Session Management Section */}
                                {(() => {
                                  const sessionNote = getSessionNote(session.id);
                                  const isNoteFinalized = sessionNote?.isFinalized;
                                  
                                  if (!isNoteFinalized) {
                                    return (
                                      <>
                                        <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">
                                          Session Actions
                                        </div>
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setSelectedSessionForModal(session);
                                            setIsEditSessionModalOpen(true);
                                          }}
                                        >
                                          <Edit className="w-4 h-4 mr-2" />
                                          Edit Session Details
                                        </DropdownMenuItem>
                                        <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 border-t mt-1 pt-2">
                                          Change Status
                                        </div>
                                        <DropdownMenuItem onClick={() => updateSessionStatus(session.id, 'scheduled')}>
                                          <Clock className="w-4 h-4 mr-2 text-blue-600" />
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
                                      </>
                                    );
                                  }
                                  return null;
                                })()}
                                
                                {/* Note Actions Section */}
                                {(() => {
                                  const sessionNote = getSessionNote(session.id);
                                  if (sessionNote) {
                                    return (
                                      <>
                                        <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 border-t mt-1 pt-2">
                                          Note Actions
                                        </div>
                                        {sessionNote.isDraft && (
                                          <DropdownMenuItem onClick={() => handlePreviewNotePDF(sessionNote.id)}>
                                            <Eye className="w-4 h-4 mr-2" />
                                            Preview Draft PDF
                                          </DropdownMenuItem>
                                        )}
                                        {sessionNote.isFinalized && (
                                          <DropdownMenuItem onClick={() => handleDownloadNotePDF(sessionNote.id)}>
                                            <Download className="w-4 h-4 mr-2" />
                                            Download PDF
                                          </DropdownMenuItem>
                                        )}
                                      </>
                                    );
                                  }
                                  return null;
                                })()}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        {session.notes && (
                          <div className="bg-slate-50 p-3 rounded-md mt-2">
                            <p className="text-sm text-slate-700">{session.notes}</p>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">No sessions recorded yet</p>
                    <p className="text-slate-400 text-sm">Schedule the first session to get started</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Edit Session Modal - Inside Session History Tab */}
            {selectedSessionForModal && (
              <Dialog open={isEditSessionModalOpen} onOpenChange={setIsEditSessionModalOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Session Details & Actions</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-6">
                    <div className="flex items-center space-x-4 p-4 bg-slate-50 rounded-lg">
                      <Avatar className="w-16 h-16">
                        <AvatarFallback className="bg-blue-100 text-blue-600 text-lg">
                          {(() => {
                            const name = client?.fullName || 'UC';
                            return name.split(' ').map((n: string) => n[0]).join('').toUpperCase();
                          })()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-blue-600">
                          {client?.fullName || 'Unknown Client'}
                        </h3>
                        <p className="text-slate-600">with {(selectedSessionForModal as any).therapistName || 'Unknown Therapist'}</p>
                        <div className="flex items-center space-x-4 mt-2 text-sm text-slate-600">
                          <span>
                            {formatInTimeZone(new Date(selectedSessionForModal.sessionDate), 'America/New_York', 'MMM dd, yyyy \'at\' h:mm a')} EST
                          </span>
                          <Badge className="bg-blue-100 text-blue-800" variant="secondary">
                            {selectedSessionForModal.sessionType}
                          </Badge>
                          <Badge className={
                            selectedSessionForModal.status === 'completed' ? 'bg-green-100 text-green-800' :
                            selectedSessionForModal.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                            selectedSessionForModal.status === 'no_show' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-blue-100 text-blue-800'
                          } variant="secondary">
                            {selectedSessionForModal.status}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {(selectedSessionForModal as any).serviceName && (
                        <div>
                          <label className="text-sm font-medium text-slate-700">Service</label>
                          <p className="text-sm text-slate-600">
                            {(selectedSessionForModal as any).serviceName} ({(selectedSessionForModal as any).serviceCode})
                          </p>
                          {(selectedSessionForModal as any).serviceDuration && (selectedSessionForModal as any).serviceRate && (
                            <p className="text-xs text-slate-500">
                              {(selectedSessionForModal as any).serviceDuration} min - ${(selectedSessionForModal as any).serviceRate}
                            </p>
                          )}
                        </div>
                      )}
                      {(selectedSessionForModal as any).roomName && (
                        <div>
                          <label className="text-sm font-medium text-slate-700">Room</label>
                          <p className="text-sm text-slate-600">
                            {(selectedSessionForModal as any).roomName}{(selectedSessionForModal as any).roomNumber && ` (${(selectedSessionForModal as any).roomNumber})`}
                          </p>
                        </div>
                      )}
                    </div>

                    {selectedSessionForModal.notes && (
                      <div>
                        <label className="text-sm font-medium text-slate-700">Session Notes</label>
                        <div className="mt-1 p-3 bg-slate-50 rounded-md">
                          <p className="text-sm text-slate-600">{selectedSessionForModal.notes}</p>
                        </div>
                      </div>
                    )}

                    {/* Status Change Section */}
                    <div className="pt-4 border-t">
                      <label className="text-sm font-medium text-slate-700 mb-3 block">Change Session Status</label>
                      <Select 
                        value={selectedSessionForModal.status} 
                        onValueChange={(value) => {
                          updateSessionMutation.mutate(
                            { sessionId: selectedSessionForModal.id, status: value },
                            {
                              onSuccess: () => {
                                setSelectedSessionForModal({ ...selectedSessionForModal, status: value });
                              }
                            }
                          );
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="scheduled">
                            <div className="flex items-center">
                              <CalendarDays className="w-4 h-4 mr-2 text-blue-600" />
                              Scheduled
                            </div>
                          </SelectItem>
                          <SelectItem value="completed">
                            <div className="flex items-center">
                              <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                              Completed
                            </div>
                          </SelectItem>
                          <SelectItem value="cancelled">
                            <div className="flex items-center">
                              <X className="w-4 h-4 mr-2 text-red-600" />
                              Cancelled
                            </div>
                          </SelectItem>
                          <SelectItem value="rescheduled">
                            <div className="flex items-center">
                              <RotateCw className="w-4 h-4 mr-2 text-purple-600" />
                              Rescheduled
                            </div>
                          </SelectItem>
                          <SelectItem value="no_show">
                            <div className="flex items-center">
                              <AlertCircle className="w-4 h-4 mr-2 text-yellow-600" />
                              No-Show
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="pt-4 border-t">
                      <div className="grid gap-2 grid-cols-2">
                        {/* Primary Row: Quick Actions */}
                        <Button 
                          variant="outline"
                          onClick={() => {
                            // Load session data into form - use reset() to properly update Select components
                            const sessionDateStr = typeof selectedSessionForModal.sessionDate === 'string' 
                              ? selectedSessionForModal.sessionDate 
                              : selectedSessionForModal.sessionDate.toISOString();
                            const sessionDate = new Date(sessionDateStr);
                            const dateOnly = sessionDateStr.split('T')[0];
                            const hours = sessionDate.getHours().toString().padStart(2, '0');
                            const minutes = sessionDate.getMinutes().toString().padStart(2, '0');
                            const timeString = `${hours}:${minutes}`;
                            
                            // Use reset() instead of individual setValue() calls
                            sessionForm.reset({
                              clientId: selectedSessionForModal.clientId,
                              therapistId: (selectedSessionForModal as any).therapistId,
                              serviceId: selectedSessionForModal.serviceId,
                              roomId: selectedSessionForModal.roomId || undefined,
                              sessionType: selectedSessionForModal.sessionType as any,
                              sessionDate: dateOnly,
                              sessionTime: timeString,
                              notes: selectedSessionForModal.notes || '',
                              zoomEnabled: (selectedSessionForModal as any).zoomEnabled || false,
                            });
                            
                            setEditingSessionId(selectedSessionForModal.id);
                            setIsEditSessionModalOpen(false);
                            setIsFullEditModalOpen(true);
                          }}
                          className="text-sm px-3 py-2 h-9"
                          data-testid="button-edit-session-inline"
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Edit This Session
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={() => {
                            setIsEditSessionModalOpen(false);
                            window.location.href = `/scheduling?editSessionId=${selectedSessionForModal.id}`;
                          }}
                          className="text-sm px-3 py-2 h-9"
                          data-testid="button-view-in-calendar"
                        >
                          <Calendar className="w-4 h-4 mr-2" />
                          View in Calendar
                        </Button>
                        
                        {/* Secondary Row: Additional Actions */}
                        <Button 
                          variant="outline"
                          onClick={() => {
                            setIsEditSessionModalOpen(false);
                            window.location.href = `/scheduling?clientId=${selectedSessionForModal.clientId}&clientName=${encodeURIComponent(client?.fullName || '')}&therapistId=${(selectedSessionForModal as any).therapistId || ''}&therapistName=${encodeURIComponent((selectedSessionForModal as any).therapistName || '')}`;
                          }}
                          className="text-sm px-3 py-2 h-9"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Schedule Another
                        </Button>
                        {(selectedSessionForModal as any).zoomEnabled && (selectedSessionForModal as any).zoomJoinUrl ? (
                          <Button 
                            variant="outline"
                            className="text-sm px-3 py-2 h-9 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                            onClick={() => window.open((selectedSessionForModal as any).zoomJoinUrl, '_blank')}
                            data-testid={`button-zoom-join-modal-${selectedSessionForModal.id}`}
                          >
                            <Video className="w-4 h-4 mr-2" />
                            Join Zoom
                            <ExternalLink className="w-3 h-3 ml-1" />
                          </Button>
                        ) : (
                          <Button 
                            variant="outline" 
                            onClick={() => setIsEditSessionModalOpen(false)}
                            className="text-sm px-3 py-2 h-9"
                          >
                            Close
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </TabsContent>

          {/* Assessments Tab */}
          <TabsContent value="assessments" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Client Assessments</h2>
              <Select onValueChange={(templateId) => handleAssignAssessment(parseInt(templateId))}>
                <SelectTrigger className="w-60">
                  <SelectValue placeholder="Assign Assessment Template" />
                </SelectTrigger>
                <SelectContent>
                  {availableTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id.toString()}>
                      <div className="flex items-center space-x-2">
                        <ClipboardList className="w-4 h-4" />
                        <span>{template.title}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Assessment Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-blue-600">{assignedAssessments.length}</div>
                  <p className="text-sm text-slate-600">Total Assigned</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-green-600">
                    {assignedAssessments.filter((a) => a.status === 'completed').length}
                  </div>
                  <p className="text-sm text-slate-600">Completed</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-yellow-600">
                    {assignedAssessments.filter((a) => a.status === 'in_progress').length}
                  </div>
                  <p className="text-sm text-slate-600">In Progress</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-slate-600">
                    {assignedAssessments.filter((a) => a.status === 'pending').length}
                  </div>
                  <p className="text-sm text-slate-600">Pending</p>
                </CardContent>
              </Card>
            </div>

            {/* Available Assessment Templates */}
            <Card>
              <CardHeader>
                <CardTitle>Available Assessment Templates</CardTitle>
              </CardHeader>
              <CardContent>
                {availableTemplates.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {availableTemplates.map((template) => (
                      <Card key={template.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="space-y-3">
                            <div>
                              <h4 className="font-semibold text-slate-900">{template.title}</h4>
                              {template.description && (
                                <p className="text-sm text-slate-600 mt-1 line-clamp-2">{template.description}</p>
                              )}
                            </div>
                            <div className="flex justify-between text-xs text-slate-500">
                              <span>Category: {template.category}</span>
                              <span>v{template.version}</span>
                            </div>
                            <Button
                              onClick={() => handleAssignAssessment(template.id)}
                              size="sm"
                              className="w-full"
                              disabled={assignAssessmentMutation.isPending}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Assign to Client
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">No assessment templates available</p>
                    <p className="text-slate-400 text-sm">Templates will appear here once created</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Assessment List */}
            <Card>
              <CardHeader>
                <CardTitle>Assessment History</CardTitle>
              </CardHeader>
              <CardContent>
                {assignedAssessments.length > 0 ? (
                  <div className="space-y-4">
                    {assignedAssessments.map((assessment) => (
                      <div key={assessment.id} className="border rounded-lg p-4 hover:bg-slate-50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className={`p-2 rounded-full ${
                              assessment.status === 'completed' ? 'bg-green-100' :
                              assessment.status === 'in_progress' ? 'bg-yellow-100' :
                              'bg-blue-100'
                            }`}>
                              <ClipboardList className={`w-4 h-4 ${
                                assessment.status === 'completed' ? 'text-green-600' :
                                assessment.status === 'in_progress' ? 'text-yellow-600' :
                                'text-blue-600'
                              }`} />
                            </div>
                            <div>
                              <h4 className="font-semibold text-slate-900">{assessment.template.name}</h4>
                              <p className="text-sm text-slate-600">
                                Assigned: {new Date(assessment.assignedDate).toLocaleDateString()}
                                {assessment.completedDate && (
                                  <span> • Completed: {new Date(assessment.completedDate).toLocaleDateString()}</span>
                                )}
                              </p>
                              {assessment.template.description && (
                                <p className="text-sm text-slate-500 mt-1">{assessment.template.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge className={`${
                              assessment.status === 'completed' ? 'bg-green-100 text-green-800' :
                              assessment.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {assessment.status.charAt(0).toUpperCase() + assessment.status.slice(1).replace('_', ' ')}
                            </Badge>
                            {assessment.status === 'completed' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleViewAssessmentReport(assessment.id)}
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                View Report
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCompleteAssessment(assessment.id)}
                              >
                                <CheckSquare className="w-4 h-4 mr-2" />
                                Complete
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteAssessment(assessment.id)}
                              disabled={deleteAssessmentMutation.isPending}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              {deleteAssessmentMutation.isPending ? "Deleting..." : "Delete"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">No assessments assigned yet</p>
                    <p className="text-slate-400 text-sm">Use the dropdown above to assign an assessment template</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Available Templates Info */}
            <Card>
              <CardHeader>
                <CardTitle>Available Assessment Templates</CardTitle>
              </CardHeader>
              <CardContent>
                {availableTemplates.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {availableTemplates.map((template) => (
                      <div key={template.id} className="border rounded-lg p-4">
                        <div className="flex items-center space-x-3 mb-2">
                          <ClipboardList className="w-5 h-5 text-blue-600" />
                          <h4 className="font-semibold text-slate-900">{template.title}</h4>
                        </div>
                        {template.description && (
                          <p className="text-sm text-slate-600 mb-2">{template.description}</p>
                        )}
                        <div className="text-xs text-slate-500">
                          {template.sectionCount} sections • {template.questionCount} questions
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-600">No assessment templates available. Create templates in the Assessments page first.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Document Management</h2>
              <Button onClick={handleUploadDocument}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Document
              </Button>
            </div>

            <Card>
              <CardContent className="p-6">
                {documents.length > 0 ? (
                  <div className="space-y-4">
                    {documents.map((doc: Document) => (
                      <div key={doc.id} className="flex items-center justify-between border rounded-lg p-4">
                        <div className="flex items-center space-x-3">
                          {doc.mimeType?.startsWith('image/') ? (
                            <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center">
                              <img 
                                src={`/api/clients/${clientId}/documents/${doc.id}/preview`} 
                                alt={doc.fileName}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const sibling = e.currentTarget.nextElementSibling as HTMLElement;
                                  if (sibling) sibling.classList.remove('hidden');
                                }}
                              />
                              <FolderOpen className="w-5 h-5 text-slate-400 hidden" />
                            </div>
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                              <FolderOpen className="w-5 h-5 text-slate-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-slate-900">{doc.fileName}</p>
                            <p className="text-sm text-slate-500">
                              {doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : ''} • 
                              Uploaded {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : 'Unknown date'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button variant="outline" size="sm" onClick={() => handlePreviewDocument(doc)}>
                            <Eye className="w-4 h-4 mr-2" />
                            Preview
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => window.open(`/api/clients/${clientId}/documents/${doc.id}/download`, '_blank')}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleDeleteDocument(doc)}
                            disabled={deleteDocumentMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-600 text-center py-8">No documents uploaded yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Billing & Insurance</h2>
              <p className="text-slate-600">Generate individual invoices for each service below</p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Invoice History</CardTitle>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 text-sm text-slate-600">
                    {client.insuranceProvider && (
                      <span>Insurance: {client.insuranceProvider}</span>
                    )}
                    {client.policyNumber && (
                      <span>Policy: {client.policyNumber}</span>
                    )}
                    {client.copayAmount && (
                      <span>Copay: ${client.copayAmount || '0.00'}</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {billingRecords.length === 0 ? (
                  <p className="text-slate-600">No billing records available.</p>
                ) : (
                  <div className="space-y-4">
                    {billingRecords.map((billing) => (
                      <div key={billing.id} className="border rounded-lg p-4 hover:bg-slate-50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="bg-blue-100 p-2 rounded-full">
                              <CreditCard className="w-4 h-4 text-blue-600" />
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">
                                {billing.service?.serviceName || billing.serviceName || billing.serviceCode} - ${billing.totalAmount || '0.00'}
                              </p>
                              <p className="text-sm text-slate-600">
                                {billing.serviceDate ? new Date(billing.serviceDate).toLocaleDateString() : 'No session date'} • Service: {billing.service?.serviceCode || billing.serviceCode}
                              </p>
                              {billing.paymentAmount && billing.paymentDate && (
                                <p className="text-xs text-green-600 mt-1">
                                  Payment: ${billing.paymentAmount || '0.00'} on {new Date(billing.paymentDate).toLocaleDateString()}
                                  {billing.paymentMethod && ` via ${billing.paymentMethod.replace('_', ' ')}`}
                                  {billing.paymentReference && ` (Ref: ${billing.paymentReference})`}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge 
                              className={`${
                                billing.paymentStatus === 'paid' 
                                  ? 'bg-green-100 text-green-800' 
                                  : billing.paymentStatus === 'pending'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              } px-3 py-1 text-sm font-medium`}
                            >
                              {billing.paymentStatus ? billing.paymentStatus.charAt(0).toUpperCase() + billing.paymentStatus.slice(1) : 'Unknown'}
                            </Badge>
                            <p className="text-xs text-slate-500 mt-1">
                              {billing.billingDate}
                            </p>
                          </div>
                        </div>
                        {billing.insuranceCovered && (
                          <div className="mt-3 p-2 bg-blue-50 rounded text-sm">
                            <p className="text-blue-800">
                              Insurance: Covered {billing.copayAmount ? `• Copay: $${billing.copayAmount || '0.00'}` : ''}
                            </p>
                          </div>
                        )}
                        
                        <div className="mt-3 flex space-x-2 pt-2 border-t border-slate-200">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleGenerateInvoice('preview', billing.id)}
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            Preview Invoice
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleGenerateInvoice('download', billing.id)}
                          >
                            <Download className="w-3 h-3 mr-1" />
                            Download
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleGenerateInvoice('email', billing.id)}
                          >
                            <Mail className="w-3 h-3 mr-1" />
                            Email
                          </Button>
                          {billing.paymentStatus !== 'paid' && (
                            <Button 
                              size="sm" 
                              variant="default"
                              onClick={() => handleRecordPayment(billing)}
                            >
                              <CreditCard className="w-3 h-3 mr-1" />
                              Record Payment
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Client Tasks Tab */}
          <TabsContent value="tasks" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Client Tasks</h2>
              <div className="flex gap-3">
                <Button 
                  variant="outline"
                  onClick={() => setLocation("/tasks")}
                >
                  <CheckSquare className="w-4 h-4 mr-2" />
                  View All Tasks
                </Button>
                <QuickTaskForm
                  clientId={client.id}
                  clientName={client.fullName}
                  defaultAssigneeId={client.assignedTherapistId || undefined}
                />
              </div>
            </div>

            <Card>
              <CardContent className="p-6">
                {tasks.length > 0 ? (
                  <div className="space-y-4">
                    {tasks.map((task: Task) => (
                      <div key={task.id} className="flex items-start justify-between border rounded-lg p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h4 className="font-medium text-slate-900">{task.title}</h4>
                            <div className="flex gap-2">
                              <Badge className={
                                task.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                                task.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                                task.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-green-100 text-green-800'
                              }>
                                {task.priority}
                              </Badge>
                              <Badge className={
                                task.status === 'completed' ? 'bg-green-100 text-green-800' :
                                task.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                                task.status === 'overdue' ? 'bg-red-100 text-red-800' :
                                'bg-yellow-100 text-yellow-800'
                              }>
                                {task.status?.replace('_', ' ')}
                              </Badge>
                            </div>
                          </div>
                          
                          {task.description && (
                            <p className="text-slate-600 text-sm mb-2">{task.description}</p>
                          )}
                          
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                            {task.dueDate && (
                              <span>Due: {new Date(task.dueDate).toLocaleDateString()}</span>
                            )}
                            {task.assignedToId && (
                              <span>Assigned to: User #{task.assignedToId}</span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex gap-2 ml-4">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setLocation("/tasks")}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <CheckSquare className="h-12 w-12 mx-auto text-slate-300 mb-4" />
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">No tasks yet</h3>
                    <p className="text-slate-600 mb-4">Create the first task for this client to get started.</p>
                    <QuickTaskForm
                      clientId={client.id}
                      clientName={client.fullName}
                      defaultAssigneeId={client.assignedTherapistId || undefined}
                      trigger={
                        <Button>
                          <Plus className="w-4 h-4 mr-2" />
                          Create First Task
                        </Button>
                      }
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Process Checklist Tab */}
          <TabsContent value="checklist" className="space-y-6">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ClipboardList className="w-5 h-5 text-blue-600" />
                    <span>Client Process Checklists</span>
                  </div>
                  <Button 
                    onClick={() => setShowAssignDialog(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Assign Checklist Template
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <ClientChecklistsDisplay clientId={clientId!} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Communications Tab */}
          <TabsContent value="communications" className="space-y-6">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center space-x-2">
                  <Mail className="w-5 h-5 text-blue-600" />
                  <span>Email Communications</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <EmailHistory clientId={clientId!} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit and Delete Modals */}
      {client && (
        <EditClientModal 
          client={client as any}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
        />
      )}

      <DeleteClientDialog 
        client={client as any}
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onDeleteSuccess={handleDeleteSuccess}
      />

      {/* Upload Document Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a document for {client?.fullName}. Supports PDFs, Word docs, images, and text files.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            {/* File Selection */}
            <div className="space-y-2">
              <Label htmlFor="file-upload" className="text-sm font-medium">
                Select File <span className="text-red-500">*</span>
              </Label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-blue-400 transition-colors">
                <Input
                  id="file-upload"
                  type="file"
                  className="w-full"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.bmp,.xls,.xlsx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFileSelect(file);
                    }
                  }}
                  disabled={uploadDocumentMutation.isPending}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Supported: PDF, Word, Excel, Images, Text files (Max 10MB)
                </p>
              </div>
            </div>

            {/* Document Details Form */}
            <div className="space-y-4">
              {/* Document Name */}
              <div className="space-y-2">
                <Label htmlFor="document-name" className="text-sm font-medium">
                  Document Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="document-name"
                  type="text"
                  placeholder="Enter document name"
                  value={documentForm.name}
                  onChange={(e) => setDocumentForm(prev => ({ ...prev, name: e.target.value }))}
                  disabled={uploadDocumentMutation.isPending}
                />
              </div>

              {/* Document Category */}
              <div className="space-y-2">
                <Label htmlFor="document-category" className="text-sm font-medium">
                  Document Type
                </Label>
                <SearchableSelect
                  value={documentForm.category}
                  onValueChange={(value) => setDocumentForm(prev => ({ ...prev, category: value }))}
                  disabled={uploadDocumentMutation.isPending}
                  placeholder="Search and select document type"
                  options={[
                    { value: "uploaded", label: "General Upload" },
                    { value: "forms", label: "Forms & Intake" },
                    { value: "insurance", label: "Insurance Documents" },
                    { value: "medical", label: "Medical Records" },
                    { value: "assessment", label: "Assessment Results" },
                    { value: "legal", label: "Legal Documents" },
                    { value: "correspondence", label: "Correspondence" },
                    { value: "reports", label: "Reports & Summaries" },
                    { value: "treatment", label: "Treatment Plans" },
                    { value: "shared", label: "Shared with Client" },
                    { value: "referral", label: "Referral Documents" },
                    { value: "id", label: "ID Documents" },
                    { value: "consent", label: "Consent Forms" },
                    { value: "authorization", label: "Authorization Forms" },
                    { value: "progress", label: "Progress Notes" },
                    { value: "discharge", label: "Discharge Summaries" },
                    { value: "billing", label: "Billing Documents" },
                    { value: "lab", label: "Lab Results" },
                    { value: "imaging", label: "Imaging Reports" },
                    { value: "prescription", label: "Prescriptions" },
                    { value: "emergency", label: "Emergency Contacts" },
                    { value: "other", label: "Other Documents" }
                  ]}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="document-description" className="text-sm font-medium">
                  Description & Notes
                </Label>
                <Textarea
                  id="document-description"
                  placeholder="Add a description or notes about this document"
                  value={documentForm.description}
                  onChange={(e) => setDocumentForm(prev => ({ ...prev, description: e.target.value }))}
                  disabled={uploadDocumentMutation.isPending}
                  rows={3}
                />
              </div>
            </div>
            
            {/* File Preview */}
            {selectedFile && (
              <div className="border rounded-lg p-4 bg-slate-50">
                <div className="flex items-center space-x-3">
                  {previewUrl ? (
                    <img 
                      src={previewUrl} 
                      alt={selectedFile.name}
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-slate-200 rounded-lg flex items-center justify-center">
                      <FolderOpen className="w-6 h-6 text-slate-400" />
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{selectedFile.name}</p>
                    <p className="text-sm text-slate-500">
                      {Math.round(selectedFile.size / 1024)} KB • {selectedFile.type}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={handleUploadCancel}
              disabled={uploadDocumentMutation.isPending}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleUploadSubmit}
              disabled={!selectedFile || !documentForm.name.trim() || uploadDocumentMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {uploadDocumentMutation.isPending ? "Uploading..." : "Upload Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Checklist Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Assign Checklist Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Select a checklist template to assign to {client?.fullName}. This will create a workflow with all required items.
            </p>
            <div>
              <Label>Available Templates:</Label>
              <div className="space-y-2 mt-2">
                {checklistTemplates.length > 0 ? (
                  (checklistTemplates as ChecklistTemplate[]).map((template: ChecklistTemplate) => (
                    <Button 
                      key={template.id}
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => assignChecklistMutation.mutate(template.id)}
                      disabled={assignChecklistMutation.isPending}
                    >
                      <div className="flex items-center space-x-2">
                        <CheckSquare className="w-4 h-4" />
                        <div className="text-left">
                          <div className="font-medium">{template.name}</div>
                          <div className="text-xs text-slate-500">
                            {template.category} • {template.items?.length || 0} items
                          </div>
                        </div>
                      </div>
                    </Button>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No checklist templates available. Create templates in the Checklist Management page first.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setShowAssignDialog(false)}
                disabled={assignChecklistMutation.isPending}
              >
                Cancel
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Document Preview Dialog */}
      <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Document Preview</DialogTitle>
            <DialogDescription>
              {previewDocument?.fileName}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            {previewDocument && renderDocumentPreview(previewDocument)}
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsPreviewDialogOpen(false)}
            >
              Close
            </Button>
            {previewDocument && (
              <Button 
                onClick={() => window.open(`/api/clients/${clientId}/documents/${previewDocument.id}/download`, '_blank')}
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice Preview Dialog */}
      <Dialog open={isInvoicePreviewOpen} onOpenChange={setIsInvoicePreviewOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Invoice Preview</DialogTitle>
            <DialogDescription>
              Preview invoice for {client.fullName} - {selectedBillingRecord ? `Service: ${selectedBillingRecord.serviceCode}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto">
            <div className="p-8 bg-white border rounded-lg">
              {selectedBillingRecord && (
                <>
                  {/* Invoice Header */}
                  <div className="flex justify-between items-start mb-8">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">INVOICE</h2>
                      <p className="text-slate-600">Invoice #: INV-{client.clientId}-{selectedBillingRecord.id}</p>
                      <p className="text-slate-600">Invoice Date: {new Date(selectedBillingRecord.serviceDate).toLocaleDateString()}</p>
                      <p className="text-slate-600">Service Date: {new Date(selectedBillingRecord.serviceDate).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <PracticeHeader />
                    </div>
                  </div>

                  {/* Client Information */}
                  <div className="grid grid-cols-2 gap-8 mb-8">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-2">Bill To:</h3>
                      <p className="text-slate-600">{client.fullName}</p>
                      <p className="text-slate-600">{client.address}</p>
                      <p className="text-slate-600">{client.phone}</p>
                      <p className="text-slate-600">{client.email}</p>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-2">Insurance Info:</h3>
                      <p className="text-slate-600">Provider: {client.insuranceProvider}</p>
                      <p className="text-slate-600">Policy: {client.policyNumber || 'N/A'}</p>
                      <p className="text-slate-600">Group: {client.groupNumber || 'N/A'}</p>
                    </div>
                  </div>

                  {/* Services Table */}
                  <div className="mb-8">
                    <table className="w-full border-collapse border border-slate-200">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="border border-slate-200 px-4 py-2 text-left">Service</th>
                          <th className="border border-slate-200 px-4 py-2 text-left">Service Code</th>
                          <th className="border border-slate-200 px-4 py-2 text-left">Date</th>
                          <th className="border border-slate-200 px-4 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="border border-slate-200 px-4 py-2">{selectedBillingRecord.service?.serviceName || selectedBillingRecord.serviceName || 'Professional Service'}</td>
                          <td className="border border-slate-200 px-4 py-2">{selectedBillingRecord.service?.serviceCode || selectedBillingRecord.serviceCode}</td>
                          <td className="border border-slate-200 px-4 py-2">{new Date(selectedBillingRecord.serviceDate).toLocaleDateString()}</td>
                          <td className="border border-slate-200 px-4 py-2 text-right">${Number(selectedBillingRecord.totalAmount || selectedBillingRecord.amount).toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Totals */}
                  <div className="flex justify-end">
                    <div className="w-64">
                      <div className="flex justify-between mb-2">
                        <span className="text-slate-600">Service Amount:</span>
                        <span className="text-slate-900">${Number(selectedBillingRecord.totalAmount || selectedBillingRecord.amount).toFixed(2)}</span>
                      </div>
                      {selectedBillingRecord.insuranceCovered && (
                        <div className="flex justify-between mb-2">
                          <span className="text-slate-600">Insurance Coverage:</span>
                          <span className="text-slate-900">-${(Number(selectedBillingRecord.totalAmount || selectedBillingRecord.amount) * 0.8).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between mb-2">
                        <span className="text-slate-600">Copay Amount:</span>
                        <span className="text-slate-900">${Number(selectedBillingRecord.copayAmount || 0).toFixed(2)}</span>
                      </div>
                      {selectedBillingRecord.paymentAmount && (
                        <div className="flex justify-between mb-2">
                          <span className="text-slate-600">Payment Made:</span>
                          <span className="text-green-700">-${Number(selectedBillingRecord.paymentAmount).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold text-lg border-t pt-2">
                        <span>Total Due:</span>
                        <span className={selectedBillingRecord.paymentStatus === 'paid' ? 'text-green-700' : ''}>
                          ${(() => {
                            const originalAmount = Number(selectedBillingRecord.copayAmount || selectedBillingRecord.totalAmount || selectedBillingRecord.amount);
                            const paidAmount = Number(selectedBillingRecord.paymentAmount || 0);
                            const dueAmount = originalAmount - paidAmount;
                            return Math.max(0, dueAmount).toFixed(2);
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInvoicePreviewOpen(false)}>
              Close
            </Button>
            <Button onClick={() => handleGenerateInvoice('print', selectedBillingRecord?.id)}>
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button onClick={() => handleGenerateInvoice('download', selectedBillingRecord?.id)}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button onClick={() => handleGenerateInvoice('email', selectedBillingRecord?.id)}>
              <Mail className="w-4 h-4 mr-2" />
              Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Recording Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record payment details for {paymentBillingRecord ? `${paymentBillingRecord.service?.serviceName || paymentBillingRecord.serviceCode}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-4">
              {/* Current Status */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-sm font-medium text-slate-700">Current Status:</span>
                <Badge className={`${
                  paymentBillingRecord?.paymentStatus === 'paid' 
                    ? 'bg-green-100 text-green-800' 
                    : paymentBillingRecord?.paymentStatus === 'pending'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-red-100 text-red-800'
                }`}>
                  {paymentBillingRecord?.paymentStatus?.charAt(0).toUpperCase() + paymentBillingRecord?.paymentStatus?.slice(1)}
                </Badge>
              </div>

              {/* Payment Status */}
              <div className="space-y-2">
                <Label htmlFor="payment-status">Payment Status</Label>
                <Select 
                  value={paymentForm.status} 
                  onValueChange={(value) => setPaymentForm({...paymentForm, status: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="billed">Billed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Payment Amount */}
              <div className="space-y-2">
                <Label htmlFor="payment-amount">Payment Amount *</Label>
                <Input
                  id="payment-amount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({...paymentForm, amount: e.target.value})}
                />
              </div>

              {/* Payment Date */}
              <div className="space-y-2">
                <Label htmlFor="payment-date">Payment Date *</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={paymentForm.date}
                  onChange={(e) => setPaymentForm({...paymentForm, date: e.target.value})}
                />
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <Label htmlFor="payment-method">Payment Method</Label>
                <Select 
                  value={paymentForm.method} 
                  onValueChange={(value) => setPaymentForm({...paymentForm, method: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                    <SelectItem value="debit_card">Debit Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="insurance">Insurance Payment</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Payment Reference */}
              <div className="space-y-2">
                <Label htmlFor="payment-reference">Reference Number</Label>
                <Input
                  id="payment-reference"
                  placeholder="Check number, transaction ID, etc."
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({...paymentForm, reference: e.target.value})}
                />
              </div>

              {/* Payment Notes */}
              <div className="space-y-2">
                <Label htmlFor="payment-notes">Notes</Label>
                <Input
                  id="payment-notes"
                  placeholder="Additional payment notes..."
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({...paymentForm, notes: e.target.value})}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setIsPaymentDialogOpen(false);
                setPaymentBillingRecord(null);
              }}
              disabled={updatePaymentStatusMutation.isPending}
            >
              Cancel
            </Button>
            <Button 
              onClick={handlePaymentSubmit}
              disabled={updatePaymentStatusMutation.isPending || !paymentForm.amount || !paymentForm.date}
            >
              {updatePaymentStatusMutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full Edit Session Modal */}
      <Dialog open={isFullEditModalOpen} onOpenChange={setIsFullEditModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
            <DialogDescription>
              Update session details and scheduling information
            </DialogDescription>
          </DialogHeader>
          
          <Form {...sessionForm}>
            <form onSubmit={sessionForm.handleSubmit(handleSessionSubmit)} className="space-y-4">
              {/* Therapist Field - FULL WIDTH */}
              <FormField
                control={sessionForm.control}
                name="therapistId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Therapist *</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value?.toString() || ""}
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        options={therapists.map((therapist) => ({
                          value: therapist.id.toString(),
                          label: therapist.fullName
                        }))}
                        placeholder="Select therapist"
                        searchPlaceholder="Search therapists..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Service Field - FULL WIDTH */}
              <FormField
                control={sessionForm.control}
                name="serviceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service *</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value?.toString() || ""}
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        options={services.map((service) => ({
                          value: service.id.toString(),
                          label: `${service.serviceName} - $${service.baseRate} (${(service as any).duration}min)`
                        }))}
                        placeholder="Select service"
                        searchPlaceholder="Search services..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                {/* Date Field */}
                <FormField
                  control={sessionForm.control}
                  name="sessionDate"
                  render={({ field }) => {
                    const todayDate = new Date();
                    const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
                    const currentValue = field.value;
                    const isPastDate = currentValue && currentValue < today;
                    
                    return (
                      <FormItem>
                        <FormLabel>Date *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="date"
                            className={isPastDate ? "border-orange-300 bg-orange-50" : ""}
                            data-testid="input-session-date"
                          />
                        </FormControl>
                        {isPastDate && (
                          <p className="text-orange-600 text-xs mt-1">
                            📅 This session is scheduled in the past
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                {/* Room Field */}
                <FormField
                  control={sessionForm.control}
                  name="roomId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Room *</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        value={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-room">
                            <SelectValue placeholder="Select room" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {rooms.map((room) => (
                            <SelectItem key={room.id} value={room.id.toString()}>
                              Room {room.roomNumber} - {room.roomName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Time Field with Duration Presets - FULL WIDTH */}
              <FormField
                control={sessionForm.control}
                name="sessionTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time *</FormLabel>
                    <div className="space-y-2">
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="input-session-time">
                            <SelectValue placeholder="Select time" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {getTimeSlotsWithLabels().map((timeSlot) => (
                            <SelectItem key={timeSlot.value} value={timeSlot.value}>
                              {timeSlot.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      {/* Quick Duration Tags */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Duration (minutes)</label>
                        <div className="flex flex-wrap gap-2">
                          {[30, 45, 60, 90, 120].map((minutes) => (
                            <Button
                              key={minutes}
                              type="button"
                              variant={provisionalDuration === minutes ? "default" : "outline"}
                              size="sm"
                              className="h-8 px-3 text-xs"
                              onClick={() => setProvisionalDuration(minutes)}
                            >
                              {minutes}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* Available Times Display - Service + Day + Room workflow */}
                      {(() => {
                        const selectedRoom = sessionForm.watch('roomId');
                        const selectedTherapist = sessionForm.watch('therapistId');
                        const selectedService = sessionForm.watch('serviceId');
                        const selectedDate = sessionForm.watch('sessionDate');

                        // Service + Day + Room workflow
                        if (!selectedService) {
                          return (
                            <div className="text-xs text-slate-500 italic">
                              📋 Select service first to see available times
                            </div>
                          );
                        }
                        
                        if (!selectedDate) {
                          return (
                            <div className="text-xs text-slate-500 italic">
                              📅 Select date to continue
                            </div>
                          );
                        }
                        
                        if (!selectedRoom) {
                          return (
                            <div className="text-xs text-slate-500 italic">
                              🏠 Select a room to see available times
                            </div>
                          );
                        }
                        
                        if (!selectedTherapist) {
                          return (
                            <div className="text-xs text-slate-500 italic">
                              👩‍⚕️ Select therapist to continue
                            </div>
                          );
                        }

                        const selectedServiceData = services?.find(s => s.id === selectedService);
                        const serviceDuration = (selectedServiceData as any)?.duration;

                        if (!serviceDuration || serviceDuration <= 0) {
                          return (
                            <div className="text-xs text-orange-600">
                              Service duration not available - please select a different service
                            </div>
                          );
                        }

                        const roomIdNum = Number(selectedRoom);
                        const therapistIdNum = Number(selectedTherapist);

                        const availableSlots = generateAvailableTimeSlotsForSpecificRoom(selectedDate, serviceDuration, therapistIdNum, roomIdNum, provisionalDuration);
                        const roomName = rooms?.find(r => r.id === selectedRoom)?.roomName || 'Selected Room';
                        const freeSlots = availableSlots.filter(slot => slot.isAvailable);

                        return (
                          <div className="mt-2 space-y-1">
                            <span className="text-xs text-slate-600">
                              Available times for {roomName}:
                            </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {freeSlots.map((slot) => (
                                <Button
                                  key={slot.time}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="text-xs px-2 py-1 h-6 text-green-600 hover:text-green-700 border-green-300 hover:border-green-400"
                                  onClick={() => {
                                    sessionForm.setValue('sessionTime', slot.time);
                                  }}
                                >
                                  {formatTime(slot.time)} ✓
                                </Button>
                              ))}
                            </div>
                            {freeSlots.length === 0 && (
                              <p className="text-xs text-orange-600 mt-1">
                                {roomName} is not available for your therapist on this date
                              </p>
                            )}
                            {freeSlots.length > 0 && (
                              <div className="text-xs text-green-600 bg-green-50 p-2 rounded mt-2">
                                🏠 {freeSlots.length} time slot{freeSlots.length > 1 ? 's' : ''} available for {roomName}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Session Type Field - FULL WIDTH */}
              <FormField
                control={sessionForm.control}
                name="sessionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Session Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-session-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="assessment">Assessment</SelectItem>
                        <SelectItem value="psychotherapy">Psychotherapy</SelectItem>
                        <SelectItem value="consultation">Consultation</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Notes Field */}
              <FormField
                control={sessionForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="Session notes or special instructions" 
                        data-testid="input-session-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Zoom Integration Toggle */}
              <FormField
                control={sessionForm.control}
                name="zoomEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        Enable Virtual Meeting (Zoom)
                      </FormLabel>
                      <div className="text-sm text-muted-foreground">
                        Create a Zoom meeting for this session. Meeting details will be emailed to the client.
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="toggle-zoom"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Enhanced Conflict Detection Warning */}
              {conflictData?.hasConflict && !isCheckingConflicts && (
                <div className="p-4 border border-red-200 bg-red-50 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-medium text-red-800">
                        Scheduling Conflicts Detected
                      </h4>
                      
                      {/* Therapist Conflicts */}
                      {conflictData.therapistConflicts?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-red-700 font-medium">Therapist Schedule Conflict:</p>
                          <ul className="mt-1 space-y-1">
                            {conflictData.therapistConflicts.map((conflict: any, index: number) => (
                              <li key={index} className="text-xs text-red-700">
                                • You have: {conflict.clientName} - {conflict.sessionType} at {formatTime(conflict.sessionDate)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Room Conflicts */}
                      {conflictData.roomConflicts?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-red-700 font-medium">Room Booking Conflict:</p>
                          <ul className="mt-1 space-y-1">
                            {conflictData.roomConflicts.map((conflict: any, index: number) => (
                              <li key={index} className="text-xs text-red-700">
                                • Room occupied by {conflict.therapistName} - {conflict.sessionType} at {formatTime(conflict.sessionDate)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Alternative Times */}
                      {conflictData.suggestedTimes?.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs text-red-700 font-medium">
                            Suggested alternative times (therapist + room available):
                          </p>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {conflictData.suggestedTimes.map((time: string, index: number) => (
                              <Button
                                key={index}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-xs px-2 py-1 h-6 border-red-300 text-red-700 hover:bg-red-100"
                                onClick={() => {
                                  const suggestedTime = new Date(time);
                                  const hours = suggestedTime.getHours().toString().padStart(2, '0');
                                  const minutes = suggestedTime.getMinutes().toString().padStart(2, '0');
                                  sessionForm.setValue('sessionTime', `${hours}:${minutes}`);
                                }}
                              >
                                {formatTime(time)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Proceed Anyway Button */}
                      <div className="mt-4 pt-3 border-t border-red-200">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-red-700">
                            Override conflicts and book anyway?
                          </p>
                          <Button
                            type="button"
                            variant={userConfirmedConflicts ? "default" : "destructive"}
                            size="sm"
                            className="h-7 px-3 text-xs"
                            onClick={() => setUserConfirmedConflicts(!userConfirmedConflicts)}
                          >
                            {userConfirmedConflicts ? "✓ Will Override" : "Proceed Anyway"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsFullEditModalOpen(false);
                    setEditingSessionId(null);
                    setUserConfirmedConflicts(false);
                    sessionForm.reset();
                  }}
                  disabled={updateFullSessionMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateFullSessionMutation.isPending}
                  data-testid="button-save-session"
                >
                  {updateFullSessionMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Session Notes Manager - Handles its own dialog */}
      <SessionNotesManager 
        clientId={clientId!} 
        sessions={sessions} 
        preSelectedSessionId={preSelectedSessionId}
        preSelectedNoteId={preSelectedNoteId}
        onSessionChange={setPreSelectedSessionId}
        onNoteChange={setPreSelectedNoteId}
        open={isSessionNotesDialogOpen}
        onOpenChange={setIsSessionNotesDialogOpen}
      />
    </div>
  );
}