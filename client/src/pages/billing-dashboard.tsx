import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  MoreVertical,
  Printer,
  HelpCircle,
  ChevronDown,
  TicketPercent,
  Percent
} from "lucide-react";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { formatDateDisplay } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { PracticeHeader } from "@/components/shared/practice-header";

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
  discountType?: string;
  discountValue?: number;
  discountAmount?: number;
  createdAt: string;
  updatedAt: string;
  session?: {
    id: number;
    clientId: number;
    therapistId: number;
    serviceId: number;
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
  const today = new Date().toISOString().split('T')[0];

  // Client payment fields
  const [clientAmount, setClientAmount] = useState('');
  const [clientDate, setClientDate] = useState(today);
  const [clientMethod, setClientMethod] = useState('');
  const [clientReference, setClientReference] = useState('');

  // Insurance payment fields
  const [insAmount, setInsAmount] = useState('');
  const [insDate, setInsDate] = useState(today);
  const [insMethod, setInsMethod] = useState('insurance');
  const [insReference, setInsReference] = useState('');

  const [paymentNotes, setPaymentNotes] = useState('');
  const [confirmOverpay, setConfirmOverpay] = useState(false);
  const [voidTargetId, setVoidTargetId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canVoid = ['administrator', 'admin', 'supervisor', 'accountant', 'billing']
    .includes((user?.role || '').toLowerCase());

  const discountAmount = useMemo(() => {
    if (!billingRecord?.discountAmount) return 0;
    return Number(billingRecord.discountAmount);
  }, [billingRecord?.discountAmount]);

  const amountAfterDiscount = useMemo(() => {
    if (!billingRecord?.totalAmount) return 0;
    return Number(billingRecord.totalAmount) - discountAmount;
  }, [billingRecord?.totalAmount, discountAmount]);

  const hasKnownCopay = billingRecord?.copayAmount != null && !isNaN(Number(billingRecord.copayAmount));
  const hasInsurance = !!billingRecord?.insuranceCovered || (hasKnownCopay && Number(billingRecord?.copayAmount) > 0);
  const copayValue = hasKnownCopay ? Number(billingRecord.copayAmount) : 0;
  const clientPortion = hasInsurance && hasKnownCopay ? copayValue : amountAfterDiscount;
  const insurancePortion = hasInsurance && hasKnownCopay ? Math.max(amountAfterDiscount - copayValue, 0) : 0;
  const clientAlreadyPaid = Number(billingRecord?.clientPaidAmount || 0);
  const insuranceAlreadyPaid = Number(billingRecord?.insurancePaidAmount || 0);
  const alreadyPaid = Number(billingRecord?.paymentAmount || 0) || (clientAlreadyPaid + insuranceAlreadyPaid);
  const clientRemaining = Math.max(clientPortion - clientAlreadyPaid, 0);
  const insuranceRemaining = Math.max(insurancePortion - insuranceAlreadyPaid, 0);
  const remainingDue = Math.max(amountAfterDiscount - alreadyPaid, 0);

  // Reset fields when dialog reopens
  useEffect(() => {
    if (isOpen && billingRecord) {
      // Pre-suggest amounts only when copay split is known. Otherwise leave blank.
      setClientAmount(hasInsurance && hasKnownCopay && clientRemaining > 0 ? clientRemaining.toFixed(2) : '');
      setInsAmount(hasInsurance && hasKnownCopay && insuranceRemaining > 0 ? insuranceRemaining.toFixed(2) : '');
      setClientDate(today);
      setInsDate(today);
      setClientMethod('');
      setInsMethod('insurance');
      setClientReference('');
      setInsReference('');
      setPaymentNotes('');
      setConfirmOverpay(false);
    }
  }, [isOpen, billingRecord]);

  const { data: transactions = [] } = useQuery<any[]>({
    queryKey: ['/api/billing', billingRecord?.id, 'transactions'],
    enabled: isOpen && !!billingRecord?.id,
  });

  const voidMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const response = await apiRequest(`/api/payment-transactions/${id}/void`, 'POST', { reason });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Payment voided", description: "Totals updated automatically" });
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['/api/billing', billingRecord?.id, 'transactions'] });
      setVoidTargetId(null);
      setVoidReason('');
      onPaymentRecorded();
    },
    onError: (err: any) => {
      toast({ title: "Could not void payment", description: err?.message || 'Error', variant: "destructive" });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const { apiRequest } = await import('@/lib/queryClient');
      const response = await apiRequest(`/api/billing/${billingRecord?.id}/payment`, 'PUT', data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Payment recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['/api/billing', billingRecord?.id, 'transactions'] });
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

  const clientAmountNum = parseFloat(clientAmount || '0') || 0;
  const insAmountNum = parseFloat(insAmount || '0') || 0;
  const hasClientPayment = clientAmountNum > 0;
  const hasInsPayment = insAmountNum > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clientId = billingRecord?.session?.clientId;
    if (!clientId) {
      toast({ title: "Error: Missing client information", variant: "destructive" });
      return;
    }
    if (!hasClientPayment && !hasInsPayment) {
      toast({ title: "Enter at least one payment", description: "Fill in the Client side, Insurance side, or both.", variant: "destructive" });
      return;
    }
    if (hasClientPayment && (!clientMethod || !clientDate)) {
      toast({ title: "Client payment incomplete", description: "Method and date are required.", variant: "destructive" });
      return;
    }
    if (hasInsPayment && (!insMethod || !insDate)) {
      toast({ title: "Insurance payment incomplete", description: "Method and date are required.", variant: "destructive" });
      return;
    }

    const fullBillAmount = amountAfterDiscount;

    try {
      const { apiRequest } = await import('@/lib/queryClient');

      // Record client payment first (if any)
      if (hasClientPayment) {
        const cumulative = +(clientAlreadyPaid + clientAmountNum).toFixed(2);
        const totalAfter = alreadyPaid + clientAmountNum + (hasInsPayment ? insAmountNum : 0);
        await apiRequest(`/api/billing/${billingRecord?.id}/payment`, 'PUT', {
          status: totalAfter >= fullBillAmount ? 'paid' : 'billed',
          amount: cumulative,
          source: 'client',
          method: clientMethod,
          reference: clientReference,
          notes: paymentNotes,
          date: clientDate,
          clientId,
        });
      }

      // Then insurance payment (if any)
      if (hasInsPayment) {
        const cumulative = +(insuranceAlreadyPaid + insAmountNum).toFixed(2);
        const totalAfter = alreadyPaid + insAmountNum + (hasClientPayment ? clientAmountNum : 0);
        await apiRequest(`/api/billing/${billingRecord?.id}/payment`, 'PUT', {
          status: totalAfter >= fullBillAmount ? 'paid' : 'billed',
          amount: cumulative,
          source: 'insurance',
          method: insMethod,
          reference: insReference,
          notes: paymentNotes,
          date: insDate,
          clientId,
        });
      }

      const both = hasClientPayment && hasInsPayment;
      toast({ title: both ? "2 payments recorded" : "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['/api/billing', billingRecord?.id, 'transactions'] });
      onPaymentRecorded();
      onClose();
    } catch (err: any) {
      toast({ title: "Error recording payment", description: err?.message || 'Failed', variant: "destructive" });
    }
  };

  const isSubmitting = recordPaymentMutation.isPending;

  if (!billingRecord) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            {billingRecord.session?.client?.fullName} - {billingRecord.serviceCode}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount Summary Section */}
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">Service Amount</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">${Number(billingRecord.totalAmount || 0).toFixed(2)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex items-center justify-between text-sm text-green-700 dark:text-green-500">
                <span>Discount Applied</span>
                <span className="font-semibold">-${discountAmount.toFixed(2)}</span>
              </div>
            )}
            {(clientAlreadyPaid > 0 || insuranceAlreadyPaid > 0) && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Payments Received</div>
                {clientAlreadyPaid > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-300">From Client</span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      ${clientAlreadyPaid.toFixed(2)} ✓
                    </span>
                  </div>
                )}
                {insuranceAlreadyPaid > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-700 dark:text-blue-400">From Insurance</span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      ${insuranceAlreadyPaid.toFixed(2)} ✓
                    </span>
                  </div>
                )}
              </div>
            )}
            {hasInsurance && hasKnownCopay && (
              <div className="text-xs italic text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                Expected split: Client copay ${copayValue.toFixed(2)} · Insurance ${insurancePortion.toFixed(2)}
              </div>
            )}
            {hasInsurance && !hasKnownCopay && (
              <div className="text-xs italic text-amber-700 dark:text-amber-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                Insurance on file — copay not set on client profile
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
              <span className="font-medium text-slate-900 dark:text-slate-100">Total Amount Due</span>
              <span className="font-bold text-lg text-slate-900 dark:text-slate-100">${remainingDue.toFixed(2)}</span>
            </div>
          </div>

          {transactions.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span>Payment History</span>
                <span className="text-slate-400">{transactions.length} {transactions.length === 1 ? 'entry' : 'entries'}</span>
              </div>
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {transactions.map((tx: any) => {
                  const voided = !!tx.voidedAt;
                  const isClient = tx.source === 'client';
                  return (
                    <div key={tx.id} className={`px-3 py-2 text-xs flex items-center justify-between gap-2 ${voided ? 'opacity-50' : ''}`} data-testid={`payment-tx-${tx.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${voided ? 'line-through' : ''} ${isClient ? 'text-slate-700 dark:text-slate-300' : 'text-blue-700 dark:text-blue-400'}`}>
                            {isClient ? 'Client' : 'Insurance'}
                          </span>
                          {tx.isHistoricalLump && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Historical total</span>
                          )}
                          {voided && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800" title={tx.voidReason || ''}>Voided</span>
                          )}
                        </div>
                        <div className={`text-slate-500 dark:text-slate-400 truncate ${voided ? 'line-through' : ''}`}>
                          {tx.paymentDate
                            ? new Date(tx.paymentDate).toLocaleDateString()
                            : new Date(tx.recordedAt).toLocaleDateString()}
                          {tx.paymentMethod ? ` · ${tx.paymentMethod}` : ''}
                          {tx.referenceNumber ? ` · ${tx.referenceNumber}` : ''}
                        </div>
                        {tx.paymentDate && new Date(tx.paymentDate).toDateString() !== new Date(tx.recordedAt).toDateString() && (
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">
                            Entered {new Date(tx.recordedAt).toLocaleDateString()}
                          </div>
                        )}
                        {voided && tx.voidReason && (
                          <div className="text-[10px] text-red-600 dark:text-red-400 italic mt-0.5">Voided: {tx.voidReason}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`font-semibold tabular-nums ${voided ? 'line-through text-slate-400' : Number(tx.amount) < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                          {Number(tx.amount) < 0 ? '-' : '+'}${Math.abs(Number(tx.amount)).toFixed(2)}
                        </div>
                        {!voided && canVoid && (
                          <button
                            type="button"
                            onClick={() => { setVoidTargetId(tx.id); setVoidReason(''); }}
                            className="text-[10px] px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:hover:bg-red-950 transition-colors"
                            data-testid={`void-payment-${tx.id}`}
                            title="Void this payment"
                          >
                            Void
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fill in <strong>one or both</strong> sides. Each side has its own date — perfect for when the client paid today and insurance paid weeks earlier (or vice versa).
          </p>

          {/* CLIENT SIDE */}
          <div className={`border-2 rounded-lg p-4 space-y-3 ${
            hasInsurance && hasKnownCopay && clientRemaining === 0
              ? 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30'
              : 'border-slate-200 dark:border-slate-700'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                Client Payment
                {hasInsurance && hasKnownCopay && clientPortion === 0 && (
                  <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    No client portion expected
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {hasInsurance && hasKnownCopay
                  ? `Owes $${clientRemaining.toFixed(2)}`
                  : `Up to $${remainingDue.toFixed(2)}`}
                {clientAlreadyPaid > 0 && ` · Already paid $${clientAlreadyPaid.toFixed(2)}`}
              </div>
            </div>
            {hasInsurance && hasKnownCopay && clientPortion === 0 && (
              <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                Insurance covers 100% of this bill — no copay expected from client. Only fill in this section if you collected a payment anyway (e.g., overpayment, deposit).
              </p>
            )}
            {hasClientPayment && hasKnownCopay && clientAmountNum > clientRemaining && clientPortion > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                ⚠ ${clientAmountNum.toFixed(2)} exceeds expected client portion of ${clientRemaining.toFixed(2)} (${(clientAmountNum - clientRemaining).toFixed(2)} over). Continue only if intentional.
              </p>
            )}
            {hasClientPayment && hasKnownCopay && clientPortion === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                ⚠ Client is not expected to pay anything. Recording ${clientAmountNum.toFixed(2)} anyway — please confirm this is intentional.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="clientAmount" className="text-xs">Amount</Label>
                <Input
                  id="clientAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={clientAmount}
                  onChange={(e) => setClientAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="client-amount-input"
                />
              </div>
              <div>
                <Label htmlFor="clientDate" className="text-xs">Date Received</Label>
                <Input
                  id="clientDate"
                  type="date"
                  value={clientDate}
                  onChange={(e) => setClientDate(e.target.value)}
                  max={today}
                  disabled={!hasClientPayment}
                  data-testid="client-date-input"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="clientMethod" className="text-xs">Method</Label>
                <Select value={clientMethod} onValueChange={setClientMethod} disabled={!hasClientPayment}>
                  <SelectTrigger id="clientMethod" data-testid="client-method-select">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                    <SelectItem value="debit_card">Debit Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="online_payment">Online Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="clientReference" className="text-xs">Reference</Label>
                <Input
                  id="clientReference"
                  value={clientReference}
                  onChange={(e) => setClientReference(e.target.value)}
                  placeholder="Check #, txn ID..."
                  disabled={!hasClientPayment}
                />
              </div>
            </div>
          </div>

          {/* INSURANCE SIDE */}
          <div className={`border-2 rounded-lg p-4 space-y-3 ${
            !hasInsurance
              ? 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30'
              : 'border-blue-100 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/20'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                Insurance Payment
                {!hasInsurance && (
                  <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                    Self-pay (no insurance)
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {hasInsurance && hasKnownCopay
                  ? `Owes $${insuranceRemaining.toFixed(2)}`
                  : hasInsurance
                    ? `Up to $${remainingDue.toFixed(2)}`
                    : 'Not expected'}
                {insuranceAlreadyPaid > 0 && ` · Already paid $${insuranceAlreadyPaid.toFixed(2)}`}
              </div>
            </div>
            {!hasInsurance && (
              <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                This client has no insurance on file. Only fill in this section if you actually received an insurance payment.
              </p>
            )}
            {hasInsPayment && hasKnownCopay && hasInsurance && insAmountNum > insuranceRemaining && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                ⚠ ${insAmountNum.toFixed(2)} exceeds expected insurance portion of ${insuranceRemaining.toFixed(2)} (${(insAmountNum - insuranceRemaining).toFixed(2)} over). Continue only if intentional.
              </p>
            )}
            {hasInsPayment && !hasInsurance && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                ⚠ No insurance is on file for this client. Recording an insurance payment anyway — please confirm.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="insAmount" className="text-xs">Amount</Label>
                <Input
                  id="insAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={insAmount}
                  onChange={(e) => setInsAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="insurance-amount-input"
                />
              </div>
              <div>
                <Label htmlFor="insDate" className="text-xs">Date Received</Label>
                <Input
                  id="insDate"
                  type="date"
                  value={insDate}
                  onChange={(e) => setInsDate(e.target.value)}
                  max={today}
                  disabled={!hasInsPayment}
                  data-testid="insurance-date-input"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="insMethod" className="text-xs">Method</Label>
                <Select value={insMethod} onValueChange={setInsMethod} disabled={!hasInsPayment}>
                  <SelectTrigger id="insMethod" data-testid="insurance-method-select">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="insurance">Insurance EOB</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer (EFT)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="insReference" className="text-xs">EOB / Check #</Label>
                <Input
                  id="insReference"
                  value={insReference}
                  onChange={(e) => setInsReference(e.target.value)}
                  placeholder="EOB number, check..."
                  disabled={!hasInsPayment}
                />
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="paymentNotes" className="text-xs">Notes (applies to both)</Label>
            <Textarea
              id="paymentNotes"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
            />
          </div>

          {(() => {
            const enteredTotal = clientAmountNum + insAmountNum;
            const projectedTotal = alreadyPaid + enteredTotal;
            const overpayBy = projectedTotal - amountAfterDiscount;
            const isOverpay = overpayBy > 0.009;
            const showSummary = hasClientPayment || hasInsPayment;
            return showSummary ? (
              <>
                <div className={`rounded-md p-3 text-sm border ${
                  isOverpay
                    ? 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800'
                    : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                }`}>
                  <div className={`font-semibold ${isOverpay ? 'text-red-900 dark:text-red-200' : 'text-emerald-900 dark:text-emerald-200'}`}>
                    Recording {hasClientPayment && hasInsPayment ? '2 payments' : '1 payment'}
                  </div>
                  <div className={`text-xs mt-1 space-y-0.5 ${isOverpay ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {hasClientPayment && <div>• Client: ${clientAmountNum.toFixed(2)} on {clientDate}</div>}
                    {hasInsPayment && <div>• Insurance: ${insAmountNum.toFixed(2)} on {insDate}</div>}
                    <div className="pt-1 mt-1 border-t border-current/20 font-semibold">
                      Bill total: ${amountAfterDiscount.toFixed(2)}
                      {alreadyPaid > 0 && ` · Already paid: $${alreadyPaid.toFixed(2)}`}
                      {' · '}New total: ${projectedTotal.toFixed(2)}
                    </div>
                    {isOverpay && (
                      <div className="font-bold mt-1">
                        ⚠ OVERPAYMENT: ${overpayBy.toFixed(2)} more than the bill amount.
                      </div>
                    )}
                    {!isOverpay && (
                      <div className="font-medium">
                        Bill becomes {projectedTotal >= amountAfterDiscount - 0.009 ? 'PAID' : 'partially billed'}
                      </div>
                    )}
                  </div>
                </div>

                {isOverpay && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800">
                    <input
                      type="checkbox"
                      id="confirmOverpay"
                      checked={confirmOverpay}
                      onChange={(e) => setConfirmOverpay(e.target.checked)}
                      className="mt-0.5 h-4 w-4 cursor-pointer"
                      data-testid="confirm-overpay-checkbox"
                    />
                    <label htmlFor="confirmOverpay" className="text-xs text-amber-900 dark:text-amber-200 cursor-pointer leading-relaxed">
                      I confirm this overpayment of <strong>${overpayBy.toFixed(2)}</strong> is intentional
                      (e.g., advance deposit, prepayment for future sessions, or amount to be refunded later).
                    </label>
                  </div>
                )}

                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      (!hasClientPayment && !hasInsPayment) ||
                      (isOverpay && !confirmOverpay)
                    }
                    variant={isOverpay ? 'destructive' : 'default'}
                    data-testid="record-payment-submit"
                  >
                    {isSubmitting
                      ? 'Recording...'
                      : isOverpay
                        ? `Record Overpayment ($${overpayBy.toFixed(2)} extra)`
                        : hasClientPayment && hasInsPayment
                          ? 'Record Both Payments'
                          : 'Record Payment'}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled data-testid="record-payment-submit">
                  Record Payment
                </Button>
              </DialogFooter>
            );
          })()}
        </form>

        <Dialog open={voidTargetId !== null} onOpenChange={(o) => !o && setVoidTargetId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Void this payment?</DialogTitle>
              <DialogDescription>
                The payment will be marked as voided and totals will be recalculated automatically. This action is logged for audit.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="voidReason">Reason (required) *</Label>
              <Textarea
                id="voidReason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g., Recorded by mistake, check bounced, refunded to client..."
                rows={3}
                data-testid="void-reason-input"
              />
              <p className="text-xs text-slate-500">Minimum 3 characters. This reason will appear in the payment history.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setVoidTargetId(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={voidReason.trim().length < 3 || voidMutation.isPending}
                onClick={() => voidTargetId && voidMutation.mutate({ id: voidTargetId, reason: voidReason })}
                data-testid="confirm-void-button"
              >
                {voidMutation.isPending ? 'Voiding...' : 'Confirm Void'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function ApplyDiscountDialog({ 
  isOpen, 
  onClose, 
  billingRecord, 
  onDiscountApplied 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  billingRecord: BillingRecord | null;
  onDiscountApplied: () => void;
}) {
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed' | 'none'>('none');
  const [discountValue, setDiscountValue] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const discountAmount = useMemo(() => {
    if (discountType === 'none' || !discountValue || !billingRecord?.totalAmount) return 0;
    const value = parseFloat(discountValue);
    if (isNaN(value) || value <= 0) return 0;
    
    if (discountType === 'percentage') {
      return (Number(billingRecord.totalAmount) * value) / 100;
    } else {
      return value;
    }
  }, [discountType, discountValue, billingRecord?.totalAmount]);

  useEffect(() => {
    if (isOpen && billingRecord) {
      setDiscountType((billingRecord.discountType === 'percentage' || billingRecord.discountType === 'fixed' ? billingRecord.discountType : 'none') as 'none' | 'percentage' | 'fixed');
      setDiscountValue(billingRecord.discountValue?.toString() || '');
    }
  }, [isOpen, billingRecord]);

  const applyDiscountMutation = useMutation({
    mutationFn: async (data: { discountType: string | null; discountValue: number | null; discountAmount: number | null }) => {
      if (!billingRecord) return;
      return apiRequest(`/api/billing/${billingRecord.id}/discount`, 'PATCH', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      toast({
        title: "Discount Applied",
        description: "The discount has been applied to the invoice successfully.",
      });
      onDiscountApplied();
      onClose();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to apply discount. Please try again.",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    applyDiscountMutation.mutate({
      discountType: discountType !== 'none' ? discountType : null,
      discountValue: (discountType !== 'none' && discountValue) ? parseFloat(discountValue) : null,
      discountAmount: (discountType !== 'none' && discountAmount > 0) ? discountAmount : null
    });
  };

  if (!billingRecord) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply Discount</DialogTitle>
          <DialogDescription>
            {billingRecord.session?.client?.fullName} - {billingRecord.serviceCode}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">Service Amount</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">${Number(billingRecord.totalAmount || 0).toFixed(2)}</span>
            </div>
            {discountAmount > 0 && (
              <>
                <div className="flex items-center justify-between text-sm text-green-700 dark:text-green-500">
                  <span>Discount</span>
                  <span className="font-semibold">-${discountAmount.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="font-medium text-slate-900 dark:text-slate-100">Amount After Discount</span>
                  <span className="font-bold text-lg text-slate-900 dark:text-slate-100">${(Number(billingRecord.totalAmount || 0) - discountAmount).toFixed(2)}</span>
                </div>
              </>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="discountType">Discount Type</Label>
                <Select value={discountType} onValueChange={(value: any) => {
                  setDiscountType(value);
                  if (value === 'none') {
                    setDiscountValue('');
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="No discount" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No discount</SelectItem>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                    <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="discountValue">
                  {discountType === 'percentage' ? 'Percentage' : 'Amount'}
                </Label>
                <Input
                  id="discountValue"
                  type="number"
                  step={discountType === 'percentage' ? '1' : '0.01'}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === 'percentage' ? '10' : '0.00'}
                  disabled={discountType === 'none'}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={applyDiscountMutation.isPending}>
              {applyDiscountMutation.isPending ? 'Applying...' : 'Apply Discount'}
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
  
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedTherapist, setSelectedTherapist] = useState<string>('all');
  const [selectedService, setSelectedService] = useState<string>('all');
  const [selectedClientType, setSelectedClientType] = useState<string>('all');
  const [selectedSessionStatus, setSelectedSessionStatus] = useState<string>('all');
  const [clientSearch, setClientSearch] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(firstDayOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(lastDayOfMonth.toISOString().split('T')[0]);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);
  const [isInvoicePreviewOpen, setIsInvoicePreviewOpen] = useState(false);
  const [selectedBillingRecord, setSelectedBillingRecord] = useState<BillingRecord | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Fetch billing data with role-based filtering and default current month range
  const { data: billingData, isLoading, isFetching } = useQuery({
    queryKey: ['billing', 'reports', user?.id, startDate, endDate, selectedStatus, selectedTherapist, selectedService, selectedClientType, selectedSessionStatus],
    queryFn: async () => {
      let url = '/api/billing/reports';
      const params = new URLSearchParams();
      
      // Add all filters to server-side query
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (selectedStatus !== 'all') params.append('status', selectedStatus);
      if (selectedService !== 'all') params.append('serviceCode', selectedService);
      if (selectedClientType !== 'all') params.append('clientType', selectedClientType);
      if (selectedSessionStatus !== 'all') params.append('sessionStatus', selectedSessionStatus);
      
      // Role-based therapist filtering
      if (user?.role === 'therapist') {
        // Therapists always see only their own billing
        params.append('therapistId', user.id.toString());
      } else if (user?.role === 'supervisor') {
        // Supervisors: backend handles filtering to their assigned therapists.
        // Optionally pass a specific therapist filter chosen from the dropdown.
        if (selectedTherapist !== 'all') {
          params.append('therapistId', selectedTherapist);
        }
      } else {
        // Admin / accountant: can filter by any therapist
        if (selectedTherapist !== 'all') {
          params.append('therapistId', selectedTherapist);
        }
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
    queryKey: [user?.role === 'administrator' || user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'clinical_supervisor' ? "/api/services" : "/api/services/filtered"],
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
      queryClient.invalidateQueries({ queryKey: ['billing'] });
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
  
  // Client-side filtering by client name (instant, no API calls)
  const filteredBillingRecords = allBillingRecords.filter((record: any) => {
    if (!clientSearch.trim()) return true;
    const client = record.client || {};
    const clientName = (client.fullName || '').toLowerCase();
    const searchLower = clientSearch.toLowerCase();
    return clientName.includes(searchLower);
  });

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
        const total = Number(billing.totalAmount || 0);
        const discount = Number(billing.discountAmount || 0);
        const afterDiscount = Math.max(total - discount, 0);
        return sum + Math.max(afterDiscount - Number(billing.paymentAmount || 0), 0);
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

  const handleRecordPayment = (record: any) => {
    // Transform the record to match BillingRecord interface
    const billing = record.billing || record;
    const billingRecord: BillingRecord = {
      ...billing,
      session: record.session
    };
    setSelectedBillingRecord(billingRecord);
    setPaymentDialogOpen(true);
  };

  // Invoice action handlers using apiRequest (includes CSRF tokens automatically)
  const handleInvoiceAction = async (action: 'preview' | 'download' | 'email' | 'print', billing: any, client: any) => {
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

      // For preview or print, open in new browser tab (direct full page view)
      if (action === 'preview' || action === 'print') {
        const previewWindow = window.open('', '_blank');
        if (previewWindow) {
          const response = await apiRequest(`/api/clients/${client.id}/invoice`, 'POST', { 
            action: 'print', // Use print action to get HTML
            billingId: billing.id 
          });
          const htmlContent = await response.text();
          previewWindow.document.write(htmlContent);
          previewWindow.document.close();
          
          // Only trigger print dialog if action is print
          if (action === 'print') {
            previewWindow.focus();
            previewWindow.print();
          }
        }
        return;
      }

      // For download and email, use apiRequest
      const response = await apiRequest(`/api/clients/${client.id}/invoice`, 'POST', { 
        action, 
        billingId: billing.id 
      });

      if (action === 'download') {
        // Get HTML and open print dialog (matching session notes pattern)
        const html = await response.text();
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          setTimeout(() => {
            printWindow.print(); // Opens browser's print dialog where user can save as PDF
          }, 250);
        }
        
        toast({
          title: "Print dialog opened",
          description: "Use your browser's print dialog to save the invoice as PDF.",
        });
      } else if (action === 'email') {
        const result = await response.json();
        toast({
          title: "Email sent successfully!",
          description: result.message || `Invoice has been sent to ${client.email}`,
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
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Billing Dashboard</h1>
            <p className="text-slate-600 mt-1">Track invoices, payments, and billing status</p>
          </div>
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
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">Billing Dashboard</h1>
            {isFetching && !isLoading && (
              <Badge variant="outline" className="animate-pulse">
                <Clock className="h-3 w-3 mr-1" />
                Updating...
              </Badge>
            )}
          </div>
          <p className="text-slate-600 mt-1">Track invoices, payments, and billing status</p>
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

      {/* Help Section */}
      <Collapsible
        open={isHelpOpen}
        onOpenChange={setIsHelpOpen}
        className="mb-6"
      >
        <Card className="border-blue-200 bg-blue-50">
          <CollapsibleTrigger className="w-full">
            <CardHeader className="cursor-pointer hover:bg-blue-100 transition-colors rounded-t-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-blue-600" />
                  <CardTitle className="text-base">Billing & Invoice Management Guide</CardTitle>
                </div>
                <ChevronDown className={`w-5 h-5 text-blue-600 transition-transform ${isHelpOpen ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                <div>
                  <p className="font-medium text-sm">Automatic Billing Triggers</p>
                  <p className="text-xs text-gray-600">Billing records are automatically created when sessions are marked as "completed". The system calculates rates based on service type, session duration, and any applicable insurance coverage or copay amounts.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                <div>
                  <p className="font-medium text-sm">Payment Status Tracking</p>
                  <p className="text-xs text-gray-600">Track payments through six statuses: Pending (awaiting billing), Billed (invoice sent), Paid (payment received), Denied (insurance denial), Refunded (payment returned), and Follow-up (requires action). Color-coded badges make status easy to identify.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                <div>
                  <p className="font-medium text-sm">Recording Payments</p>
                  <p className="text-xs text-gray-600">Use "Record Payment" action on any billing record to log payments. Enter amount, payment method (cash, check, credit card, insurance), reference number, and notes. Payment details are automatically linked to client invoices and tracked in audit logs.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</div>
                <div>
                  <p className="font-medium text-sm">Invoice Management</p>
                  <p className="text-xs text-gray-600">Preview, download, email, or print invoices directly from the action menu (⋮). Invoices use professional templates with practice information, itemized charges, and payment instructions. Email invoices go to the client's registered email address.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">5</div>
                <div>
                  <p className="font-medium text-sm">Filtering & Reporting</p>
                  <p className="text-xs text-gray-600">Filter by payment status, therapist, service type, client type, or search by client name. Set date ranges to view specific periods. Therapists see only their own billing records; administrators see all records. Export reports for accounting or insurance submission.</p>
                </div>
              </div>
              <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                <p className="text-xs text-blue-900">
                  <strong>💡 Pro Tips:</strong> Outstanding balance shows pending and billed amounts. Summary cards update in real-time as you process payments. Use client search for quick access to specific billing records. All payment transactions are HIPAA-compliant and audit-logged for compliance.
                </p>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

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
          {/* Top Row: Basic Filters */}
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 ${user?.role === 'admin' || user?.role === 'administrator' ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
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
            {(user?.role === 'admin' || user?.role === 'administrator' || user?.role === 'accountant') && (
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
            <div>
              <Label htmlFor="session-status-filter">Session Type</Label>
              <Select value={selectedSessionStatus} onValueChange={setSelectedSessionStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sessions</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="no_show">No Show</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date Range Pickers */}
          <div className="border-t pt-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
              <div className="min-w-[180px]">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal mt-1"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {startDate ? format(new Date(startDate), 'MMM dd, yyyy') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={startDate ? new Date(startDate + 'T00:00:00') : undefined}
                      onSelect={(date) => {
                        if (date) {
                          const formattedDate = formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
                          setStartDate(formattedDate);
                        }
                      }}
                      onDayClick={(date) => {
                        const formattedDate = formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
                        setStartDate(formattedDate);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="min-w-[180px]">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal mt-1"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {endDate ? format(new Date(endDate), 'MMM dd, yyyy') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={endDate ? new Date(endDate + 'T00:00:00') : undefined}
                      onSelect={(date) => {
                        if (date) {
                          const formattedDate = formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
                          setEndDate(formattedDate);
                        }
                      }}
                      onDayClick={(date) => {
                        const formattedDate = formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
                        setEndDate(formattedDate);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              {/* Reset button */}
              <Button 
                variant="outline" 
                size="sm"
                className="whitespace-nowrap"
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
            
            {/* Display selected range */}
            {startDate && endDate && (
              <div className="mt-3 text-sm text-muted-foreground">
                Selected: {format(new Date(startDate), "MMM dd, yyyy")} - {format(new Date(endDate), "MMM dd, yyyy")}
              </div>
            )}
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
              <div className="absolute inset-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm z-10 pointer-events-none flex items-center justify-center">
                <div className="bg-white dark:bg-slate-800 px-4 py-2 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 animate-spin text-blue-600" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Loading billing data...</span>
                  </div>
                </div>
              </div>
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
                          <span
                            onClick={() => setLocation(`/clients/${client.id}?from=billing`)}
                            className="text-primary hover:underline cursor-pointer"
                          >
                            {client.fullName || 'Unknown Client'}
                          </span>
                          <div className="text-xs text-muted-foreground">{client.referenceNumber}</div>
                        </div>
                      </TableCell>
                      <TableCell>{billing.serviceCode}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {session.sessionDate 
                            ? formatDateDisplay(session.sessionDate)
                            : 'N/A'
                          }
                          {session.status === 'no_show' && (
                            <Badge className="text-xs px-1.5 py-0 h-5 bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-400 w-fit">
                              No Show
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{therapist.fullName || 'N/A'}</TableCell>
                      <TableCell>
                        {(() => {
                          const total = Number(billing.totalAmount || 0);
                          const discount = Number(billing.discountAmount || 0);
                          const afterDiscount = Math.max(total - discount, 0);
                          const hasKnownCopay = billing.copayAmount != null && !isNaN(Number(billing.copayAmount));
                          const hasInsurance = !!billing.insuranceCovered || (hasKnownCopay && Number(billing.copayAmount) > 0);
                          const paidAmt = Number(billing.paymentAmount || 0);
                          const clientDue = Math.max(afterDiscount - paidAmt, 0);
                          const hasCopay = hasInsurance;

                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold">${clientDue.toFixed(2)}</span>
                              {hasCopay && (
                                <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800 w-fit">
                                  Copay
                                </Badge>
                              )}
                              {discount > 0 && (
                                <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800 w-fit">
                                  <Percent className="h-3 w-3 mr-0.5" />
                                  Discount
                                </Badge>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
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
                              onClick={() => handleRecordPayment(record)}
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
                              onClick={() => handleRecordPayment(record)}
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
                                  <DropdownMenuItem onClick={() => handleRecordPayment(record)}>
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
                                Billing Actions
                              </div>
                              <DropdownMenuItem onClick={() => {
                                setSelectedBillingRecord(billing);
                                setDiscountDialogOpen(true);
                              }}>
                                <TicketPercent className="h-4 w-4 mr-2 text-green-600" />
                                Apply Discount
                              </DropdownMenuItem>
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

      {/* Apply Discount Dialog */}
      <ApplyDiscountDialog
        isOpen={discountDialogOpen}
        onClose={() => setDiscountDialogOpen(false)}
        billingRecord={selectedBillingRecord}
        onDiscountApplied={() => {
          setSelectedBillingRecord(null);
        }}
      />

      {/* Invoice Preview Dialog */}
      <Dialog open={isInvoicePreviewOpen} onOpenChange={setIsInvoicePreviewOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Invoice Preview</DialogTitle>
            <DialogDescription>
              {selectedBillingRecord && `Invoice for Service: ${selectedBillingRecord.serviceCode}`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto">
            <div className="p-8 bg-white border rounded-lg">
              {selectedBillingRecord && filteredBillingRecords.length > 0 && (() => {
                const record = filteredBillingRecords.find((r: any) => (r.billing?.id || r.id) === selectedBillingRecord.id);
                const client = record?.client || {};
                const billing = record?.billing || selectedBillingRecord;
                const session = record?.session || {};

                return (
                  <>
                    {/* Invoice Header */}
                    <div className="flex justify-between items-start mb-8">
                      <div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">INVOICE</h2>
                        <p className="text-slate-600">Invoice #: INV-{client.clientId}-{billing.id}</p>
                        <p className="text-slate-600">Invoice Date: {billing.billingDate ? formatDateDisplay(billing.billingDate) : 'N/A'}</p>
                        <p className="text-slate-600">Service Date: {billing.billingDate ? formatDateDisplay(billing.billingDate) : 'N/A'}</p>
                      </div>
                      <div className="text-right">
                        <PracticeHeader variant="invoice" align="right" />
                      </div>
                    </div>

                    {/* Client Information */}
                    <div className="grid grid-cols-2 gap-8 mb-8">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900 mb-2">Bill To:</h3>
                        <p className="text-slate-600">{client.fullName || 'N/A'}</p>
                        <p className="text-slate-600">{client.streetAddress1 || ''}</p>
                        <p className="text-slate-600">{client.phone || 'N/A'}</p>
                        <p className="text-slate-600">{client.email || 'N/A'}</p>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900 mb-2">Insurance Info:</h3>
                        <p className="text-slate-600">Provider: {client.insuranceProvider || 'N/A'}</p>
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
                            <td className="border border-slate-200 px-4 py-2">{session.service?.serviceName || 'Professional Service'}</td>
                            <td className="border border-slate-200 px-4 py-2">{billing.serviceCode}</td>
                            <td className="border border-slate-200 px-4 py-2">{billing.billingDate ? formatDateDisplay(billing.billingDate) : 'N/A'}</td>
                            <td className="border border-slate-200 px-4 py-2 text-right">${Number(billing.totalAmount).toFixed(2)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Totals */}
                    <div className="flex justify-end">
                      <div className="w-64">
                        <div className="flex justify-between mb-2">
                          <span className="text-slate-600">Service Amount:</span>
                          <span className="text-slate-900">${Number(billing.totalAmount).toFixed(2)}</span>
                        </div>
                        {billing.insuranceCovered && (
                          <div className="flex justify-between mb-2">
                            <span className="text-slate-600">Insurance Coverage:</span>
                            <span className="text-slate-900">-${(Number(billing.totalAmount) * 0.8).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between mb-2">
                          <span className="text-slate-600">Copay Amount:</span>
                          <span className="text-slate-900">${Number(billing.copayAmount || 0).toFixed(2)}</span>
                        </div>
                        {billing.paymentAmount && (
                          <div className="flex justify-between mb-2">
                            <span className="text-slate-600">Payment Made:</span>
                            <span className="text-green-700">-${Number(billing.paymentAmount).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold text-lg border-t pt-2">
                          <span>Total Due:</span>
                          <span className={billing.paymentStatus === 'paid' ? 'text-green-700' : ''}>
                            ${(() => {
                              const originalAmount = Number(billing.copayAmount || billing.totalAmount);
                              const paidAmount = Number(billing.paymentAmount || 0);
                              const dueAmount = originalAmount - paidAmount;
                              return Math.max(0, dueAmount).toFixed(2);
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInvoicePreviewOpen(false)}>
              Close
            </Button>
            {selectedBillingRecord && (() => {
              const record = filteredBillingRecords.find((r: any) => (r.billing?.id || r.id) === selectedBillingRecord.id);
              const client = record?.client || {};
              const billing = record?.billing || selectedBillingRecord;
              
              return (
                <>
                  <Button onClick={() => { setIsInvoicePreviewOpen(false); handleInvoiceAction('print', billing, client); }}>
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </Button>
                  <Button onClick={() => { setIsInvoicePreviewOpen(false); handleInvoiceAction('download', billing, client); }}>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  <Button onClick={() => { setIsInvoicePreviewOpen(false); handleInvoiceAction('email', billing, client); }}>
                    <Mail className="w-4 h-4 mr-2" />
                    Email
                  </Button>
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </div>
    </div>
  );
}