import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Percent,
} from "lucide-react";
import { format } from "date-fns";
import { PracticeHeader } from "@/components/shared/practice-header";

interface ReconRow {
  id: number;
  sessionId: number;
  sessionDate: string;
  clientName: string;
  therapistId: number;
  therapistName: string;
  serviceCode: string;
  serviceName: string;
  billed: number;
  collected: number;
  outstanding: number;
  paymentStatus: string;
}

interface ReconTherapist {
  therapistId: number;
  therapistName: string;
  sessionCount: number;
  billed: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
}

interface ReconSummary {
  sessionCount: number;
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  collectionRate: number;
  statusCounts: Record<string, number>;
}

interface ReconResponse {
  summary: ReconSummary;
  therapists: ReconTherapist[];
  rows: ReconRow[];
}

const money = (n?: number) =>
  `$${(n ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-green-100 text-green-800 border-green-200",
  billed: "bg-blue-100 text-blue-800 border-blue-200",
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  follow_up: "bg-orange-100 text-orange-800 border-orange-200",
  denied: "bg-red-100 text-red-800 border-red-200",
  refunded: "bg-gray-100 text-gray-800 border-gray-200",
};

function statusLabel(s: string) {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatSessionDate(d?: string) {
  if (!d) return "—";
  try {
    return format(new Date(d), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

export default function PaymentReconciliationPage() {
  const { user } = useAuth();

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const today = now.toISOString().split("T")[0];

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(today);
  const [therapistId, setTherapistId] = useState("all");

  const showTherapistFilter =
    !!user &&
    ["administrator", "admin", "supervisor", "accountant"].includes(
      (user.role || "").toLowerCase().trim(),
    );

  const { data: therapists = [] } = useQuery<any[]>({
    queryKey: ["/api/therapists"],
    enabled: showTherapistFilter,
  });

  const { data, isLoading, isFetching } = useQuery<ReconResponse>({
    queryKey: ["/api/reconciliation/summary", { startDate, endDate, therapistId }],
  });

  const summary = data?.summary;
  const therapistRows = data?.therapists ?? [];
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PracticeHeader />

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <DollarSign className="h-6 w-6 text-primary" />
          Payment Reconciliation
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          A read-only overview of what's been billed, what's been collected, and
          what's still outstanding.
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">From</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">To</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {showTherapistFilter && (
              <div className="space-y-1.5">
                <Label>Therapist</Label>
                <Select value={therapistId} onValueChange={setTherapistId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All therapists" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All therapists</SelectItem>
                    {therapists.map((t: any) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Billed
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {money(summary?.totalBilled)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.sessionCount ?? 0} billed sessions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Collected
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">
              {money(summary?.totalCollected)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Money received so far
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outstanding
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {money(summary?.totalOutstanding)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Still to collect</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Collection Rate
            </CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(summary?.collectionRate ?? 0).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Collected ÷ billed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-therapist breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">By Therapist</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Loading…
            </p>
          ) : therapistRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No billing records found for this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Therapist</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {therapistRows.map((t) => (
                  <TableRow key={t.therapistId}>
                    <TableCell className="font-medium">
                      {t.therapistName}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.sessionCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(t.billed)}
                    </TableCell>
                    <TableCell className="text-right text-green-700">
                      {money(t.collected)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600">
                      {money(t.outstanding)}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.collectionRate.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Per-session detail */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Sessions{" "}
            {isFetching && !isLoading && (
              <span className="text-xs font-normal text-muted-foreground">
                (updating…)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No billing records found for this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Therapist</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatSessionDate(r.sessionDate)}
                      </TableCell>
                      <TableCell>{r.clientName || "—"}</TableCell>
                      <TableCell>{r.therapistName}</TableCell>
                      <TableCell>
                        <span className="font-medium">{r.serviceCode}</span>
                        {r.serviceName ? (
                          <span className="text-muted-foreground">
                            {" "}
                            — {r.serviceName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {money(r.billed)}
                      </TableCell>
                      <TableCell className="text-right text-green-700">
                        {money(r.collected)}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {money(r.outstanding)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            STATUS_STYLES[r.paymentStatus] ||
                            "bg-gray-100 text-gray-800 border-gray-200"
                          }
                        >
                          {statusLabel(r.paymentStatus)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
