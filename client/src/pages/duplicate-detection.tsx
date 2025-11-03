import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Users, Phone, Mail, Calendar, FileText } from "lucide-react";
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
}

interface DuplicateGroup {
  clients: Client[];
  matchType: string;
  confidence: string;
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

  const markDuplicateMutation = useMutation({
    mutationFn: async ({ clientId, duplicateOfClientId }: { clientId: number; duplicateOfClientId: number }) => {
      return await apiRequest(`/api/clients/${clientId}/mark-duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateOfClientId }),
      });
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
      return await apiRequest(`/api/clients/${clientId}/unmark-duplicate`, {
        method: 'POST',
      });
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Duplicate Detection</h1>
        <p className="text-muted-foreground mt-2">
          Identify and manage potential duplicate client records
        </p>
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
              <Card key={groupIndex} className="border-orange-200 bg-orange-50/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Duplicate Group #{groupIndex + 1}</CardTitle>
                      <CardDescription>
                        <Badge variant="outline" className="mt-2">
                          {group.matchType}
                        </Badge>
                        <Badge variant="secondary" className="mt-2 ml-2">
                          Confidence: {group.confidence}
                        </Badge>
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 text-orange-600">
                      <Users className="h-5 w-5" />
                      <span className="font-semibold">{group.clients.length} records</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {group.clients.map((client, clientIndex) => (
                      <Card key={client.id} className="bg-white">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">
                              {client.fullName}
                            </CardTitle>
                            <Badge variant={clientIndex === 0 ? "default" : "secondary"}>
                              {clientIndex === 0 ? "Primary?" : `Duplicate ${clientIndex}`}
                            </Badge>
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

                          <div className="space-y-2">
                            {clientIndex > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                onClick={() => handleMarkDuplicate(client.id, group.clients[0].id)}
                                disabled={markDuplicateMutation.isPending}
                                data-testid={`button-mark-duplicate-${client.id}`}
                              >
                                Mark as Duplicate of {group.clients[0].fullName}
                              </Button>
                            )}
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
                    ))}
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
