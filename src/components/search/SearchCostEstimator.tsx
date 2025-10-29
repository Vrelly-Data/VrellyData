import { AlertCircle, Coins, TrendingUp } from 'lucide-react';
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

interface SearchCostEstimatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimatedResults: number;
  estimatedCost: number;
  currentCredits: number;
  onProceed: () => void;
  onCancel: () => void;
}

export function SearchCostEstimator({
  open,
  onOpenChange,
  estimatedResults,
  estimatedCost,
  currentCredits,
  onProceed,
  onCancel,
}: SearchCostEstimatorProps) {
  const hasEnoughCredits = currentCredits >= estimatedCost;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Search Cost Estimate
          </DialogTitle>
          <DialogDescription>
            Review the estimated cost before proceeding with your search
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 p-3 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Estimated Results</p>
              <p className="text-2xl font-bold">{estimatedResults.toLocaleString()}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Credit Cost</p>
              <p className="text-2xl font-bold flex items-center gap-1">
                <Coins className="h-5 w-5" />
                {estimatedCost.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Your Credits</span>
              <span className={`text-sm font-semibold ${hasEnoughCredits ? 'text-green-600' : 'text-red-600'}`}>
                {currentCredits.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">After Search</span>
              <span className="text-sm font-semibold">
                {(currentCredits - estimatedCost).toLocaleString()}
              </span>
            </div>
          </div>

          {!hasEnoughCredits && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You don't have enough credits for this search. You need {(estimatedCost - currentCredits).toLocaleString()} more credits.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {hasEnoughCredits ? (
            <Button onClick={onProceed}>
              Proceed with Search
            </Button>
          ) : (
            <Button onClick={() => window.location.href = '/billing'}>
              Upgrade Plan
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
