import { useState } from 'react';
import { useCredit } from '@/lib/credits';
import { useCredits } from '@/hooks/useCredits';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface DeductResult {
  success: boolean;
  remainingCredits: number;
  error?: string;
}

interface DeductOptions {
  entityType?: 'person' | 'company';
  recordCount?: number;
}

export function useCreditCheck() {
  const [isDeducting, setIsDeducting] = useState(false);
  const { data: credits } = useCredits();
  const queryClient = useQueryClient();

  const getRemainingCredits = (): number => {
    if (!credits) return 0;
    if (credits.plan === 'enterprise') {
      // Enterprise: show daily remaining (100,000 - daily used)
      return 100000 - (credits.enterprise_daily_exports ?? 0);
    }
    return (credits.export_credits_total ?? 0) - (credits.export_credits_used ?? 0);
  };

  const hasEnoughCredits = async (requiredCredits: number): Promise<boolean> => {
    return getRemainingCredits() >= requiredCredits;
  };

  const deductCredits = async (amount: number, options?: DeductOptions): Promise<DeductResult> => {
    setIsDeducting(true);

    try {
      await useCredit('export', amount);

      // Refresh credits cache so sidebar and other displays update
      queryClient.invalidateQueries({ queryKey: ['user-credits'] });

      // Log the transaction so it appears in Settings > Recent Credit Usage
      if (options?.entityType) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('credit_transactions').insert({
            user_id: user.id,
            entity_type: options.entityType,
            credits_deducted: amount,
            records_returned: options.recordCount ?? amount,
          });
          queryClient.invalidateQueries({ queryKey: ['credit-transactions'] });
        }
      }

      const remaining = Math.max(0, getRemainingCredits() - amount);

      toast({
        title: 'Credits Used',
        description: `${amount.toLocaleString()} credits used.`,
      });

      return { success: true, remainingCredits: remaining };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Credit check failed';
      console.error('[deductCredits] Failed:', message, error);

      if (message === 'UPGRADE_REQUIRED') {
        toast({
          title: 'Subscription Required',
          description: 'Please subscribe to a plan to use export credits.',
          variant: 'destructive',
        });
      } else if (message === 'OUT_OF_CREDITS') {
        toast({
          title: 'Insufficient Credits',
          description: 'You have run out of export credits. Please upgrade your plan.',
          variant: 'destructive',
        });
      } else if (message === 'DAILY_LIMIT_REACHED') {
        toast({
          title: 'Daily Limit Reached',
          description: 'You have reached your daily export limit of 100,000. Resets tomorrow.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: `Failed to deduct credits: ${message}`,
          variant: 'destructive',
        });
      }

      return {
        success: false,
        remainingCredits: getRemainingCredits(),
        error: message,
      };
    } finally {
      setIsDeducting(false);
    }
  };

  return {
    hasEnoughCredits,
    deductCredits,
    getRemainingCredits,
    isDeducting,
  };
}
