import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthStore } from '@/stores/authStore';
import { SUBSCRIPTION_TIERS } from '@/config/subscriptionTiers';

export function CreditDisplay() {
  const { profile, profileLoading } = useAuthStore();
  
  const credits = profile?.credits ?? 0;
  const tier = (profile?.subscription_tier || 'starter') as keyof typeof SUBSCRIPTION_TIERS;
  const tierConfig = SUBSCRIPTION_TIERS[tier] || SUBSCRIPTION_TIERS.starter;
  const maxCredits = tierConfig.credits;
  const percentRemaining = maxCredits > 0 ? (credits / maxCredits) * 100 : 0;

  const colorClass = cn(
    'transition-colors',
    percentRemaining >= 50 ? 'text-green-600' :
    percentRemaining >= 20 ? 'text-yellow-600' :
    'text-red-600'
  );

  if (profileLoading) {
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
              {credits.toLocaleString()} credits
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1">
            <p className="font-medium">Credits Remaining</p>
            <p className="text-sm text-muted-foreground">
              {credits.toLocaleString()} of {maxCredits.toLocaleString()} credits
            </p>
            <p className="text-xs text-muted-foreground capitalize">
              {tier} plan
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
