import { useState } from "react";
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
  Clock
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

  const handleUploadSubmit = () => {
    if (selectedFile) {
      uploadDocumentMutation.mutate({
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
        description: `Uploaded file: ${selectedFile.name}`
      });
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

  // Hooks
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Document upload mutation
  const uploadDocumentMutation = useMutation({
    mutationFn: async (data: { fileName: string; fileType: string; fileSize: number; description?: string }) => {
      return await apiRequest({
        url: `/api/clients/${clientId}/documents`,
        method: "POST",
        data: {
          fileName: data.fileName,
          originalName: data.fileName,
          mimeType: data.fileType,
          fileSize: data.fileSize,
          category: "uploaded"
        }
      });
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
        description: "Failed to upload document",
        variant: "destructive",
      });
    }
  });

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
                onClick={() => window.location.href = `/scheduling?clientId=${client.id}&clientName=${encodeURIComponent(client.fullName)}`}
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
                    <div className="text-2xl font-bold text-green-700">{client.sessionCount || 0}</div>
                    <div className="text-sm text-green-600">Total Sessions Completed</div>
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
                  onClick={() => window.location.href = `/scheduling?clientId=${client.id}&clientName=${encodeURIComponent(client.fullName)}`}
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
                            <Badge className={`px-3 py-1 text-sm font-medium ${
                              session.status === 'completed' ? 'bg-green-100 text-green-800' :
                              session.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {session.status?.charAt(0).toUpperCase() + session.status?.slice(1)}
                            </Badge>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setActiveTab('session-notes');
                                // You could also pass session info to pre-populate the form
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
            <SessionNotesManager clientId={clientId!} sessions={sessions} />
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
                          <Button variant="outline" size="sm">
                            <Download className="w-4 h-4 mr-2" />
                            Download
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
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
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Invoice
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Insurance Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {client.insuranceProvider && (
                    <div>
                      <p className="text-sm font-medium text-slate-900">Provider</p>
                      <p className="text-slate-600">{client.insuranceProvider}</p>
                    </div>
                  )}
                  {client.policyNumber && (
                    <div>
                      <p className="text-sm font-medium text-slate-900">Policy Number</p>
                      <p className="text-slate-600">{client.policyNumber}</p>
                    </div>
                  )}
                  {client.copayAmount && (
                    <div>
                      <p className="text-sm font-medium text-slate-900">Copay</p>
                      <p className="text-slate-600">${client.copayAmount}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment History</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600">No payment history available.</p>
                </CardContent>
              </Card>
            </div>
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
    </div>
  );
}