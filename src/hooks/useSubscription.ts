import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';

// ── Core subscription data (from user_credits table) ──────────────────────

export function useSubscription() {
  return useQuery({
    queryKey: ['user-subscription'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('user_credits')
        .select('subscription_status, plan, export_credits_total, export_credits_used, ai_credits_total, ai_credits_used, current_period_end')
        .eq('user_id', user.id)
        .single();

      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });
}

// ── Derived guard hook ────────────────────────────────────────────────────

export function useRequireSubscription() {
  const { data, isLoading } = useSubscription();

  return {
    isActive: data?.subscription_status === 'active',
    isLoading,
    plan: data?.plan ?? null,
  };
}

// ── Checkout / portal actions (used by Settings & ChoosePlan) ─────────────

export function useSubscriptionActions() {
  const { toast } = useToast();

  const createCheckoutSession = async (priceIdOrPlan: string, interval?: 'monthly' | 'annual') => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: 'Authentication Required',
          description: 'Please log in to upgrade your plan',
          variant: 'destructive',
        });
        return;
      }

      const body = interval
        ? { plan: priceIdOrPlan, interval }
        : { priceId: priceIdOrPlan };

      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        console.error('Error creating checkout session:', error);
        toast({
          title: 'Error',
          description: 'Failed to create checkout session',
          variant: 'destructive',
        });
        return;
      }

      if (data?.url) {
        const inIframe = window.self !== window.top;
        if (inIframe) {
          window.open(data.url, '_blank');
        } else {
          window.open(data.url, '_top');
        }
      }
    } catch (error) {
      console.error('Error in createCheckoutSession:', error);
      toast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const openCustomerPortal = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: 'Authentication Required',
          description: 'Please log in to manage your subscription',
          variant: 'destructive',
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('customer-portal', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        console.error('Error opening customer portal:', error);
        toast({
          title: 'Error',
          description: 'Failed to open customer portal',
          variant: 'destructive',
        });
        return;
      }

      if (data?.url) {
        window.open(data.url, '_blank');
      }
    } catch (error) {
      console.error('Error in openCustomerPortal:', error);
      toast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const checkSubscription = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await supabase.functions.invoke('check-subscription', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    } catch (error) {
      console.error('Error in checkSubscription:', error);
    }
  };

  return { createCheckoutSession, openCustomerPortal, checkSubscription };
}
