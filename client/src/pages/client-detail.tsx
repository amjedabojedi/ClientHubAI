import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Icons
import { 
  ArrowLeft, 
  User, 
  Calendar, 
  FileText, 
  ClipboardList, 
  FolderOpen, 
  CreditCard, 
  CheckSquare, 
  Plus, 
  Search, 
  Download, 
  Upload, 
  Edit, 
  Trash2,
  Home,
  Phone,
  Mail,
  MapPin,
  Clock,
  Eye,
  AlertCircle,
  CheckCircle,
  X,
  ChevronDown,
  Printer
} from "lucide-react";

// Utils and Types
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Client, Session, Note, Task, Document } from "@/types/client";

// Components
import EditClientModal from "@/components/client-management/edit-client-modal";
import DeleteClientDialog from "@/components/client-management/delete-client-dialog";
import SessionNotesManager from "@/components/session-notes/session-notes-manager";

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
  
  // State
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [preSelectedSessionId, setPreSelectedSessionId] = useState<number | null>(null);
  const [isInvoicePreviewOpen, setIsInvoicePreviewOpen] = useState(false);
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

  // React Query
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  // Event Handlers
  const handleEditClient = () => setIsEditModalOpen(true);
  const handleDeleteClient = () => setIsDeleteDialogOpen(true);
  const handleDeleteSuccess = () => setLocation("/clients");
  const handleUploadDocument = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setIsUploadDialogOpen(true);
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    
    // Generate preview URL for images
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const handleUploadSubmit = async () => {
    if (selectedFile) {
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
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          fileSize: selectedFile.size,
          description: `Uploaded file: ${selectedFile.name}`,
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

      const response = await fetch(`/api/clients/${clientId}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, billingId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate invoice');
      }

      if (action === 'download') {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${client.clientId}-${billingId || 'all'}-${new Date().toISOString().split('T')[0]}.html`;
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
        toast({
          title: "Email sent",
          description: result.message || "Invoice has been sent to client's email address.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
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
      return <TextFileViewer clientId={clientId} document={doc} />;
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
      const response = await fetch(`/api/clients/${clientId}/documents/${documentId}`, {
        method: "DELETE"
      });
      
      if (!response.ok) {
        throw new Error("Failed to delete document");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/documents`] });
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
    mutationFn: async (data: { fileName: string; fileType: string; fileSize: number; description?: string; fileContent?: string }) => {
      try {
        const response = await fetch(`/api/clients/${clientId}/documents`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: data.fileName,
            originalName: data.fileName,
            mimeType: data.fileType,
            fileSize: data.fileSize,
            category: "uploaded",
            fileContent: data.fileContent // Include file content for server storage
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        return result;
      } catch (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/documents`] });
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
      const response = await fetch(`/api/billing/${billingId}/payment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentData),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update payment details');
      }
      
      return response.json();
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

  const { data: client, isLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: [`/api/clients/${clientId}/sessions`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: notes = [] } = useQuery({
    queryKey: [`/api/clients/${clientId}/notes`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: [`/api/clients/${clientId}/tasks`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: documents = [] } = useQuery({
    queryKey: [`/api/clients/${clientId}/documents`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
  });

  const { data: billingRecords = [] } = useQuery({
    queryKey: [`/api/clients/${clientId}/billing`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientId,
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-gray-100 text-gray-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'intake': return 'bg-blue-100 text-blue-800';
      case 'assessment': return 'bg-purple-100 text-purple-800';
      case 'psychotherapy': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

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
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{client.fullName}</h1>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Button onClick={handleEditClient} variant="outline">
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button 
                variant="default"
                onClick={() => window.location.href = `/scheduling?clientId=${client.id}&clientName=${encodeURIComponent(client.fullName)}&therapistId=${client.assignedTherapist?.id || ''}&therapistName=${encodeURIComponent(client.assignedTherapist?.fullName || '')}`}
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
          <TabsList className="grid w-full grid-cols-8">
            <TabsTrigger value="overview" className="flex items-center space-x-2">
              <User className="w-4 h-4" />
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
            <TabsTrigger value="checklist" className="flex items-center space-x-2">
              <CheckSquare className="w-4 h-4" />
              <span>Checklist</span>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-8">
            {/* Client Summary Header */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="bg-blue-100 p-3 rounded-full">
                    <User className="w-8 h-8 text-blue-600" />
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
                  <Badge className={`${getStatusColor(client.status)} px-3 py-1 text-sm font-medium`}>
                    {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                  </Badge>
                  <Badge className={`${getStageColor(client.stage)} px-3 py-1 text-sm font-medium`}>
                    {client.stage.charAt(0).toUpperCase() + client.stage.slice(1)}
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
                    <Badge className={`${getStageColor(client.stage)} px-3 py-1`}>
                      {client.stage.charAt(0).toUpperCase() + client.stage.slice(1)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-sm font-medium text-slate-600">Client Type</span>
                    <span className="text-slate-900 font-medium">
                      {client.clientType.charAt(0).toUpperCase() + client.clientType.slice(1)}
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
                  {client.startDate && (
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <span className="text-sm font-medium text-slate-600">Start Date</span>
                      <span className="text-slate-900 font-medium">
                        {new Date(client.startDate).toLocaleDateString()}
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
                    <User className="w-5 h-5 text-purple-600" />
                    <span>Assigned Therapist</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  {client.assignedTherapist ? (
                    <div className="text-center">
                      <div className="bg-purple-100 p-3 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                        <User className="w-8 h-8 text-purple-600" />
                      </div>
                      <h4 className="font-semibold text-slate-900 mb-1">{client.assignedTherapist.fullName}</h4>
                      <p className="text-slate-600 text-sm">{client.assignedTherapist.email}</p>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <div className="bg-gray-100 p-3 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                        <User className="w-8 h-8 text-gray-400" />
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
            {(client.referrerName || client.referralDate || client.clientSource) && (
              <Card className="shadow-sm">
                <CardHeader className="bg-slate-50 rounded-t-lg">
                  <CardTitle className="flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-orange-600" />
                    <span>Referral Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
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
                </CardContent>
              </Card>
            )}
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

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
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
            </div>

            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Session History</h3>
              <div className="flex items-center space-x-2">
                <Button 
                  size="sm"
                  onClick={() => window.location.href = `/scheduling?clientId=${client.id}&clientName=${encodeURIComponent(client.fullName)}&therapistId=${client.assignedTherapist?.id || ''}&therapistName=${encodeURIComponent(client.assignedTherapist?.fullName || '')}`}
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

            <Card>
              <CardHeader>
                <CardTitle>Session History</CardTitle>
              </CardHeader>
              <CardContent>
                {sessions.length > 0 ? (
                  <div className="space-y-3">
                    {sessions.map((session: Session) => (
                      <div key={session.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-3">
                            <div className={`w-3 h-3 rounded-full ${
                              session.status === 'completed' ? 'bg-green-500' :
                              session.status === 'scheduled' ? 'bg-blue-500' :
                              'bg-red-500'
                            }`}></div>
                            <div>
                              <h4 className="font-semibold text-slate-900">
                                {session.sessionType?.charAt(0).toUpperCase() + session.sessionType?.slice(1) || 'Session'}
                              </h4>
                              <p className="text-sm text-slate-600">
                                {session.sessionDate ? new Date(session.sessionDate).toLocaleDateString() : 'Date TBD'}
                                {session.duration && ` • ${session.duration} minutes`}
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
                                    'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
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
                          </div>
                        </div>
                        {session.therapist && (
                          <p className="text-sm text-slate-600 mb-2">
                            <span className="font-medium">Therapist:</span> {session.therapist.fullName}
                          </p>
                        )}
                        {session.notes && (
                          <div className="bg-slate-50 p-3 rounded-md mt-2">
                            <p className="text-sm text-slate-700">{session.notes}</p>
                          </div>
                        )}
                      </div>
                    ))}
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
              <h2 className="text-xl font-semibold text-slate-900">Assessments</h2>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Assessment
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Assessment History</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600">No assessments completed yet.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Available Templates</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-slate-600">• Initial Assessment</p>
                    <p className="text-slate-600">• Progress Review</p>
                    <p className="text-slate-600">• Treatment Plan</p>
                    <p className="text-slate-600">• Discharge Assessment</p>
                  </div>
                </CardContent>
              </Card>
            </div>
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
                                  e.currentTarget.nextElementSibling!.style.display = 'flex';
                                }}
                              />
                              <FolderOpen className="w-5 h-5 text-slate-400" style={{ display: 'none' }} />
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
                      <span>Copay: ${client.copayAmount}</span>
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
                                {billing.service?.serviceName || billing.serviceName || billing.serviceCode} - ${billing.totalAmount}
                              </p>
                              <p className="text-sm text-slate-600">
                                {billing.session ? new Date(billing.session.sessionDate).toLocaleDateString() : 'No session date'} • CPT: {billing.service?.serviceCode || billing.serviceCode}
                              </p>
                              {billing.paymentAmount && billing.paymentDate && (
                                <p className="text-xs text-green-600 mt-1">
                                  Payment: ${billing.paymentAmount} on {new Date(billing.paymentDate).toLocaleDateString()}
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
                              {billing.paymentStatus?.charAt(0).toUpperCase() + billing.paymentStatus?.slice(1)}
                            </Badge>
                            <p className="text-xs text-slate-500 mt-1">
                              {billing.billingDate}
                            </p>
                          </div>
                        </div>
                        {billing.insuranceCovered && (
                          <div className="mt-3 p-2 bg-blue-50 rounded text-sm">
                            <p className="text-blue-800">
                              Insurance: Covered {billing.copayAmount ? `• Copay: $${billing.copayAmount}` : ''}
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

          {/* Checklist Tab */}
          <TabsContent value="checklist" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Client Checklist</h2>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Task
              </Button>
            </div>

            <Card>
              <CardContent className="p-6">
                {tasks.length > 0 ? (
                  <div className="space-y-4">
                    {tasks.map((task: Task) => (
                      <div key={task.id} className="flex items-center space-x-3 border rounded-lg p-4">
                        <div className="flex-1">
                          <p className="font-medium text-slate-900">{task.title}</p>
                          <p className="text-slate-600">{task.description}</p>
                          {task.dueDate && (
                            <p className="text-sm text-slate-500">
                              Due: {new Date(task.dueDate).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <Badge className={
                          task.status === 'completed' ? 'bg-green-100 text-green-800' :
                          task.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                          task.status === 'overdue' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }>
                          {task.status?.replace('_', ' ')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-600 text-center py-8">No tasks assigned.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit and Delete Modals */}
      {client && (
        <EditClientModal 
          client={client}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
        />
      )}

      <DeleteClientDialog 
        client={client}
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onDeleteSuccess={handleDeleteSuccess}
      />

      {/* Upload Document Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a document for {client?.fullName}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-4">
              <div>
                <Label htmlFor="file-upload">Choose File</Label>
                <Input
                  id="file-upload"
                  type="file"
                  className="mt-2"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.bmp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFileSelect(file);
                    }
                  }}
                  disabled={uploadDocumentMutation.isPending}
                />
              </div>
              
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
              disabled={!selectedFile || uploadDocumentMutation.isPending}
            >
              {uploadDocumentMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
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
            {renderDocumentPreview(previewDocument)}
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
                      <p className="text-slate-600">Date: {new Date().toLocaleDateString()}</p>
                      <p className="text-slate-600">Service Date: {new Date(selectedBillingRecord.serviceDate).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <h3 className="text-lg font-semibold text-slate-900 mb-2">Healthcare Services</h3>
                      <p className="text-slate-600">Professional Mental Health Services</p>
                      <p className="text-slate-600">Licensed Clinical Practice</p>
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
                      <p className="text-slate-600">Policy: {client.insurancePolicyNumber}</p>
                      <p className="text-slate-600">Group: {client.insuranceGroupNumber}</p>
                    </div>
                  </div>

                  {/* Services Table */}
                  <div className="mb-8">
                    <table className="w-full border-collapse border border-slate-200">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="border border-slate-200 px-4 py-2 text-left">Service</th>
                          <th className="border border-slate-200 px-4 py-2 text-left">CPT Code</th>
                          <th className="border border-slate-200 px-4 py-2 text-left">Date</th>
                          <th className="border border-slate-200 px-4 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="border border-slate-200 px-4 py-2">{selectedBillingRecord.service?.serviceName || selectedBillingRecord.serviceName || 'Professional Service'}</td>
                          <td className="border border-slate-200 px-4 py-2">{selectedBillingRecord.service?.serviceCode || selectedBillingRecord.serviceCode}</td>
                          <td className="border border-slate-200 px-4 py-2">{new Date(selectedBillingRecord.serviceDate || selectedBillingRecord.session?.sessionDate).toLocaleDateString()}</td>
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
                      <div className="flex justify-between font-semibold text-lg border-t pt-2">
                        <span>Total Due:</span>
                        <span>${Number(selectedBillingRecord.copayAmount || selectedBillingRecord.totalAmount || selectedBillingRecord.amount).toFixed(2)}</span>
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
            <Button onClick={() => handleGenerateInvoice('print')}>
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button onClick={() => handleGenerateInvoice('download')}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button onClick={() => handleGenerateInvoice('email')}>
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