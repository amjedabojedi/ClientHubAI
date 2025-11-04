import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BulkStatusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedClientIds: number[];
  onSuccess: () => void;
}

export default function BulkStatusModal({
  open,
  onOpenChange,
  selectedClientIds,
  onSuccess
}: BulkStatusModalProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string>("");
  const { toast } = useToast();

  // Fetch system options for statuses
  const { data: systemOptions } = useQuery<any[]>({
    queryKey: ["/api/system-options/categories"],
    enabled: open
  });

  const statusCategory = systemOptions?.find?.((cat: any) => cat.categoryKey === "client_status");
  const { data: statusOptionsData } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${statusCategory?.id}`],
    enabled: !!statusCategory?.id && open
  });

  const statusOptions = statusOptionsData?.options || [];

  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      const selectedOption = statusOptions.find((s: any) => s.id.toString() === selectedOptionId);
      const status = selectedOption?.optionKey || "";
      const response = await apiRequest("/api/clients/bulk-update-status", "POST", { 
        clientIds: selectedClientIds, 
        status 
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      const selectedOption = statusOptions.find((s: any) => s.id.toString() === selectedOptionId);
      const selectedStatusLabel = selectedOption?.optionLabel || "selected status";
      toast({
        title: "Status Updated",
        description: `Successfully updated ${data.successful} client(s) to "${selectedStatusLabel}" status.`
      });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update client status",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = () => {
    if (!selectedOptionId) {
      toast({
        title: "Selection Required",
        description: "Please select a status before proceeding",
        variant: "destructive"
      });
      return;
    }
    bulkUpdateMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="modal-bulk-status">
        <DialogHeader>
          <DialogTitle>Update Status for Multiple Clients</DialogTitle>
          <DialogDescription>
            Update the status for {selectedClientIds.length} selected client{selectedClientIds.length !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This will change the status for all {selectedClientIds.length} selected clients. This action cannot be undone.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <label className="text-sm font-medium">New Status (select one)</label>
            <RadioGroup value={selectedOptionId} onValueChange={setSelectedOptionId}>
              <div className="space-y-2">
                {statusOptions.map((option: any) => (
                  <div key={option.id} className="flex items-center space-x-2">
                    <RadioGroupItem 
                      value={option.id.toString()} 
                      id={`status-${option.id}`}
                      data-testid={`radio-status-${option.id}`}
                    />
                    <Label 
                      htmlFor={`status-${option.id}`} 
                      className="cursor-pointer font-normal"
                    >
                      {option.optionLabel}
                    </Label>
                  </div>
                ))}
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={bulkUpdateMutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={bulkUpdateMutation.isPending || !selectedOptionId}
            data-testid="button-confirm-status"
          >
            {bulkUpdateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Update {selectedClientIds.length} Client{selectedClientIds.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
