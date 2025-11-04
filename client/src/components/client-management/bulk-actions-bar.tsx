import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, RefreshCw, Lock, Activity, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface BulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onChangeStage: () => void;
  onReassignTherapist: () => void;
  onTogglePortalAccess: () => void;
  onUpdateStatus: () => void;
}

export default function BulkActionsBar({
  selectedCount,
  onClearSelection,
  onChangeStage,
  onReassignTherapist,
  onTogglePortalAccess,
  onUpdateStatus
}: BulkActionsBarProps) {
  const { user } = useAuth();

  // Only show for admin and supervisor
  if (!user || user.role === 'therapist') {
    return null;
  }

  if (selectedCount === 0) {
    return null;
  }

  const isAdmin = user.role === 'admin' || user.role === 'administrator';

  return (
    <div 
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground rounded-lg shadow-2xl border border-primary/20 p-4 min-w-[600px] max-w-[800px]"
      data-testid="bulk-actions-bar"
    >
      <div className="flex items-center justify-between gap-4">
        {/* Selection Count */}
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-base px-3 py-1">
            {selectedCount} client{selectedCount !== 1 ? 's' : ''} selected
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            className="text-primary-foreground hover:bg-primary-foreground/20"
            data-testid="button-clear-selection"
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onChangeStage}
            className="gap-2"
            data-testid="button-bulk-change-stage"
          >
            <Activity className="h-4 w-4" />
            Change Stage
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={onReassignTherapist}
            className="gap-2"
            data-testid="button-bulk-reassign"
          >
            <Users className="h-4 w-4" />
            Reassign Therapist
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={onUpdateStatus}
            className="gap-2"
            data-testid="button-bulk-update-status"
          >
            <RefreshCw className="h-4 w-4" />
            Update Status
          </Button>

          {/* Portal Access - Admin Only */}
          {isAdmin ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onTogglePortalAccess}
              className="gap-2"
              data-testid="button-bulk-portal-access"
            >
              <Lock className="h-4 w-4" />
              Portal Access
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled
              className="gap-2 opacity-50 cursor-not-allowed"
              data-testid="button-bulk-portal-access-disabled"
              title="Only administrators can modify portal access"
            >
              <Lock className="h-4 w-4" />
              Portal Access
            </Button>
          )}
        </div>
      </div>

      {/* Supervisor Scope Warning */}
      {!isAdmin && (
        <div className="mt-2 text-xs text-primary-foreground/80 border-t border-primary-foreground/20 pt-2">
          ⚠️ Supervisor mode: You can only modify clients assigned to therapists you supervise
        </div>
      )}
    </div>
  );
}
