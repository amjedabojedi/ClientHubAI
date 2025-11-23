import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle, XCircle, Clock, Filter, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface ClientConsent {
  id: number;
  clientId: string;
  fullName: string;
  email: string | null;
  hasPortalAccess: boolean;
  consents: Array<{
    id: number;
    consentType: string;
    granted: boolean;
    grantedAt: Date | null;
    withdrawnAt: Date | null;
    consentVersion: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export default function AdminConsentPage() {
  const [consentTypeFilter, setConsentTypeFilter] = useState<string>("all");
  const [grantedFilter, setGrantedFilter] = useState<string>("all");

  // Build query params
  const queryParams = new URLSearchParams();
  if (consentTypeFilter !== "all") {
    queryParams.append("consentType", consentTypeFilter);
  }
  if (grantedFilter !== "all") {
    queryParams.append("granted", grantedFilter);
  }

  const { data: clients, isLoading, refetch } = useQuery<ClientConsent[]>({
    queryKey: ["/api/admin/consents", consentTypeFilter, grantedFilter],
    queryFn: async () => {
      const url = `/api/admin/consents${queryParams.toString() ? `?${queryParams}` : ''}`;
      const response = await fetch(url, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error("Failed to fetch consents");
      return response.json();
    }
  });

  const getConsentBadge = (consents: ClientConsent['consents'], type: string) => {
    const consent = consents.find(c => c.consentType === type);
    
    if (!consent) {
      return <Badge variant="outline" className="text-gray-500">Not Set</Badge>;
    }
    
    if (consent.granted) {
      return (
        <Badge variant="default" className="bg-green-500">
          <CheckCircle className="w-3 h-3 mr-1" />
          Granted
        </Badge>
      );
    }
    
    return (
      <Badge variant="destructive">
        <XCircle className="w-3 h-3 mr-1" />
        Denied
      </Badge>
    );
  };

  const getConsentTypeLabel = (type: string) => {
    switch (type) {
      case 'ai_processing':
        return 'AI Processing';
      case 'data_sharing':
        return 'Data Sharing';
      case 'research_participation':
        return 'Research';
      case 'marketing_communications':
        return 'Marketing';
      default:
        return type;
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="w-8 h-8 text-blue-600" />
            Patient Consent Management
          </h1>
          <p className="text-gray-600 mt-1">
            View and monitor GDPR consent status for all clients
          </p>
        </div>
        <Button
          onClick={() => refetch()}
          variant="outline"
          size="sm"
          data-testid="button-refresh-consents"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
          <CardDescription>Filter clients by consent type and status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Consent Type</label>
              <Select value={consentTypeFilter} onValueChange={setConsentTypeFilter}>
                <SelectTrigger data-testid="select-consent-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="ai_processing">AI Processing</SelectItem>
                  <SelectItem value="data_sharing">Data Sharing</SelectItem>
                  <SelectItem value="research_participation">Research Participation</SelectItem>
                  <SelectItem value="marketing_communications">Marketing Communications</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Consent Status</label>
              <Select value={grantedFilter} onValueChange={setGrantedFilter}>
                <SelectTrigger data-testid="select-consent-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="true">Granted</SelectItem>
                  <SelectItem value="false">Denied/Withdrawn</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle>Client Consent Status</CardTitle>
          <CardDescription>
            {isLoading ? (
              "Loading..."
            ) : (
              `Showing ${clients?.length || 0} clients`
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : clients && clients.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client ID</TableHead>
                    <TableHead>Full Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-center">Portal Access</TableHead>
                    <TableHead className="text-center">AI Processing</TableHead>
                    <TableHead className="text-center">Data Sharing</TableHead>
                    <TableHead className="text-center">Research</TableHead>
                    <TableHead className="text-center">Marketing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow key={client.id} data-testid={`row-client-${client.id}`}>
                      <TableCell className="font-medium">{client.clientId}</TableCell>
                      <TableCell>{client.fullName}</TableCell>
                      <TableCell className="text-gray-600">{client.email || "—"}</TableCell>
                      <TableCell className="text-center">
                        {client.hasPortalAccess ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            Enabled
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-500">
                            Disabled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {getConsentBadge(client.consents, 'ai_processing')}
                      </TableCell>
                      <TableCell className="text-center">
                        {getConsentBadge(client.consents, 'data_sharing')}
                      </TableCell>
                      <TableCell className="text-center">
                        {getConsentBadge(client.consents, 'research_participation')}
                      </TableCell>
                      <TableCell className="text-center">
                        {getConsentBadge(client.consents, 'marketing_communications')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No clients match the selected filters</p>
              <p className="text-sm mt-2">Try adjusting your filter criteria</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="bg-green-500">
                <CheckCircle className="w-3 h-3 mr-1" />
                Granted
              </Badge>
              <span className="text-gray-600">Client has consented</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="destructive">
                <XCircle className="w-3 h-3 mr-1" />
                Denied
              </Badge>
              <span className="text-gray-600">Client has withdrawn or denied consent</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-gray-500">Not Set</Badge>
              <span className="text-gray-600">Client has not made a choice yet</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
