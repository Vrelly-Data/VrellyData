import { AlertCircle, Coins, Unlock } from 'lucide-react';
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
  alreadyUnlocked: number;
  alreadyOwned?: number;
  canUpdate?: number;
  needUnlock: number;
  creditsRequired: number;
  currentCredits: number;
  onConfirm: () => void;
  onCancel: () => void;
  action: 'export' | 'list' | 'send';
}

export function UnlockConfirmDialog({
  open,
  onOpenChange,
  totalRecords,
  alreadyUnlocked,
  alreadyOwned = 0,
  canUpdate = 0,
  needUnlock,
  creditsRequired,
  currentCredits,
  onConfirm,
  onCancel,
  action,
}: UnlockConfirmDialogProps) {
  const hasEnoughCredits = currentCredits >= creditsRequired;
  const remainingCredits = currentCredits - creditsRequired;

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
            Review the unlock cost before proceeding
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
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-green-600">Already in Database</span>
                  <span className="text-sm font-semibold text-green-600">
                    {alreadyOwned.toLocaleString()} (No charge)
                  </span>
                </div>
              </div>
            )}
            
            {canUpdate > 0 && (
              <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-600">Updates Available</span>
                  <span className="text-sm font-semibold text-blue-600">
                    {canUpdate.toLocaleString()} (No charge)
                  </span>
                </div>
              </div>
            )}
            
            {alreadyUnlocked > 0 && (
              <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-amber-600">Previously Unlocked</span>
                  <span className="text-sm font-semibold text-amber-600">
                    {alreadyUnlocked.toLocaleString()} (No charge)
                  </span>
                </div>
              </div>
            )}
            
            {needUnlock > 0 && (
              <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">New Contacts</span>
                  <span className="text-sm font-semibold">
                    {needUnlock.toLocaleString()} ({creditsRequired} credits)
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Your Credits</span>
              <span className={`text-sm font-semibold ${hasEnoughCredits ? 'text-green-600' : 'text-red-600'}`}>
                {currentCredits.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">After {actionLabels[action]}</span>
              <span className="text-sm font-semibold">
                {remainingCredits.toLocaleString()}
              </span>
            </div>
          </div>

          {!hasEnoughCredits && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You don't have enough credits. You need {(creditsRequired - currentCredits).toLocaleString()} more credits.
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
            <Button onClick={() => window.location.href = '/settings'}>
              Upgrade Plan
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
