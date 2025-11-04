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

interface BulkStageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedClientIds: number[];
  onSuccess: () => void;
}

export default function BulkStageModal({
  open,
  onOpenChange,
  selectedClientIds,
  onSuccess
}: BulkStageModalProps) {
  const [stage, setStage] = useState<string>("");
  const { toast } = useToast();

  // Debug: Log when stage changes
  console.log('[BulkStageModal] Current stage value:', stage);

  // Fetch system options for stages
  const { data: systemOptions } = useQuery<any[]>({
    queryKey: ["/api/system-options/categories"],
    enabled: open
  });

  const stageCategory = systemOptions?.find?.((cat: any) => cat.categoryKey === "client_stage");
  const { data: stageOptionsData } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${stageCategory?.id}`],
    enabled: !!stageCategory?.id && open
  });

  const stageOptions = stageOptionsData?.options || [];

  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/clients/bulk-update-stage", "POST", { 
        clientIds: selectedClientIds, 
        stage 
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      const selectedStageLabel = stageOptions.find((s: any) => s.optionValue === stage)?.optionLabel || stage;
      toast({
        title: "Stage Updated",
        description: `Successfully updated ${data.successful} client(s) to "${selectedStageLabel}" stage.`
      });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update client stages",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = () => {
    if (!stage) {
      toast({
        title: "Selection Required",
        description: "Please select a stage before proceeding",
        variant: "destructive"
      });
      return;
    }
    bulkUpdateMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="modal-bulk-stage">
        <DialogHeader>
          <DialogTitle>Change Stage for Multiple Clients</DialogTitle>
          <DialogDescription>
            Update the therapy stage for {selectedClientIds.length} selected client{selectedClientIds.length !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This will change the stage for all {selectedClientIds.length} selected clients. This action cannot be undone.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <label className="text-sm font-medium">New Stage (select one)</label>
            <RadioGroup value={stage} onValueChange={setStage}>
              <div className="space-y-2">
                {stageOptions.map((option: any) => (
                  <div key={option.id} className="flex items-center space-x-2">
                    <RadioGroupItem 
                      value={option.optionValue} 
                      id={`stage-${option.id}`}
                      data-testid={`radio-stage-${option.optionValue}`}
                    />
                    <Label 
                      htmlFor={`stage-${option.id}`} 
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
            disabled={bulkUpdateMutation.isPending || !stage}
            data-testid="button-confirm-stage"
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
