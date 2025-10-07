import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { 
  CreditCard, 
  DollarSign, 
  Clock, 
  CheckCircle, 
  AlertTriangle,
  Users,
  FileText,
  Calendar,
  Filter,
  Download,
  Eye,
  Edit,
  Mail,
  MoreVertical
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface BillingRecord {
  id: number;
  sessionId: number;
  serviceCode: string;
  units: number;
  ratePerUnit: number;
  totalAmount: number;
  insuranceCovered: boolean;
  copayAmount?: number;
  billingDate?: string;
  paymentStatus: 'pending' | 'billed' | 'paid' | 'denied' | 'refunded' | 'follow_up';
  paymentAmount?: number;
  paymentDate?: string;
  paymentReference?: string;
  paymentMethod?: string;
  paymentNotes?: string;
  createdAt: string;
  updatedAt: string;
  session?: {
    id: number;
    sessionDate: string;
    sessionType: string;
    status: string;
    client?: {
      id: number;
      fullName: string;
      clientId: string;
    };
    therapist?: {
      id: number;
      fullName: string;
    };
    service?: {
      id: number;
      serviceCode: string;
      serviceName: string;
      baseRate: number;
    };
  };
}

interface PaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  billingRecord: BillingRecord | null;
  onPaymentRecorded: () => void;
}

