import { AlertCircle, Coins, Unlock, RefreshCw, Database, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface UnlockConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalRecords: number;
  alreadyOwned?: number; // Exact match - 0 credits
  canUpdate?: number; // Updated data - 1 credit each
  newRecords?: number; // New contacts - 1 credit each
  creditsRequired: number;
  remainingCredits: number;
  onConfirm: () => void;
  onCancel: () => void;
  action: 'export' | 'list' | 'send';
}

export function UnlockConfirmDialog({
  open,
  onOpenChange,
  totalRecords,
  alreadyOwned = 0,
  canUpdate = 0,
  newRecords = 0,
  creditsRequired,
  remainingCredits,
  onConfirm,
  onCancel,
  action,
}: UnlockConfirmDialogProps) {
  const hasEnoughCredits = remainingCredits >= creditsRequired;
  const creditsAfterAction = remainingCredits - creditsRequired;

  const actionLabels = {
    export: 'Export',
    list: 'Add to List',
    send: 'Send to Tool',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlock className="h-5 w-5" />
            Unlock Contacts to {actionLabels[action]}
          </DialogTitle>
          <DialogDescription>
            Review the credit cost before proceeding
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 p-3 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Total Selected</p>
              <p className="text-2xl font-bold">{totalRecords.toLocaleString()}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Credits Required</p>
              <p className="text-2xl font-bold flex items-center gap-1">
                <Coins className="h-5 w-5" />
                {creditsRequired.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Breakdown of record types */}
          <div className="space-y-2">
            {alreadyOwned > 0 && (
              <div className="p-3 rounded-lg border border-green-500/20 bg-green-500/5">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-green-600" />
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-green-600">Already Downloaded</span>
                    <span className="text-sm font-semibold text-green-600">
                      {alreadyOwned.toLocaleString()} <span className="font-normal">(Free)</span>
                    </span>
                  </div>
                </div>
                <p className="text-xs text-green-600/70 mt-1 ml-6">
                  Identical to your last download - no credit charge
                </p>
              </div>
            )}
            
            {canUpdate > 0 && (
              <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-blue-600" />
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-600">Updated Data Available</span>
                    <span className="text-sm font-semibold text-blue-600">
                      {canUpdate.toLocaleString()} <span className="font-normal">({canUpdate} credits)</span>
                    </span>
                  </div>
                </div>
                <p className="text-xs text-blue-600/70 mt-1 ml-6">
                  New information since your last download
                </p>
              </div>
            )}
            
            {newRecords > 0 && (
              <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm font-medium">New Contacts</span>
                    <span className="text-sm font-semibold">
                      {newRecords.toLocaleString()} <span className="font-normal">({newRecords} credits)</span>
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  First time downloading these contacts
                </p>
              </div>
            )}
          </div>

          <div className="p-3 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Credits Available</span>
              <span className={`text-sm font-semibold ${hasEnoughCredits ? 'text-green-600' : 'text-red-600'}`}>
                {remainingCredits.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">After {actionLabels[action]}</span>
              <span className="text-sm font-semibold">
                {creditsAfterAction.toLocaleString()}
              </span>
            </div>
          </div>

          {!hasEnoughCredits && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Insufficient credits. You need {(creditsRequired - remainingCredits).toLocaleString()} more credits. 
                Please upgrade your plan to continue.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {hasEnoughCredits ? (
            <Button onClick={onConfirm}>
              Unlock & {actionLabels[action]}
            </Button>
          ) : (
            <Button disabled variant="secondary">
              Insufficient Credits
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
