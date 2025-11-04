import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2, Users } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface BulkReassignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedClientIds: number[];
  onSuccess: () => void;
}

interface Therapist {
  id: number;
  fullName: string;
  username: string;
  clientCount?: number;
}

export default function BulkReassignModal({
  open,
  onOpenChange,
  selectedClientIds,
  onSuccess
}: BulkReassignModalProps) {
  const [selectedTherapists, setSelectedTherapists] = useState<number[]>([]);
  const [distribution, setDistribution] = useState<"single" | "even">("single");
  const { toast } = useToast();

  // Fetch therapists
  const { data: therapists = [], isLoading: loadingTherapists } = useQuery<Therapist[]>({
    queryKey: ["/api/users"],
    select: (data: any[]) => data.filter(u => u.role === 'therapist'),
    enabled: open
  });

  // Fetch client counts for each therapist
  const { data: clientStats } = useQuery({
    queryKey: ["/api/clients/stats"],
    enabled: open && therapists.length > 0
  });

  // Enhance therapists with current client counts
  const therapistsWithCounts = therapists.map(therapist => ({
    ...therapist,
    clientCount: clientStats?.byTherapist?.find((stat: any) => stat.therapistId === therapist.id)?.count || 0
  }));

  const bulkReassignMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/clients/bulk-reassign-therapist", {
        method: "POST",
        body: JSON.stringify({ 
          clientIds: selectedClientIds, 
          therapistIds: selectedTherapists,
          distribution 
        })
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients/stats"] });
      
      const distributionDetails = Object.entries(data.distribution || {})
        .map(([therapistId, count]) => {
          const therapist = therapists.find(t => t.id === parseInt(therapistId));
          return `${therapist?.fullName}: ${count}`;
        })
        .join(", ");

      toast({
        title: "Clients Reassigned",
        description: `Successfully reassigned ${data.successful} client(s). ${distributionDetails}`
      });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Reassignment Failed",
        description: error.message || "Failed to reassign clients",
        variant: "destructive"
      });
    }
  });

  const handleTherapistToggle = (therapistId: number) => {
    if (distribution === "single") {
      setSelectedTherapists([therapistId]);
    } else {
      setSelectedTherapists(prev => 
        prev.includes(therapistId) 
          ? prev.filter(id => id !== therapistId)
          : [...prev, therapistId]
      );
    }
  };

  const handleDistributionChange = (value: "single" | "even") => {
    setDistribution(value);
    if (value === "single" && selectedTherapists.length > 1) {
      setSelectedTherapists([selectedTherapists[0]]);
    }
  };

  const handleSubmit = () => {
    if (selectedTherapists.length === 0) {
      toast({
        title: "No Therapist Selected",
        description: "Please select at least one therapist",
        variant: "destructive"
      });
      return;
    }
    bulkReassignMutation.mutate();
  };

  // Reset on open
  useEffect(() => {
    if (!open) {
      setSelectedTherapists([]);
      setDistribution("single");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="modal-bulk-reassign">
        <DialogHeader>
          <DialogTitle>Reassign Therapist for Multiple Clients</DialogTitle>
          <DialogDescription>
            Reassign {selectedClientIds.length} selected client{selectedClientIds.length !== 1 ? 's' : ''} to new therapist(s).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 max-h-[500px] overflow-y-auto">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This will change the assigned therapist for all {selectedClientIds.length} selected clients.
            </AlertDescription>
          </Alert>

          {/* Distribution Mode */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Distribution Method</label>
            <RadioGroup value={distribution} onValueChange={handleDistributionChange}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="single" id="single" data-testid="radio-single" />
                <Label htmlFor="single">Assign all to one therapist</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="even" id="even" data-testid="radio-even" />
                <Label htmlFor="even">Distribute evenly across multiple therapists (smart balancing)</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Therapist Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {distribution === "single" ? "Select Therapist" : "Select Therapists"}
            </label>
            
            {loadingTherapists ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-2 border rounded-md p-3 max-h-[200px] overflow-y-auto">
                {therapistsWithCounts.map((therapist) => (
                  <div
                    key={therapist.id}
                    className="flex items-center justify-between p-2 hover:bg-accent rounded-md cursor-pointer"
                    onClick={() => handleTherapistToggle(therapist.id)}
                    data-testid={`therapist-option-${therapist.id}`}
                  >
                    <div className="flex items-center gap-3">
                      {distribution === "single" ? (
                        <RadioGroupItem
                          value={therapist.id.toString()}
                          id={`therapist-${therapist.id}`}
                          checked={selectedTherapists.includes(therapist.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <Checkbox
                          id={`therapist-${therapist.id}`}
                          checked={selectedTherapists.includes(therapist.id)}
                          onCheckedChange={() => handleTherapistToggle(therapist.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <Label htmlFor={`therapist-${therapist.id}`} className="cursor-pointer">
                        <div className="font-medium">{therapist.fullName}</div>
                        <div className="text-xs text-muted-foreground">@{therapist.username}</div>
                      </Label>
                    </div>
                    <Badge variant="secondary" className="gap-1">
                      <Users className="h-3 w-3" />
                      {therapist.clientCount} clients
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Smart Distribution Preview */}
          {distribution === "even" && selectedTherapists.length > 1 && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Smart distribution will balance workload by assigning clients to therapists with the fewest active cases.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={bulkReassignMutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={bulkReassignMutation.isPending || selectedTherapists.length === 0}
            data-testid="button-confirm-reassign"
          >
            {bulkReassignMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Reassigning...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Reassign {selectedClientIds.length} Client{selectedClientIds.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
