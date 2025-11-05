import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

interface SaveAudienceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalContacts: number;
  currentCredits: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function SaveAudienceDialog({
  open,
  onOpenChange,
  totalContacts,
  currentCredits,
  onConfirm,
  onCancel,
}: SaveAudienceDialogProps) {
  const [audienceName, setAudienceName] = useState('');
  const creditCost = totalContacts;
  const remainingCredits = currentCredits - creditCost;
  const hasEnoughCredits = currentCredits >= creditCost;

  const handleConfirm = () => {
    if (audienceName.trim()) {
      onConfirm(audienceName.trim());
      setAudienceName('');
    }
  };

  const handleCancel = () => {
    setAudienceName('');
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Audience</DialogTitle>
          <DialogDescription>
            Save this audience for future use
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="audience-name">Audience Name</Label>
            <Input
              id="audience-name"
              placeholder="e.g., Tech Companies in California"
              value={audienceName}
              onChange={(e) => setAudienceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hasEnoughCredits && audienceName.trim()) {
                  handleConfirm();
                }
              }}
            />
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total contacts:</span>
              <span className="font-semibold">{totalContacts.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credit cost:</span>
              <span className="font-semibold">{creditCost.toLocaleString()} credits</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current balance:</span>
              <span className="font-semibold">{currentCredits.toLocaleString()} credits</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="text-muted-foreground">Remaining after save:</span>
              <span className={`font-semibold ${remainingCredits < 0 ? 'text-destructive' : 'text-green-600'}`}>
                {remainingCredits.toLocaleString()} credits
              </span>
            </div>
          </div>

          {!hasEnoughCredits && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                You don't have enough credits. Please upgrade your plan to continue.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          {hasEnoughCredits ? (
            <Button
              onClick={handleConfirm}
              disabled={!audienceName.trim()}
            >
              Save Audience
            </Button>
          ) : (
            <Button asChild>
              <a href="/settings?tab=billing">Upgrade Plan</a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
