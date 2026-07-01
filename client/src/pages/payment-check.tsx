import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, Loader2, Search, ExternalLink, AlertTriangle, XCircle, TrendingUp,
} from "lucide-react";

interface PaymentIssue {
  billingId: number;
  sessionId: number;
  clientId: number | null;
  clientName: string;
  clientCode: string | null;
  sessionDate: string;
  serviceName: string;
  billed: number;
  clientPaid: number;
  insurancePaid: number;
  recorded: number;
  status: string;
  uploadedInsurerAmount: number | null;
  reason: "denied_but_paid" | "paid_but_short" | "insurer_paid_more" | string;
}

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const datePart = value.split("T")[0];
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return datePart;
  const [, y, mo, d] = m;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(mo, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

const REASON_META: Record<string, { label: string; description: string; icon: any; className: string }> = {
  denied_but_paid: {
    label: "Marked paid — insurer denied",
    description: "Shows as paid, but the uploaded statement shows the insurer denied this claim ($0). No payment covers the bill.",
    icon: XCircle,
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200",
  },
  paid_but_short: {
    label: "Marked paid — nothing recorded",
    description: "Shows as paid, but the money actually recorded is less than what's owed.",
    icon: AlertTriangle,
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200",
  },
  insurer_paid_more: {
    label: "Insurer paid more than recorded",
    description: "An uploaded statement shows the insurer paid more than what's recorded here — money that may have been missed.",
    icon: TrendingUp,
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200",
  },
};

function reasonMeta(reason: string) {
  return REASON_META[reason] || {
    label: "Needs review",
    description: "This session's status doesn't match the recorded money.",
    icon: AlertTriangle,
    className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200",
  };
}

export default function PaymentCheckPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery<PaymentIssue[]>({
    queryKey: ["/api/billing/payment-check"],
    queryFn: async () => {
      const res = await apiRequest("/api/billing/payment-check", "GET");
      return (await res.json()) as PaymentIssue[];
    },
  });

  const issues = data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter(
      (i) =>
        (i.clientName || "").toLowerCase().includes(q) ||
        (i.clientCode || "").toLowerCase().includes(q) ||
        (i.serviceName || "").toLowerCase().includes(q),
    );
  }, [issues, search]);

  const counts = useMemo(() => {
    const c = { denied_but_paid: 0, paid_but_short: 0, insurer_paid_more: 0, gap: 0 };
    for (const i of issues) {
      if (i.reason === "denied_but_paid") c.denied_but_paid++;
      else if (i.reason === "paid_but_short") c.paid_but_short++;
      else if (i.reason === "insurer_paid_more") c.insurer_paid_more++;
      const gap = i.billed - i.recorded;
      if (gap > 0) c.gap += gap;
    }
    return c;
  }, [issues]);

  return (
    <div className="container mx-auto py-6 px-4 space-y-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment Check</h1>
          <p className="text-muted-foreground max-w-2xl">
            An automatic cross-check that flags any session whose payment status doesn't
            match the money actually recorded — or the amount on an uploaded insurance
            statement. Nothing here changes any money; it's a read-only review list.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-total">
          <CardHeader className="pb-2">
            <CardDescription>Sessions flagged</CardDescription>
            <CardTitle className="text-3xl">{issues.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card data-testid="card-denied">
          <CardHeader className="pb-2">
            <CardDescription>Paid, but insurer denied</CardDescription>
            <CardTitle className="text-3xl text-red-600">{counts.denied_but_paid}</CardTitle>
          </CardHeader>
        </Card>
        <Card data-testid="card-short">
          <CardHeader className="pb-2">
            <CardDescription>Paid, but nothing recorded</CardDescription>
            <CardTitle className="text-3xl text-amber-600">{counts.paid_but_short}</CardTitle>
          </CardHeader>
        </Card>
        <Card data-testid="card-gap">
          <CardHeader className="pb-2">
            <CardDescription>Total unrecorded amount</CardDescription>
            <CardTitle className="text-3xl">{formatCurrency(counts.gap)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Flagged sessions</CardTitle>
              <CardDescription>
                Review each one and confirm the correct status before we change anything.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search client, code, or service"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Checking payments…
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center py-16 text-red-600">
              Couldn't load the payment check. Please try again.
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <ShieldAlert className="h-10 w-10 mb-3 opacity-40" />
              {issues.length === 0
                ? "No mismatches found — every session's status matches the money recorded."
                : "No sessions match your search."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Recorded</TableHead>
                    <TableHead className="text-right">Uploaded insurer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => {
                    const meta = reasonMeta(i.reason);
                    const Icon = meta.icon;
                    return (
                      <TableRow key={i.billingId} data-testid={`row-issue-${i.billingId}`}>
                        <TableCell>
                          <div className="font-medium">{i.clientName}</div>
                          {i.clientCode && (
                            <div className="text-xs text-muted-foreground">{i.clientCode}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div>{formatDate(i.sessionDate)}</div>
                          <div className="text-xs text-muted-foreground">{i.serviceName}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(i.billed)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(i.recorded)}
                          {i.recorded < i.billed && (
                            <div className="text-xs text-red-600">
                              short {formatCurrency(i.billed - i.recorded)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(i.uploadedInsurerAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {i.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${meta.className}`}
                            title={meta.description}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {meta.label}
                          </div>
                        </TableCell>
                        <TableCell>
                          {i.clientId != null && (
                            <Link href={`/clients/${i.clientId}`}>
                              <Button variant="ghost" size="sm" data-testid={`link-client-${i.clientId}`}>
                                <ExternalLink className="h-4 w-4 mr-1" /> Open
                              </Button>
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
