import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Users, Receipt, History, Loader2, Check, ChevronsUpDown, DollarSign, AlertTriangle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientStatement } from "@shared/schema";

interface ClientOption {
  id: number;
  fullName: string;
  clientId: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

// Format a date-only string (YYYY-MM-DD) without timezone shifting.
function formatDate(value: string | null): string {
  if (!value) return "—";
  const datePart = value.split("T")[0];
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return datePart;
  const [, y, mo, d] = m;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(mo, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

export default function ClientStatementsPage() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: clientsData, isLoading: isSearching } = useQuery({
    queryKey: ["/api/clients", "statement-search", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: "20" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await apiRequest(`/api/clients?${params.toString()}`, "GET");
      return (await res.json()) as { clients: ClientOption[] };
    },
    enabled: open,
  });

  const { data: statement, isLoading: isLoadingStatement } = useQuery<ClientStatement>({
    queryKey: ["/api/client-pay/statement", selectedClient?.id],
    queryFn: async () => {
      const res = await apiRequest(`/api/client-pay/statement/${selectedClient!.id}`, "GET");
      return (await res.json()) as ClientStatement;
    },
    enabled: !!selectedClient,
  });

  const clients = clientsData?.clients ?? [];

  return (
    <div className="p-6 space-y-6" data-testid="page-client-statements">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="h-6 w-6" />
          Client Statements
        </h1>
        <p className="text-muted-foreground mt-1">
          Search for a client to view their billing summary, sessions still owed, and payment history.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Select a client
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full max-w-md justify-between"
                data-testid="button-select-client"
              >
                {selectedClient
                  ? `${selectedClient.fullName} (${selectedClient.clientId})`
                  : "Search clients by name..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Type a client name..."
                  value={search}
                  onValueChange={setSearch}
                  data-testid="input-client-search"
                />
                <CommandList>
                  {isSearching && (
                    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching...
                    </div>
                  )}
                  {!isSearching && <CommandEmpty>No clients found.</CommandEmpty>}
                  <CommandGroup>
                    {clients.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={String(c.id)}
                        onSelect={() => {
                          setSelectedClient(c);
                          setOpen(false);
                        }}
                        data-testid={`option-client-${c.id}`}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedClient?.id === c.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="flex-1">{c.fullName}</span>
                        <span className="text-xs text-muted-foreground ml-2">{c.clientId}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      {!selectedClient && (
        <div className="text-center text-muted-foreground py-12">
          Choose a client above to see their statement.
        </div>
      )}

      {selectedClient && isLoadingStatement && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading statement...
        </div>
      )}

      {selectedClient && statement && !isLoadingStatement && (
        <div className="space-y-6" data-testid="client-statement-content">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card data-testid="card-total-billed">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Total billed
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(statement.summary.totalBilled)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {statement.summary.sessionCount} session{statement.summary.sessionCount === 1 ? "" : "s"}
                </p>
              </CardContent>
            </Card>
            <Card data-testid="card-total-paid">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <Check className="h-4 w-4" /> Total paid
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(statement.summary.totalPaid)}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-outstanding">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Outstanding balance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "text-2xl font-bold",
                    statement.summary.outstanding > 0 ? "text-amber-600" : "text-muted-foreground"
                  )}
                >
                  {formatCurrency(statement.summary.outstanding)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {statement.summary.uncollectedCount} session{statement.summary.uncollectedCount === 1 ? "" : "s"} not collected
                </p>
              </CardContent>
            </Card>
            <Card data-testid="card-credit">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Credit (overpaid)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "text-2xl font-bold",
                    statement.summary.credit > 0 ? "text-blue-600" : "text-muted-foreground"
                  )}
                >
                  {formatCurrency(statement.summary.credit)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {statement.summary.overpaidCount} session{statement.summary.overpaidCount === 1 ? "" : "s"} overpaid
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" /> Sessions not yet collected
              </CardTitle>
              <CardDescription>Sessions where the client still owes money.</CardDescription>
            </CardHeader>
            <CardContent>
              {statement.uncollectedSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Nothing outstanding — all sessions are paid.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session date</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.uncollectedSessions.map((s) => (
                      <TableRow key={s.billingId} data-testid={`row-uncollected-${s.billingId}`}>
                        <TableCell>{formatDate(s.sessionDate)}</TableCell>
                        <TableCell>
                          {s.serviceName || s.serviceCode || "—"}
                          {s.insuranceCovered && (
                            <Badge variant="secondary" className="ml-2 text-xs">Insurance</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(s.billed)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(s.paid)}</TableCell>
                        <TableCell className="text-right font-medium text-amber-600">
                          {formatCurrency(s.outstanding)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{s.paymentStatus}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {statement.sessions.filter((s) => s.paid - s.billed > 0.005).length > 0 && (
            <Card data-testid="card-overpaid-sessions">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-600" /> Sessions overpaid (credit owed back)
                </CardTitle>
                <CardDescription>
                  More money was received than these sessions were billed — usually the client paid and insurance also paid the same visit. The extra sits as a credit.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session date</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Overpaid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.sessions
                      .filter((s) => s.paid - s.billed > 0.005)
                      .map((s) => (
                        <TableRow key={s.billingId} data-testid={`row-overpaid-${s.billingId}`}>
                          <TableCell>{formatDate(s.sessionDate)}</TableCell>
                          <TableCell>
                            {s.serviceName || s.serviceCode || "—"}
                            {s.insuranceCovered && (
                              <Badge variant="secondary" className="ml-2 text-xs">Insurance</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(s.billed)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(s.paid)}</TableCell>
                          <TableCell className="text-right font-medium text-blue-600">
                            {formatCurrency(s.paid - s.billed)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Sessions completed, not yet billed
              </CardTitle>
              <CardDescription>Completed sessions that don't have an invoice yet.</CardDescription>
            </CardHeader>
            <CardContent>
              {statement.unbilledSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">All completed sessions have been billed.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session date</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Session status</TableHead>
                      <TableHead className="text-right">Expected amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.unbilledSessions.map((s) => (
                      <TableRow key={s.sessionId} data-testid={`row-unbilled-${s.sessionId}`}>
                        <TableCell>{formatDate(s.sessionDate)}</TableCell>
                        <TableCell>{s.serviceName || s.serviceCode || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{s.status || "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {s.amount != null ? formatCurrency(s.amount) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" /> Payment history
              </CardTitle>
              <CardDescription>Each payment recorded against this client's sessions.</CardDescription>
            </CardHeader>
            <CardContent>
              {statement.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No payments recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment date</TableHead>
                      <TableHead>Session date</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Paid by</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.payments.map((p) => (
                      <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                        <TableCell>{formatDate(p.paymentDate)}</TableCell>
                        <TableCell>{formatDate(p.sessionDate)}</TableCell>
                        <TableCell>{p.serviceName || p.serviceCode || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={p.source === "insurance" ? "secondary" : "outline"} className="capitalize">
                            {p.source}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize">{p.paymentMethod || "—"}</TableCell>
                        <TableCell>{p.referenceNumber || "—"}</TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          {formatCurrency(p.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
