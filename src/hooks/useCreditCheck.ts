import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAudienceStore } from '@/stores/audienceStore';
import { toast } from '@/hooks/use-toast';

const DAILY_LIMIT = 10000;

interface DailyCreditStatus {
  credits_used_today: number;
  daily_limit: number;
  remaining_today: number;
  last_reset_date: string | null;
}

interface DeductResult {
  success: boolean;
  remainingToday: number;
  error?: string;
}

export function useCreditCheck() {
  const [isDeducting, setIsDeducting] = useState(false);
  const currentType = useAudienceStore(state => state.currentType);

  const getDailyCreditStatus = async (): Promise<DailyCreditStatus> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return {
        credits_used_today: 0,
        daily_limit: DAILY_LIMIT,
        remaining_today: DAILY_LIMIT,
        last_reset_date: null,
      };
    }
    
    try {
      const { data, error } = await supabase.rpc('get_daily_credit_status', {
        p_user_id: user.id,
      });
      
      if (error) throw error;
      
      // Parse the jsonb response
      const status = data as unknown as DailyCreditStatus;
      return status;
    } catch (err) {
      console.error('Error getting daily credit status:', err);
      // Fallback to reading from profile directly with type casting
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      // Access new columns via type casting since they may not be in generated types yet
      const profileData = profile as any;
      const usedToday = profileData?.credits_used_today || 0;
      return {
        credits_used_today: usedToday,
        daily_limit: DAILY_LIMIT,
        remaining_today: DAILY_LIMIT - usedToday,
        last_reset_date: profileData?.last_credit_reset_date || null,
      };
    }
  };

  const getRemainingCreditsToday = async (): Promise<number> => {
    const status = await getDailyCreditStatus();
    return status.remaining_today;
  };

  const hasEnoughCredits = async (requiredCredits: number): Promise<boolean> => {
    const remaining = await getRemainingCreditsToday();
    return remaining >= requiredCredits;
  };

  const deductCredits = async (amount: number, audienceId?: string): Promise<DeductResult> => {
    setIsDeducting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      // Call the updated database function that returns jsonb
      const { data, error } = await supabase.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: amount,
      });
      
      if (error) throw error;
      
      const result = data as unknown as { success: boolean; remaining_today: number; error?: string };
      
      if (!result.success) {
        toast({
          title: 'Daily Limit Reached',
          description: result.error || `You can only download ${DAILY_LIMIT.toLocaleString()} contacts per day.`,
          variant: 'destructive',
        });
        return { 
          success: false, 
          remainingToday: result.remaining_today,
          error: result.error,
        };
      }
      
      // Log transaction
      await supabase.from('credit_transactions').insert({
        user_id: user.id,
        audience_id: audienceId || '',
        entity_type: currentType,
        records_returned: amount,
        credits_deducted: amount,
      });
      
      toast({
        title: 'Credits Used',
        description: `${amount.toLocaleString()} credits used. ${result.remaining_today.toLocaleString()} remaining today.`,
      });
      
      return { success: true, remainingToday: result.remaining_today };
    } catch (error) {
      console.error('Error deducting credits:', error);
      toast({
        title: 'Error',
        description: 'Failed to deduct credits',
        variant: 'destructive',
      });
      return { success: false, remainingToday: 0, error: 'Failed to deduct credits' };
    } finally {
      setIsDeducting(false);
    }
  };

  return { 
    hasEnoughCredits, 
    deductCredits, 
    getDailyCreditStatus,
    getRemainingCreditsToday,
    isDeducting,
    DAILY_LIMIT,
  };
}
