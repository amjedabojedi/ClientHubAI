import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Receipt, CreditCard, FileText, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { formatDateDisplay } from "@/lib/datetime";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Invoice {
  id: number;
  sessionId: number;
  serviceCode: string;
  serviceName?: string;
  units: number;
  ratePerUnit: string;
  totalAmount: string;
  insuranceCovered: boolean;
  copayAmount: string | null;
  billingDate: string | null;
  paymentStatus: string;
  paymentAmount: string | null;
  paymentDate: string | null;
  paymentReference: string | null;
  paymentMethod: string | null;
  sessionDate: Date;
  sessionType: string;
}

export default function PortalInvoices() {
  const { toast } = useToast();
  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/portal/invoices"],
  });

  // Check for payment result in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    
    if (paymentStatus === 'success') {
      toast({
        title: "Payment Successful",
        description: "Your payment has been processed successfully.",
      });
      // Clear the URL parameters
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "Your payment was cancelled. You can try again anytime.",
        variant: "destructive",
      });
      // Clear the URL parameters
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [toast]);

  // Payment mutation
  const paymentMutation = useMutation({
    mutationFn: async (invoiceId: number) => {
      const response = await apiRequest(`/api/portal/invoices/${invoiceId}/pay`, "POST", {});
      return response;
    },
    onSuccess: async (data) => {
      console.log('Payment response:', data);
      // Redirect to Stripe Checkout URL directly
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        console.error('No checkoutUrl in response:', data);
        toast({
          title: "Error",
          description: "Payment URL not available",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to initiate payment",
        variant: "destructive",
      });
    },
  });

  const getPaymentStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      pending: { variant: "outline", label: "Pending" },
      paid: { variant: "default", label: "Paid" },
      partially_paid: { variant: "secondary", label: "Partially Paid" },
      overdue: { variant: "destructive", label: "Overdue" },
    };

    const config = statusMap[status] || { variant: "outline" as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatCurrency = (value: string | null) => {
    if (!value) return "$0.00";
    const num = parseFloat(value);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/portal/dashboard">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Loading invoices...</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
          <Link href="/portal/dashboard">
            <Button variant="outline" size="sm" data-testid="button-back" className="text-xs sm:text-sm">
              <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Back to </span>Dashboard
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              <CardTitle className="text-lg sm:text-xl">Invoices</CardTitle>
            </div>
            <CardDescription className="text-xs sm:text-sm">
              View your billing history and payment status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!invoices || invoices.length === 0 ? (
              <div className="text-center py-8 sm:py-12">
                <Receipt className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-base sm:text-lg font-semibold mb-2">No Invoices Yet</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Your billing history will appear here once sessions are invoiced.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="inline-block min-w-full align-middle">
                  <div className="overflow-hidden">
                    <Table className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="header-date">Date</TableHead>
                      <TableHead data-testid="header-service">Service</TableHead>
                      <TableHead data-testid="header-session-type">Session Type</TableHead>
                      <TableHead className="text-right" data-testid="header-amount">Amount</TableHead>
                      <TableHead className="text-right" data-testid="header-insurance">Insurance</TableHead>
                      <TableHead className="text-right" data-testid="header-copay">Copay</TableHead>
                      <TableHead data-testid="header-status">Status</TableHead>
                      <TableHead data-testid="header-actions">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((invoice) => (
                      <TableRow key={invoice.id} data-testid={`invoice-row-${invoice.id}`}>
                        <TableCell data-testid={`text-date-${invoice.id}`}>
                          {formatDateDisplay(invoice.billingDate || invoice.sessionDate)}
                        </TableCell>
                        <TableCell data-testid={`text-service-${invoice.id}`}>
                          <div className="font-medium">{invoice.serviceName || invoice.serviceCode}</div>
                          <div className="text-xs text-muted-foreground">{invoice.serviceCode}</div>
                        </TableCell>
                        <TableCell data-testid={`text-session-type-${invoice.id}`}>
                          <span className="capitalize">{invoice.sessionType}</span>
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-amount-${invoice.id}`}>
                          <div className="font-semibold">{formatCurrency(invoice.totalAmount)}</div>
                          <div className="text-xs text-muted-foreground">
                            {invoice.units} × {formatCurrency(invoice.ratePerUnit)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-insurance-${invoice.id}`}>
                          {invoice.insuranceCovered ? (
                            <Badge variant="outline" className="text-xs">Covered</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-copay-${invoice.id}`}>
                          {invoice.copayAmount ? formatCurrency(invoice.copayAmount) : '—'}
                        </TableCell>
                        <TableCell data-testid={`text-status-${invoice.id}`}>
                          {getPaymentStatusBadge(invoice.paymentStatus)}
                          {invoice.paymentDate && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Paid {formatDateDisplay(invoice.paymentDate)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell data-testid={`cell-actions-${invoice.id}`}>
                          {invoice.paymentStatus === 'pending' && (
                            <Button
                              size="sm"
                              onClick={() => paymentMutation.mutate(invoice.id)}
                              disabled={paymentMutation.isPending}
                              data-testid={`button-pay-${invoice.id}`}
                            >
                              {paymentMutation.isPending ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Processing...
                                </>
                              ) : (
                                <>
                                  <CreditCard className="w-4 h-4 mr-2" />
                                  Pay Now
                                </>
                              )}
                            </Button>
                          )}
                          {invoice.paymentStatus === 'paid' && invoice.paymentReference && (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-view-receipt-${invoice.id}`}
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              Receipt
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {invoices && invoices.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Total Invoices</div>
                  <div className="text-2xl font-bold" data-testid="text-total-invoices">
                    {invoices.length}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Total Billed</div>
                  <div className="text-2xl font-bold" data-testid="text-total-billed">
                    {formatCurrency(
                      invoices.reduce((sum, inv) => sum + parseFloat(inv.totalAmount), 0).toString()
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Total Paid</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-paid">
                    {formatCurrency(
                      invoices
                        .filter(inv => inv.paymentStatus === 'paid')
                        .reduce((sum, inv) => sum + parseFloat(inv.paymentAmount || inv.totalAmount), 0)
                        .toString()
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
