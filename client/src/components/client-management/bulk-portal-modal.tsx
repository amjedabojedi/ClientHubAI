import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2, Lock, Unlock } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface BulkPortalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedClientIds: number[];
  onSuccess: () => void;
}

export default function BulkPortalModal({
  open,
  onOpenChange,
  selectedClientIds,
  onSuccess
}: BulkPortalModalProps) {
  const [enable, setEnable] = useState(true);
  const { toast } = useToast();

  const bulkPortalMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/clients/bulk-portal-access", "POST", { 
        clientIds: selectedClientIds, 
        enable 
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      
      const skippedMessage = data.skipped > 0 
        ? ` (${data.skipped} skipped due to missing email)`
        : '';
      
      toast({
        title: "Portal Access Updated",
        description: `Successfully ${enable ? 'enabled' : 'disabled'} portal access for ${data.successful} client(s)${skippedMessage}.`
      });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update portal access",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = () => {
    bulkPortalMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="modal-bulk-portal">
        <DialogHeader>
          <DialogTitle>Manage Portal Access for Multiple Clients</DialogTitle>
          <DialogDescription>
            Update portal access for {selectedClientIds.length} selected client{selectedClientIds.length !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {enable 
                ? "Enabling portal access allows clients to view appointments, documents, and invoices. Clients without email addresses will be skipped."
                : "Disabling portal access will prevent clients from logging into the client portal."
              }
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <label className="text-sm font-medium">Action</label>
            <RadioGroup value={enable ? "enable" : "disable"} onValueChange={(value) => setEnable(value === "enable")}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="enable" id="enable" data-testid="radio-enable" />
                <Label htmlFor="enable" className="flex items-center gap-2 cursor-pointer">
                  <Unlock className="h-4 w-4 text-green-600" />
                  Enable portal access
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="disable" id="disable" data-testid="radio-disable" />
                <Label htmlFor="disable" className="flex items-center gap-2 cursor-pointer">
                  <Lock className="h-4 w-4 text-red-600" />
                  Disable portal access
                </Label>
              </div>
            </RadioGroup>
          </div>

          {enable && (
            <Alert className="bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                Clients will need to set up their portal password on first login using their email address.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={bulkPortalMutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={bulkPortalMutation.isPending}
            variant={enable ? "default" : "destructive"}
            data-testid="button-confirm-portal"
          >
            {bulkPortalMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {enable ? 'Enable' : 'Disable'} for {selectedClientIds.length} Client{selectedClientIds.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
