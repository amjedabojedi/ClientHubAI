import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Users, Phone, Mail, Calendar, FileText, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Client {
  id: number;
  clientId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  status: string | null;
  assignedTherapistId: number | null;
  createdAt: string;
  sessionCount: number;
  documentCount: number;
  billingCount: number;
  lastSessionDate: string | null;
}

interface DuplicateGroup {
  clients: Client[];
  matchType: string;
  confidence: string;
  confidenceScore: number;
  recommendation?: {
    keepClientId: number;
    deleteClientId: number;
    reasons: string[];
  };
}

interface DuplicatesResponse {
  duplicateGroups: DuplicateGroup[];
  totalDuplicates: number;
}

export default function DuplicateDetectionPage() {
  const { toast } = useToast();

  const { data: duplicatesData, isLoading, error, refetch } = useQuery<DuplicatesResponse>({
    queryKey: ['/api/clients/duplicates'],
  });

  // Debug logging
  console.log('[DUPLICATE DETECTION] Query state:', { isLoading, hasError: !!error, hasData: !!duplicatesData });
  console.log('[DUPLICATE DETECTION] Cookies:', document.cookie);
  if (error) {
    console.error('[DUPLICATE DETECTION] Query error:', error);
    console.error('[DUPLICATE DETECTION] Error details:', JSON.stringify(error));
  }

  const markDuplicateMutation = useMutation({
    mutationFn: async ({ clientId, duplicateOfClientId }: { clientId: number; duplicateOfClientId: number }) => {
      return await apiRequest(`/api/clients/${clientId}/mark-duplicate`, 'POST', { duplicateOfClientId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients/duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      toast({
        title: "Success",
        description: "Client marked as duplicate successfully",
      });
      refetch();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark client as duplicate",
        variant: "destructive",
      });
    },
  });

  const unmarkDuplicateMutation = useMutation({
    mutationFn: async (clientId: number) => {
      return await apiRequest(`/api/clients/${clientId}/unmark-duplicate`, 'POST', {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients/duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      toast({
        title: "Success",
        description: "Client unmarked as duplicate successfully",
      });
      refetch();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to unmark duplicate",
        variant: "destructive",
      });
    },
  });

  const handleMarkDuplicate = (clientId: number, primaryClientId: number) => {
    if (confirm(`Are you sure you want to mark client #${clientId} as a duplicate of client #${primaryClientId}?\n\nThis will hide the duplicate client from normal views, but all data will be preserved.`)) {
      markDuplicateMutation.mutate({ clientId, duplicateOfClientId: primaryClientId });
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Scanning for duplicate clients...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Failed to load duplicate detection results. Please try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const duplicateGroups = duplicatesData?.duplicateGroups || [];
  const totalDuplicates = duplicatesData?.totalDuplicates || 0;

  const getConfidenceBadgeColor = (confidenceScore: number) => {
    if (confidenceScore >= 95) return "bg-red-100 text-red-800 border-red-300";
    if (confidenceScore >= 85) return "bg-orange-100 text-orange-800 border-orange-300";
    return "bg-yellow-100 text-yellow-800 border-yellow-300";
  };

  const getGroupBorderColor = (confidenceScore: number) => {
    if (confidenceScore >= 95) return "border-red-300 bg-red-50/50";
    if (confidenceScore >= 85) return "border-orange-300 bg-orange-50/50";
    return "border-yellow-300 bg-yellow-50/50";
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Duplicate Detection</h1>
          <p className="text-muted-foreground mt-2">
            Identify and manage potential duplicate client records
          </p>
        </div>
        <Button
          onClick={() => refetch()}
          disabled={isLoading}
          variant="outline"
          className="gap-2"
          data-testid="button-refresh-duplicates"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh Scan
        </Button>
      </div>

      {duplicateGroups.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Duplicates Found</h3>
              <p className="text-muted-foreground">
                Great! No duplicate client records were detected in your system.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Detection Results</AlertTitle>
            <AlertDescription>
              Found <strong>{duplicateGroups.length}</strong> potential duplicate groups affecting{" "}
              <strong>{totalDuplicates}</strong> client records. Review each group below and mark duplicates as needed.
            </AlertDescription>
          </Alert>

          <div className="space-y-6">
            {duplicateGroups.map((group, groupIndex) => (
              <Card key={groupIndex} className={getGroupBorderColor(group.confidenceScore)}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Duplicate Group #{groupIndex + 1}</CardTitle>
                      <CardDescription>
                        <Badge variant="outline" className="mt-2">
                          {group.matchType}
                        </Badge>
                        <Badge variant="outline" className={`mt-2 ml-2 ${getConfidenceBadgeColor(group.confidenceScore)}`}>
                          {group.confidence}
                        </Badge>
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-5 w-5" />
                      <span className="font-semibold">{group.clients.length} records</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Recommendation Banner */}
                  {group.recommendation && (
                    <Alert className="mb-4 bg-blue-50 border-blue-200">
                      <CheckCircle2 className="h-4 w-4 text-blue-600" />
                      <AlertTitle className="text-blue-900">Smart Recommendation</AlertTitle>
                      <AlertDescription className="text-blue-800">
                        <div className="space-y-1 mt-2">
                          <p className="font-semibold">
                            Keep: {group.clients.find(c => c.id === group.recommendation!.keepClientId)?.fullName} 
                            {" "}({group.clients.find(c => c.id === group.recommendation!.keepClientId)?.clientId})
                          </p>
                          <p className="text-sm">Reasons:</p>
                          <ul className="list-disc list-inside text-sm">
                            {group.recommendation.reasons.map((reason, idx) => (
                              <li key={idx}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {group.clients.map((client) => {
                      const isRecommendedToKeep = group.recommendation?.keepClientId === client.id;
                      const isRecommendedToDelete = group.recommendation?.deleteClientId === client.id;
                      
                      return (
                        <Card key={client.id} className={`${isRecommendedToKeep ? 'border-green-300 bg-green-50' : isRecommendedToDelete ? 'border-orange-300 bg-orange-50' : 'bg-white'}`}>
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base">
                                {client.fullName}
                              </CardTitle>
                              {isRecommendedToKeep && (
                                <Badge className="bg-green-600">✓ Keep This</Badge>
                              )}
                              {isRecommendedToDelete && (
                                <Badge className="bg-orange-600">Mark as Duplicate</Badge>
                              )}
                            </div>
                            <CardDescription>Client ID: {client.clientId}</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="grid grid-cols-1 gap-2 text-sm">
                              {client.phone && (
                                <div className="flex items-center gap-2">
                                  <Phone className="h-4 w-4 text-muted-foreground" />
                                  <span>{client.phone}</span>
                                </div>
                              )}
                              {client.email && (
                                <div className="flex items-center gap-2">
                                  <Mail className="h-4 w-4 text-muted-foreground" />
                                  <span className="truncate">{client.email}</span>
                                </div>
                              )}
                              {client.dateOfBirth && (
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-4 w-4 text-muted-foreground" />
                                  <span>DOB: {format(new Date(client.dateOfBirth), 'MMM d, yyyy')}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span>Status: {client.status || 'N/A'}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  Created: {format(new Date(client.createdAt), 'MMM d, yyyy')}
                                </span>
                              </div>
                            </div>

                            <Separator />

                            {/* Activity Stats */}
                            <div className="bg-gray-50 p-3 rounded space-y-1">
                              <div className="text-sm font-semibold mb-2">Activity Summary</div>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="text-center">
                                  <div className="font-bold text-lg text-blue-600">{client.sessionCount}</div>
                                  <div className="text-muted-foreground">Sessions</div>
                                </div>
                                <div className="text-center">
                                  <div className="font-bold text-lg text-purple-600">{client.documentCount}</div>
                                  <div className="text-muted-foreground">Documents</div>
                                </div>
                                <div className="text-center">
                                  <div className="font-bold text-lg text-green-600">{client.billingCount}</div>
                                  <div className="text-muted-foreground">Billing</div>
                                </div>
                              </div>
                              {client.lastSessionDate && (
                                <div className="text-xs text-muted-foreground mt-2 text-center">
                                  Last session: {format(new Date(client.lastSessionDate), 'MMM d, yyyy')}
                                </div>
                              )}
                            </div>

                            <Separator />

                            <div className="space-y-2">
                              {/* Show all possible duplicate options, with recommended one highlighted */}
                              {group.clients
                                .filter(otherClient => otherClient.id !== client.id)
                                .map(otherClient => {
                                  const isRecommendedAction = 
                                    group.recommendation?.deleteClientId === client.id && 
                                    group.recommendation?.keepClientId === otherClient.id;
                                  
                                  return (
                                    <Button
                                      key={otherClient.id}
                                      size="sm"
                                      variant={isRecommendedAction ? "default" : "outline"}
                                      className={`w-full ${isRecommendedAction ? 'bg-orange-600 hover:bg-orange-700' : ''}`}
                                      onClick={() => handleMarkDuplicate(client.id, otherClient.id)}
                                      disabled={markDuplicateMutation.isPending}
                                      data-testid={`button-mark-duplicate-${client.id}-of-${otherClient.id}`}
                                    >
                                      {isRecommendedAction && '⭐ '}
                                      Mark as Duplicate of {otherClient.fullName.split(' ')[0]}
                                      {isRecommendedAction && ' (Recommended)'}
                                    </Button>
                                  );
                                })}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="w-full"
                                onClick={() => window.open(`/clients/${client.id}`, '_blank')}
                                data-testid={`button-view-client-${client.id}`}
                              >
                                View Full Record
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
