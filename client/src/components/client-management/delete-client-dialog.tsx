import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Client } from "@/types/client";

interface DeleteClientDialogProps {
  client: Client | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleteSuccess?: () => void;
}

export default function DeleteClientDialog({ client, isOpen, onClose, onDeleteSuccess }: DeleteClientDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const deleteClientMutation = useMutation({
    mutationFn: () => apiRequest(`/api/clients/${client?.id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients/stats"] });
      toast({
        title: "Success",
        description: "Client deleted successfully",
      });
      onClose();
      if (onDeleteSuccess) {
        onDeleteSuccess();
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete client",
        variant: "destructive",
      });
    },
  });

  const handleDelete = () => {
    if (client) {
      deleteClientMutation.mutate();
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Client</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{client?.fullName}</strong>? 
            This action cannot be undone and will permanently remove:
            <div className="mt-2 ml-4">
              <p>• Client profile and personal information</p>
              <p>• All session records and notes</p>
              <p>• Documents and attachments</p>
              <p>• Tasks and assessments</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteClientMutation.isPending}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
          >
            {deleteClientMutation.isPending ? "Deleting..." : "Delete Client"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}