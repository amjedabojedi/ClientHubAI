import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";

// UI Components
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// Icons
import { 
  AlertCircle,
  ArrowLeft, 
  Calendar, 
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
          options: [
            { optionKey: 'practice_name', optionLabel: 'Resilience Counseling Research & Consultation' },
            { optionKey: 'practice_description', optionLabel: 'Professional Mental Health Services' },
            { optionKey: 'practice_subtitle', optionLabel: 'Psychotherapy Practice' },
            { optionKey: 'practice_address', optionLabel: '111 Waterloo St Unit 406, London, ON N6B 2M4' },
            { optionKey: 'practice_phone', optionLabel: '+1 (548)866-0366' },
            { optionKey: 'practice_email', optionLabel: 'mail@resiliencec.com' },
            { optionKey: 'practice_website', optionLabel: 'www.resiliencec.com' }
          ]
        };
      }
      
      const response = await fetch(`/api/system-options/categories/${practiceCategory.id}`);
      return await response.json();
    },
  });

  const options = practiceSettings?.options || [];
  const practiceName = options.find((o: any) => o.optionKey === 'practice_name')?.optionLabel || "Resilience Counseling Research & Consultation";
  const practiceDescription = options.find((o: any) => o.optionKey === 'practice_description')?.optionLabel || "Professional Mental Health Services";
  const practiceSubtitle = options.find((o: any) => o.optionKey === 'practice_subtitle')?.optionLabel || "Psychotherapy Practice";
  const practiceAddress = options.find((o: any) => o.optionKey === 'practice_address')?.optionLabel || "111 Waterloo St Unit 406, London, ON N6B 2M4";
  const practicePhone = options.find((o: any) => o.optionKey === 'practice_phone')?.optionLabel || "+1 (548)866-0366";
  const practiceEmail = options.find((o: any) => o.optionKey === 'practice_email')?.optionLabel || "mail@resiliencec.com";
  const practiceWebsite = options.find((o: any) => o.optionKey === 'practice_website')?.optionLabel || "www.resiliencec.com";

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
  const [isInvoicePreviewOpen, setIsInvoicePreviewOpen] = useState(false);
  const [sessionStatusFilter, setSessionStatusFilter] = useState<string>("all");
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
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center space-x-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setLocation("/")}
                className="flex items-center space-x-2"
              >
                <Home className="w-4 h-4" />
                <span>Home</span>
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => setLocation("/clients")}
                className="flex items-center space-x-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Clients</span>
              </Button>
              <Separator orientation="vertical" className="h-6" />
            </div>
            <div className="flex items-center space-x-2">
              <Button onClick={handleEditClient} variant="outline">
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <QuickTaskForm
                clientId={client.id}
                clientName={client.fullName}
                defaultAssigneeId={client.assignedTherapistId || undefined}
                trigger={
                  <Button variant="outline">
                    <CheckSquare className="w-4 h-4 mr-2" />
                    Add Task
                  </Button>
                }
              />
              <Button 
                variant="default"
                onClick={() => window.location.href = `/scheduling?clientId=${client.id}&clientName=${encodeURIComponent(client.fullName)}&therapistId=${client.assignedTherapistId || ''}&therapistName=${encodeURIComponent('')}`}
              >
                <Calendar className="w-4 h-4 mr-2" />
                Schedule Session
              </Button>
              <Button variant="outline" onClick={handleDeleteClient} className="border-red-200 text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-9">
            <TabsTrigger value="overview" className="flex items-center space-x-2">
              <UserIcon className="w-4 h-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="sessions" className="flex items-center space-x-2">
              <Calendar className="w-4 h-4" />
              <span>Sessions</span>
            </TabsTrigger>
            <TabsTrigger value="session-notes" className="flex items-center space-x-2">
              <FileText className="w-4 h-4" />
              <span>Session Notes</span>
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
                <div className="flex space-x-3">
                  <Badge className={`${getStageColor(client.stage || 'intake')} px-3 py-1 text-sm font-medium`}>
                    {client.stage ? client.stage.charAt(0).toUpperCase() + client.stage.slice(1) : 'Intake'}
                  </Badge>
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
                      <h4 className="font-semibold text-slate-900 mb-1">Therapist Assigned</h4>
                      <p className="text-slate-600 text-sm">ID: {client.assignedTherapistId}</p>
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
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Session Management</h2>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Schedule New Session
              </Button>
            </div>

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

            {/* Session Status Filter */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-slate-700">Filter by Status:</span>
                <Select 
                  value={sessionStatusFilter} 
                  onValueChange={setSessionStatusFilter}
                >
                  <SelectTrigger className="w-48">
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
              <div className="text-sm text-slate-500">
                {sessionStatusFilter === "all" ? 
                  `${sessions.length} sessions` : 
                  `${sessions.filter((s: Session) => s.status === sessionStatusFilter).length} ${sessionStatusFilter} sessions`
                }
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
                      .filter((session: Session) => 
                        sessionStatusFilter === "all" || session.status === sessionStatusFilter
                      )
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
                              <p className="text-sm text-slate-600">
                                {session.sessionDate ? (() => {
                                  const sessionDate = parseSessionDate(session.sessionDate.toString());
                                  return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(sessionDate.getDate()).padStart(2, '0')}`;
                                })() : 'Date TBD'}
                                {/* Display service code if available */}
                                {(session as any).service?.serviceCode && (
                                  <span className="text-slate-500 ml-2">
                                    • <span className="font-mono">{(session as any).service.serviceCode}</span>
                                  </span>
                                )}
                                {hasConflicts && conflictInfo && (
                                  <span className="text-orange-600 ml-2">
                                    • {conflictInfo.sessions.length} sessions on same day
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`px-3 py-1 text-sm font-medium hover:opacity-80 ${
                                    session.status === 'completed' ? 'bg-green-100 text-green-800 hover:bg-green-200' :
                                    session.status === 'scheduled' ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' :
                                    session.status === 'cancelled' ? 'bg-red-100 text-red-800 hover:bg-red-200' :
                                    session.status === 'rescheduled' ? 'bg-purple-100 text-purple-800 hover:bg-purple-200' :
                                    session.status === 'no_show' ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' :
                                    'bg-gray-100 text-gray-800 hover:bg-gray-200'
                                  }`}
                                >
                                  {session.status?.charAt(0).toUpperCase() + session.status?.slice(1)}
                                  <ChevronDown className="w-3 h-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => updateSessionStatus(session.id, 'scheduled')}
                                  className="cursor-pointer"
                                >
                                  <Clock className="w-4 h-4 mr-2 text-blue-600" />
                                  Mark Scheduled
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateSessionStatus(session.id, 'completed')}
                                  className="cursor-pointer"
                                >
                                  <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                                  Mark Completed
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateSessionStatus(session.id, 'cancelled')}
                                  className="cursor-pointer"
                                >
                                  <X className="w-4 h-4 mr-2 text-red-600" />
                                  Mark Cancelled
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateSessionStatus(session.id, 'rescheduled')}
                                  className="cursor-pointer"
                                >
                                  <RotateCw className="w-4 h-4 mr-2 text-purple-600" />
                                  Mark Rescheduled
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => updateSessionStatus(session.id, 'no_show')}
                                  className="cursor-pointer"
                                >
                                  <AlertCircle className="w-4 h-4 mr-2 text-yellow-600" />
                                  Mark No-Show
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setPreSelectedSessionId(session.id);
                                setActiveTab('session-notes');
                              }}
                            >
                              <FileText className="w-4 h-4 mr-1" />
                              Add Notes
                            </Button>
                            {(session as any).zoomEnabled && (session as any).zoomJoinUrl && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                onClick={() => window.open((session as any).zoomJoinUrl, '_blank')}
                                data-testid={`button-zoom-join-${session.id}`}
                              >
                                <Video className="w-4 h-4 mr-1" />
                                Join Zoom
                                <ExternalLink className="w-3 h-3 ml-1" />
                              </Button>
                            )}
                          </div>
                        </div>
                        {(session as any).therapistName && (
                          <p className="text-sm text-slate-600 mb-2">
                            <span className="font-medium">Therapist:</span> {(session as any).therapistName}
                          </p>
                        )}
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
          </TabsContent>

          {/* Session Notes Tab */}
          <TabsContent value="session-notes" className="space-y-6">
            <SessionNotesManager 
              clientId={clientId!} 
              sessions={sessions} 
              preSelectedSessionId={preSelectedSessionId}
              onSessionChange={setPreSelectedSessionId}
            />
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

                  {/* Payment Terms */}
                  <div className="mt-8 p-4 bg-slate-50 rounded-lg">
                    <h3 className="font-semibold text-slate-900 mb-2">Payment Terms</h3>
                    <p className="text-sm text-slate-600">Payment is due within 30 days of invoice date. Late payments may incur additional fees.</p>
                    <p className="text-sm text-slate-600 mt-2">Thank you for choosing our mental health services.</p>
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
    </div>
  );
}