function PaymentDialog({ isOpen, onClose, billingRecord, onPaymentRecorded }: PaymentDialogProps) {
  const [paymentAmount, setPaymentAmount] = useState(billingRecord?.totalAmount?.toString() || '');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const recordPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const { apiRequest } = await import('@/lib/queryClient');
      const response = await apiRequest(`/api/billing/${billingRecord?.id}/payment`, 'PUT', data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Payment recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/billing/reports'] });
      onPaymentRecorded();
      onClose();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error recording payment", 
        description: error?.message || "Failed to record payment",
        variant: "destructive" 
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentAmount || !paymentMethod) {
      toast({ 
        title: "Please fill in required fields", 
        description: "Payment amount and method are required",
        variant: "destructive" 
      });
      return;
    }

    recordPaymentMutation.mutate({
      status: 'paid',
      amount: parseFloat(paymentAmount),
      method: paymentMethod,
      reference: paymentReference,
      notes: paymentNotes,
      date: new Date().toISOString().split('T')[0]
    });
  };

  if (!billingRecord) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Recording payment for {billingRecord.session?.client?.fullName} - {billingRecord.serviceCode}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="paymentAmount">Payment Amount *</Label>
            <Input
              id="paymentAmount"
              type="number"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
          <div>
            <Label htmlFor="paymentMethod">Payment Method *</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod} required>
              <SelectTrigger>
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="credit_card">Credit Card</SelectItem>
                <SelectItem value="debit_card">Debit Card</SelectItem>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="online_payment">Online Payment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="paymentReference">Reference Number</Label>
            <Input
              id="paymentReference"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="Check number, transaction ID, etc."
            />
          </div>
          <div>
            <Label htmlFor="paymentNotes">Notes</Label>
            <Textarea
              id="paymentNotes"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="Additional payment notes"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={recordPaymentMutation.isPending}>
              {recordPaymentMutation.isPending ? 'Recording...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BillingDashboard() {
  // Set default date range to current month
  const currentDate = new Date();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedTherapist, setSelectedTherapist] = useState<string>('all');
  const [selectedService, setSelectedService] = useState<string>('all');
  const [selectedClientType, setSelectedClientType] = useState<string>('all');
  const [clientSearch, setClientSearch] = useState<string>('');
  const [debouncedClientSearch, setDebouncedClientSearch] = useState<string>('');
  
  // Debounce client search to prevent excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedClientSearch(clientSearch);
    }, 500); // 500ms delay
    
    return () => clearTimeout(timer);
  }, [clientSearch]);
  const [startDate, setStartDate] = useState<string>(firstDayOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(lastDayOfMonth.toISOString().split('T')[0]);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedBillingRecord, setSelectedBillingRecord] = useState<BillingRecord | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Fetch billing data with role-based filtering and default current month range
  const { data: billingData, isLoading, isFetching } = useQuery({
    queryKey: ['/api/billing/reports', user?.id, startDate, endDate, selectedStatus, selectedTherapist, selectedService, selectedClientType, debouncedClientSearch],
    queryFn: async () => {
      let url = '/api/billing/reports';
      const params = new URLSearchParams();
      
      // Add all filters to server-side query
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (selectedStatus !== 'all') params.append('status', selectedStatus);
      if (selectedService !== 'all') params.append('serviceCode', selectedService);
      if (selectedClientType !== 'all') params.append('clientType', selectedClientType);
      if (debouncedClientSearch.trim()) params.append('clientSearch', debouncedClientSearch.trim());
      
      // Role-based therapist filtering
      if (user?.role !== 'admin' && user?.role !== 'administrator' && user?.id) {
        params.append('therapistId', user.id.toString());
      } else if (selectedTherapist !== 'all') {
        // Admin users can filter by specific therapist
        params.append('therapistId', selectedTherapist);
      }
      
      if (params.toString()) {
        url += '?' + params.toString();
      }
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch billing data');
      const data = await response.json();
      return data;
    },
    enabled: !!user, // Only fetch when user is loaded
    staleTime: 30000, // Cache for 30 seconds for better perceived performance
    refetchOnWindowFocus: false // Prevent refetch on window focus
  });

  // Fetch therapists for filter
  const { data: therapists = [] } = useQuery({
    queryKey: ['/api/users'],
    queryFn: async () => {
      const response = await fetch('/api/users?role=therapist');
      if (!response.ok) throw new Error('Failed to fetch therapists');
      return response.json();
    }
  });

  // Fetch services for filter (role-based filtering)
  const { data: services = [] } = useQuery({
    queryKey: [user?.role === 'administrator' || user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'clinical_supervisor' ? "/api/services" : "/api/services/filtered", { currentUserRole: user?.role }],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 15 * 60 * 1000, // Cache for 15 minutes - services rarely change
  });

  // Fetch system categories for client type filter
  const { data: systemCategories = [] } = useQuery({
    queryKey: ['/api/system-options/categories'],
    queryFn: async () => {
      const response = await fetch('/api/system-options/categories');
      if (!response.ok) throw new Error('Failed to fetch system categories');
      return response.json();
    }
  });

  // Find client type category and fetch its options
  const clientTypeCategory = systemCategories.find((cat: any) => cat.categoryKey === "client_type");
  const { data: clientTypeOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${clientTypeCategory?.id}`],
    enabled: !!clientTypeCategory?.id,
    queryFn: async () => {
      const response = await fetch(`/api/system-options/categories/${clientTypeCategory.id}`);
      if (!response.ok) throw new Error('Failed to fetch client type options');
      return response.json();
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ billingId, status }: { billingId: number; status: string }) => {
      const { apiRequest } = await import('@/lib/queryClient');
      const response = await apiRequest(`/api/billing/${billingId}/status`, 'PATCH', { status });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Status updated successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/billing/reports'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error updating status", 
        description: error?.message || "Failed to update status",
        variant: "destructive" 
      });
    }
  });

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'billed': return 'bg-blue-100 text-blue-800';
      case 'paid': return 'bg-green-100 text-green-800';
      case 'denied': return 'bg-red-100 text-red-800';
      case 'refunded': return 'bg-gray-100 text-gray-800';
      case 'follow_up': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4" />;
      case 'billed': return <FileText className="h-4 w-4" />;
      case 'paid': return <CheckCircle className="h-4 w-4" />;
      case 'denied': return <AlertTriangle className="h-4 w-4" />;
      case 'refunded': return <CreditCard className="h-4 w-4" />;
      case 'follow_up': return <Eye className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  // All filtering is now done server-side, so we just use the returned data
  const allBillingRecords = Array.isArray(billingData) ? billingData : billingData?.billingRecords || [];
  const filteredBillingRecords = allBillingRecords;

  // Summary stats are calculated server-side or based on filtered results
  const statsData = filteredBillingRecords;
  
  const summaryStats = {
    totalOutstanding: statsData
      .filter((r: any) => {
        const billing = r.billing || r;
        return billing.paymentStatus === 'pending' || billing.paymentStatus === 'billed';
      })
      .reduce((sum: number, r: any) => {
        const billing = r.billing || r;
        return sum + (Number(billing.totalAmount) - Number(billing.paymentAmount || 0));
      }, 0),
    totalPaid: statsData
      .filter((r: any) => {
        const billing = r.billing || r;
        return billing.paymentStatus === 'paid';
      })
      .reduce((sum: number, r: any) => {
        const billing = r.billing || r;
        return sum + Number(billing.paymentAmount || 0);
      }, 0),
    pendingCount: statsData.filter((r: any) => {
      const billing = r.billing || r;
      return billing.paymentStatus === 'pending';
    }).length,
    paidCount: statsData.filter((r: any) => {
      const billing = r.billing || r;
      return billing.paymentStatus === 'paid';
    }).length,
    totalRecords: statsData.length,
    totalClients: new Set(statsData.map((r: any) => r.client?.id).filter(Boolean)).size
  };

  const handleRecordPayment = (record: BillingRecord) => {
    setSelectedBillingRecord(record);
    setPaymentDialogOpen(true);
  };

  // Invoice action handlers using apiRequest (includes CSRF tokens automatically)
  const handleInvoiceAction = async (action: 'preview' | 'download' | 'email', billing: any, client: any) => {
    try {
      // Check for email if action is email
      if (action === 'email' && !client?.email) {
        toast({
          title: "No email address",
          description: "Client doesn't have an email address. Please add one in their profile first.",
          variant: "destructive",
        });
        return;
      }

      // For preview, just open in new window
      if (action === 'preview') {
        window.open(`/api/clients/${client.id}/invoice-preview?billingId=${billing.id}`, '_blank');
        return;
      }

      // For download and email, use apiRequest
      const response = await apiRequest(`/api/clients/${client.id}/invoice`, 'POST', { 
        action, 
        billingId: billing.id 
      });

      if (action === 'download') {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${client.clientId}-${billing.id}-${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        toast({
          title: "Invoice downloaded",
          description: "Invoice has been downloaded successfully.",
        });
      } else if (action === 'email') {
        const result = await response.json();
        toast({
          title: "Email sent successfully!",
          description: result.message || `Invoice has been sent to ${client.email}`,
        });
      }
    } catch (error: any) {
      toast({
        title: `${action.charAt(0).toUpperCase() + action.slice(1)} Error`,
        description: error.message || `Failed to ${action} invoice. Please try again.`,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Billing Dashboard</h1>
        </div>
        <div className="text-center py-8">Loading billing data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Billing Dashboard</h1>
          {isFetching && !isLoading && (
            <Badge variant="outline" className="animate-pulse">
              <Clock className="h-3 w-3 mr-1" />
              Updating...
            </Badge>
          )}
        </div>
        {user?.role === 'admin' && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${summaryStats.totalOutstanding.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              {summaryStats.pendingCount} pending payments
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${summaryStats.totalPaid.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              {summaryStats.paidCount} paid invoices
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summaryStats.totalClients}
            </div>
            <p className="text-xs text-muted-foreground">
              With billing records
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Records</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryStats.totalRecords}</div>
            <p className="text-xs text-muted-foreground">
              Billing records
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${user?.role === 'admin' || user?.role === 'administrator' ? 'lg:grid-cols-3 xl:grid-cols-6' : 'lg:grid-cols-3'}`}>
            <div>
              <Label htmlFor="client-search">Client Name</Label>
              <Input
                id="client-search"
                placeholder="Search by client name..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="status-filter">Payment Status</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="billed">Billed</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                  <SelectItem value="follow_up">Follow Up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(user?.role === 'admin' || user?.role === 'administrator') && (
              <div>
                <Label htmlFor="therapist-filter">Therapist</Label>
                <Select value={selectedTherapist} onValueChange={setSelectedTherapist}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Therapists</SelectItem>
                    {therapists?.filter((therapist: any) => therapist.id && therapist.id.toString().trim() !== '').map((therapist: any) => (
                      <SelectItem key={therapist.id} value={therapist.id.toString()}>
                        {therapist.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="service-filter">Service Code</Label>
              <Select value={selectedService} onValueChange={setSelectedService}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Services</SelectItem>
                  {Array.isArray(services) && services.map((service: any) => (
                    <SelectItem key={service.serviceCode} value={service.serviceCode}>
                      {service.serviceCode} - {service.serviceName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="client-type-filter">Client Type</Label>
              <Select value={selectedClientType} onValueChange={setSelectedClientType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Client Types</SelectItem>
                  {clientTypeOptions.options?.filter((option: any) => 
                    (option.optionKey || option.optionkey) && 
                    (option.optionKey || option.optionkey).trim() !== ''
                  ).map((option: any) => (
                    <SelectItem key={option.id} value={option.optionKey || option.optionkey}>
                      {option.optionLabel || option.optionlabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 md:col-span-2 lg:col-span-full">
              <Label>Date Range</Label>
              <div className="space-y-3">
                {/* Quick preset buttons */}
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date();
                      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                      setStartDate(firstDay.toISOString().split('T')[0]);
                      setEndDate(lastDay.toISOString().split('T')[0]);
                    }}
                  >
                    This Month
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date();
                      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
                      setStartDate(firstDay.toISOString().split('T')[0]);
                      setEndDate(lastDay.toISOString().split('T')[0]);
                    }}
                  >
                    Last Month
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date();
                      const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 2, 1);
                      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                      setStartDate(threeMonthsAgo.toISOString().split('T')[0]);
                      setEndDate(lastDay.toISOString().split('T')[0]);
                    }}
                  >
                    Last 3 Months
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date();
                      const yearStart = new Date(today.getFullYear(), 0, 1);
                      const yearEnd = new Date(today.getFullYear(), 11, 31);
                      setStartDate(yearStart.toISOString().split('T')[0]);
                      setEndDate(yearEnd.toISOString().split('T')[0]);
                    }}
                  >
                    This Year
                  </Button>
                </div>
                
                {/* Custom date inputs */}
                <div className="flex flex-col sm:flex-row gap-4 max-w-lg mx-auto">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                
                {/* Display selected range */}
                {startDate && endDate && (
                  <div className="text-center text-sm text-muted-foreground">
                    Selected: {format(new Date(startDate), "MMM d, yyyy")} - {format(new Date(endDate), "MMM d, yyyy")}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => {
                setClientSearch('');
                setStartDate(firstDayOfMonth.toISOString().split('T')[0]);
                setEndDate(lastDayOfMonth.toISOString().split('T')[0]);
                setSelectedStatus('all');
                setSelectedTherapist('all');
                setSelectedService('all');
                setSelectedClientType('all');
              }}
            >
              Reset Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Billing Records Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Billing Records</span>
            {isFetching && !isLoading && (
              <span className="text-sm font-normal text-muted-foreground">Refreshing...</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto relative">
            {isFetching && !isLoading && (
              <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 pointer-events-none" />
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Therapist</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBillingRecords.map((record: any) => {
                  const billing = record.billing || record;
                  const session = record.session || {};
                  const client = record.client || {};
                  const therapist = record.therapist || {};
                  return (
                    <TableRow key={billing.id}>
                      <TableCell className="font-medium">
                        <div>
                          <Link 
                            href={`/clients/${client.id}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {client.fullName || 'Unknown Client'}
                          </Link>
                          <div className="text-xs text-muted-foreground">{client.referenceNumber}</div>
                        </div>
                      </TableCell>
                      <TableCell>{billing.serviceCode}</TableCell>
                      <TableCell>
                        {session.sessionDate 
                          ? format(new Date(session.sessionDate), 'MMM dd, yyyy')
                          : 'N/A'
                        }
                      </TableCell>
                      <TableCell>{therapist.fullName || 'N/A'}</TableCell>
                      <TableCell>${Number(billing.totalAmount).toFixed(2)}</TableCell>
                      <TableCell>${Number(billing.paymentAmount || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge className={getStatusBadgeColor(billing.paymentStatus)}>
                          {getStatusIcon(billing.paymentStatus)}
                          <span className="ml-1 capitalize">{billing.paymentStatus}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {/* Simplified action layout: One primary button + One menu */}
                        <div className="flex items-center gap-2">
                          {/* Single Primary Action Button - Most important next step */}
                          {billing.paymentStatus === 'pending' ? (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleRecordPayment(billing)}
                              data-testid={`button-pay-${billing.id}`}
                            >
                              <CreditCard className="h-3 w-3 mr-1" />
                              Pay
                            </Button>
                          ) : billing.paymentStatus === 'paid' ? (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleInvoiceAction('preview', billing, client)}
                              data-testid={`button-preview-${billing.id}`}
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Preview
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleRecordPayment(billing)}
                              data-testid={`button-pay-${billing.id}`}
                            >
                              <CreditCard className="h-3 w-3 mr-1" />
                              Pay
                            </Button>
                          )}

                          {/* Single Menu - All other actions organized */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" data-testid={`button-menu-${billing.id}`}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">
                                Invoice Actions
                              </div>
                              {billing.paymentStatus === 'pending' && (
                                <>
                                  <DropdownMenuItem onClick={() => handleInvoiceAction('email', billing, client)}>
                                    <Mail className="h-4 w-4 mr-2" />
                                    Email Invoice
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleInvoiceAction('preview', billing, client)}>
                                    <Eye className="h-4 w-4 mr-2" />
                                    Preview Invoice
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleInvoiceAction('download', billing, client)}>
                                    <Download className="h-4 w-4 mr-2" />
                                    Download Invoice
                                  </DropdownMenuItem>
                                </>
                              )}
                              {billing.paymentStatus === 'paid' && (
                                <>
                                  <DropdownMenuItem onClick={() => handleInvoiceAction('download', billing, client)}>
                                    <Download className="h-4 w-4 mr-2" />
                                    Download Invoice
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleInvoiceAction('email', billing, client)}>
                                    <Mail className="h-4 w-4 mr-2" />
                                    Email Invoice
                                  </DropdownMenuItem>
                                </>
                              )}
                              {billing.paymentStatus !== 'pending' && billing.paymentStatus !== 'paid' && (
                                <>
                                  <DropdownMenuItem onClick={() => handleRecordPayment(billing)}>
                                    <CreditCard className="h-4 w-4 mr-2" />
                                    Record Payment
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleInvoiceAction('email', billing, client)}>
                                    <Mail className="h-4 w-4 mr-2" />
                                    Email Invoice
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleInvoiceAction('preview', billing, client)}>
                                    <Eye className="h-4 w-4 mr-2" />
                                    Preview Invoice
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleInvoiceAction('download', billing, client)}>
                                    <Download className="h-4 w-4 mr-2" />
                                    Download Invoice
                                  </DropdownMenuItem>
                                </>
                              )}
                              <div className="border-t my-1"></div>
                              <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">
                                Change Status
                              </div>
                              <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: billing.id, status: 'pending' })}>
                                <Clock className="h-4 w-4 mr-2 text-yellow-600" />
                                Mark Pending
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: billing.id, status: 'billed' })}>
                                <FileText className="h-4 w-4 mr-2 text-blue-600" />
                                Mark Billed
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: billing.id, status: 'paid' })}>
                                <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                                Mark Paid
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: billing.id, status: 'denied' })}>
                                <AlertTriangle className="h-4 w-4 mr-2 text-red-600" />
                                Mark Denied
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: billing.id, status: 'follow_up' })}>
                                <Eye className="h-4 w-4 mr-2 text-orange-600" />
                                Mark Follow Up
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filteredBillingRecords.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Records Found</h3>
                <p className="text-sm max-w-sm mx-auto">
                  No billing records match your current filters. Try adjusting the date range or other filters.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment Dialog */}
      <PaymentDialog
        isOpen={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        billingRecord={selectedBillingRecord}
        onPaymentRecorded={() => {
          setSelectedBillingRecord(null);
        }}
      />
        </div>
      </div>
    </div>
  );
}