import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCredits } from '@/hooks/useCredits';

export function CreditDisplay() {
  const { data: credits, isLoading } = useCredits();

  const isEnterprise = credits?.plan === 'enterprise';

  const remainingCredits = credits
    ? isEnterprise
      ? 100000 - (credits.enterprise_daily_exports ?? 0)
      : (credits.export_credits_total ?? 0) - (credits.export_credits_used ?? 0)
    : 0;

  const maxCredits = credits
    ? isEnterprise
      ? 100000
      : (credits.export_credits_total ?? 0)
    : 0;

  const percentRemaining = maxCredits > 0 ? (remainingCredits / maxCredits) * 100 : 0;

  const colorClass = cn(
    'transition-colors',
    percentRemaining >= 50 ? 'text-green-600' :
    percentRemaining >= 20 ? 'text-yellow-600' :
    'text-red-600'
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Coins className="h-4 w-4 animate-pulse" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 text-sm cursor-help">
            <Coins className={cn('h-4 w-4', colorClass)} />
            <span className={cn('font-semibold', colorClass)}>
              {isEnterprise ? 'Unlimited' : remainingCredits.toLocaleString()} credits
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1">
            <p className="font-medium">Credits Remaining</p>
            <p className="text-sm text-muted-foreground">
              {isEnterprise
                ? 'Unlimited (enterprise)'
                : `${remainingCredits.toLocaleString()} of ${maxCredits.toLocaleString()} credits`}
            </p>
            <p className="text-xs text-muted-foreground capitalize">
              {credits?.plan ?? 'starter'} plan
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
