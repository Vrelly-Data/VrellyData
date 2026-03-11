import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useCredits() {
  return useQuery({
    queryKey: ['user-credits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_credits')
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: 60000, // refresh every minute
  });
}

// Helper: returns display-friendly credit info
export function useCreditDisplay() {
  const { data: credits, isLoading } = useCredits();

  if (!credits) return { isLoading, plan: null, exports: null, aiGens: null };

  const isEnterprise = credits.plan === 'enterprise';

  return {
    isLoading,
    plan: credits.plan,
    billingInterval: credits.billing_interval,
    status: credits.subscription_status,
    exports: isEnterprise
      ? { used: credits.enterprise_daily_exports, total: 100000, label: 'today', display: 'Unlimited' }
      : { used: credits.export_credits_used, total: credits.export_credits_total, label: 'this month', display: null },
    aiGens: {
      used: credits.ai_credits_used,
      total: credits.ai_credits_total,
      label: 'this month',
    },
    periodEnd: credits.current_period_end,
  };
}
