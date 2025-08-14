import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  AlertTriangle,
  Download,
  Search,
  Filter,
  Eye,
  UserCheck,
  FileText,
  AlertCircle,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface AuditLog {
  id: number;
  userId: number | null;
  username: string;
  action: string;
  result: string;
  resourceType: string;
  resourceId: string;
  clientId: number | null;
  clientName: string | null;
  ipAddress: string;
  userAgent: string;
  riskLevel: string;
  timestamp: string;
  hipaaRelevant: boolean;
  details: string;
}

export default function HIPAAAuditPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    riskLevel: 'all',
    hipaaOnly: false,
    action: 'all',
    userId: '',
  });

  // Fetch audit logs
  const { data: auditLogs = [], isLoading } = useQuery({
    queryKey: ['/api/audit/logs', filters],
  }) as { data: AuditLog[]; isLoading: boolean };

  // Fetch audit statistics
  const { data: auditStats = {} } = useQuery({
    queryKey: ['/api/audit/stats', filters],
  }) as { data: { totalActivities: number; phiAccess: number; highRiskEvents: number; failedAttempts: number } };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getActionIcon = (action: string) => {
    if (action.includes('login')) return <UserCheck className="w-4 h-4" />;
    if (action.includes('client')) return <Eye className="w-4 h-4" />;
    if (action.includes('document')) return <FileText className="w-4 h-4" />;
    if (action.includes('unauthorized')) return <AlertCircle className="w-4 h-4" />;
    return <Shield className="w-4 h-4" />;
  };

  const exportAuditReport = () => {
    // This would trigger a download of the audit report
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && value !== false) {
        params.append(key, String(value));
      }
    });
    window.open(`/api/audit/export?${params.toString()}`, '_blank');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading audit logs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center">
              <Shield className="w-8 h-8 mr-3 text-blue-600" />
              HIPAA Audit Trail
            </h1>
            <p className="text-slate-600 mt-2">
              Complete audit log of all PHI access and system activities for compliance monitoring
            </p>
          </div>
          <Button onClick={exportAuditReport} className="flex items-center">
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Shield className="w-8 h-8 text-blue-600 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">Total Activities</p>
                  <p className="text-2xl font-bold">{auditStats?.totalActivities || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Eye className="w-8 h-8 text-green-600 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">PHI Access Events</p>
                  <p className="text-2xl font-bold">{auditStats?.phiAccess || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <AlertTriangle className="w-8 h-8 text-yellow-600 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">High Risk Events</p>
                  <p className="text-2xl font-bold">{auditStats?.highRiskEvents || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <AlertCircle className="w-8 h-8 text-red-600 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">Failed Attempts</p>
                  <p className="text-2xl font-bold">{auditStats?.failedAttempts || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Filter className="w-5 h-5 mr-2" />
              Audit Filters
            </CardTitle>
            <CardDescription>
              Filter audit logs by date range, risk level, and activity type
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                />
              </div>
              
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                />
              </div>
              
              <div>
                <Label htmlFor="riskLevel">Risk Level</Label>
                <Select value={filters.riskLevel} onValueChange={(value) => setFilters({ ...filters, riskLevel: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="action">Action Type</Label>
                <Select value={filters.action} onValueChange={(value) => setFilters({ ...filters, action: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    <SelectItem value="client_viewed">Client Viewed</SelectItem>
                    <SelectItem value="document_accessed">Document Accessed</SelectItem>
                    <SelectItem value="login">Login Events</SelectItem>
                    <SelectItem value="data_exported">Data Exported</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-end">
                <Button variant="outline" className="w-full">
                  <Search className="w-4 h-4 mr-2" />
                  Apply Filters
                </Button>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="hipaaOnly"
                  checked={filters.hipaaOnly}
                  onChange={(e) => setFilters({ ...filters, hipaaOnly: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="hipaaOnly" className="text-sm">
                  PHI Access Only
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Audit Log Table */}
        <Card>
          <CardHeader>
            <CardTitle>Audit Log Entries</CardTitle>
            <CardDescription>
              Detailed log of all system activities and PHI access events
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Risk Level</TableHead>
                    <TableHead>PHI</TableHead>
                    <TableHead>IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                        No audit log entries found for the selected filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditLogs.map((log: AuditLog) => (
                      <TableRow key={log.id} className="hover:bg-slate-50">
                        <TableCell className="font-mono text-sm">
                          {format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            <UserCheck className="w-4 h-4 mr-2 text-gray-500" />
                            <span className="font-medium">{log.username}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            {getActionIcon(log.action)}
                            <span className="ml-2 capitalize">{log.action.replace('_', ' ')}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {log.clientName ? (
                              <div className="font-medium">{log.clientName}</div>
                            ) : log.resourceType === 'client' && log.clientId ? (
                              <div className="text-gray-500">Client ID: {log.clientId}</div>
                            ) : (
                              <div className="text-gray-400">—</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={log.result === 'success' ? 'default' : 'destructive'}>
                            {log.result}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getRiskLevelColor(log.riskLevel)}>
                            {log.riskLevel}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {log.hipaaRelevant ? (
                            <Badge className="bg-purple-100 text-purple-800">PHI</Badge>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {log.ipAddress}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}