import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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
  Edit
} from "lucide-react";
import { format } from "date-fns";

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
  paymentStatus: 'pending' | 'billed' | 'paid' | 'denied' | 'refunded';
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
      const response = await fetch(`/api/billing/${billingRecord?.id}/payment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to record payment');
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
      paymentAmount: parseFloat(paymentAmount),
      paymentMethod,
      paymentReference,
      paymentNotes,
      paymentDate: new Date().toISOString().split('T')[0]
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
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedTherapist, setSelectedTherapist] = useState<string>('all');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedBillingRecord, setSelectedBillingRecord] = useState<BillingRecord | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch billing data
  const { data: billingData, isLoading } = useQuery({
    queryKey: ['/api/billing/reports'],
    queryFn: async () => {
      const response = await fetch('/api/billing/reports');
      if (!response.ok) throw new Error('Failed to fetch billing data');
      return response.json();
    }
  });

  // Fetch therapists for filter
  const { data: therapists } = useQuery({
    queryKey: ['/api/users'],
    queryFn: async () => {
      const response = await fetch('/api/users?role=therapist');
      if (!response.ok) throw new Error('Failed to fetch therapists');
      return response.json();
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ billingId, status }: { billingId: number; status: string }) => {
      const response = await fetch(`/api/billing/${billingId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error('Failed to update status');
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
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const filteredBillingRecords = billingData?.billingRecords?.filter((record: BillingRecord) => {
    const statusMatch = selectedStatus === 'all' || record.paymentStatus === selectedStatus;
    const therapistMatch = selectedTherapist === 'all' || record.session?.therapist?.id.toString() === selectedTherapist;
    return statusMatch && therapistMatch;
  }) || [];

  const summaryStats = {
    totalOutstanding: filteredBillingRecords
      .filter((r: BillingRecord) => r.paymentStatus === 'pending' || r.paymentStatus === 'billed')
      .reduce((sum: number, r: BillingRecord) => sum + (Number(r.totalAmount) - Number(r.paymentAmount || 0)), 0),
    totalPaid: filteredBillingRecords
      .filter((r: BillingRecord) => r.paymentStatus === 'paid')
      .reduce((sum: number, r: BillingRecord) => sum + Number(r.paymentAmount || 0), 0),
    pendingCount: filteredBillingRecords.filter((r: BillingRecord) => r.paymentStatus === 'pending').length,
    paidCount: filteredBillingRecords.filter((r: BillingRecord) => r.paymentStatus === 'paid').length,
  };

  const handleRecordPayment = (record: BillingRecord) => {
    setSelectedBillingRecord(record);
    setPaymentDialogOpen(true);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Billing Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
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
              {new Set(filteredBillingRecords.map((r: BillingRecord) => r.session?.client?.id)).size}
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
            <div className="text-2xl font-bold">{filteredBillingRecords.length}</div>
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
          <div className="flex gap-4">
            <div className="flex-1">
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
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label htmlFor="therapist-filter">Therapist</Label>
              <Select value={selectedTherapist} onValueChange={setSelectedTherapist}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Therapists</SelectItem>
                  {therapists?.map((therapist: any) => (
                    <SelectItem key={therapist.id} value={therapist.id.toString()}>
                      {therapist.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing Records Table */}
      <Card>
        <CardHeader>
          <CardTitle>Billing Records</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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
                {filteredBillingRecords.map((record: BillingRecord) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">
                      {record.session?.client?.fullName || 'Unknown Client'}
                    </TableCell>
                    <TableCell>{record.serviceCode}</TableCell>
                    <TableCell>
                      {record.session?.sessionDate 
                        ? format(new Date(record.session.sessionDate), 'MMM dd, yyyy')
                        : 'N/A'
                      }
                    </TableCell>
                    <TableCell>{record.session?.therapist?.fullName || 'N/A'}</TableCell>
                    <TableCell>${Number(record.totalAmount).toFixed(2)}</TableCell>
                    <TableCell>${Number(record.paymentAmount || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge className={getStatusBadgeColor(record.paymentStatus)}>
                        {getStatusIcon(record.paymentStatus)}
                        <span className="ml-1 capitalize">{record.paymentStatus}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {record.paymentStatus === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRecordPayment(record)}
                          >
                            <CreditCard className="h-3 w-3 mr-1" />
                            Pay
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost">
                              <Edit className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: record.id, status: 'pending' })}>
                              Mark Pending
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: record.id, status: 'billed' })}>
                              Mark Billed
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: record.id, status: 'paid' })}>
                              Mark Paid
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ billingId: record.id, status: 'denied' })}>
                              Mark Denied
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredBillingRecords.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No billing records found with current filters.
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
  );
}