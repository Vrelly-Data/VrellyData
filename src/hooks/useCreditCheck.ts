import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAudienceStore } from '@/stores/audienceStore';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/hooks/use-toast';

interface DeductResult {
  success: boolean;
  remainingCredits: number;
  error?: string;
}

export function useCreditCheck() {
  const [isDeducting, setIsDeducting] = useState(false);
  const currentType = useAudienceStore(state => state.currentType);
  const { profile, fetchProfile } = useAuthStore();

  const getRemainingCredits = (): number => {
    return profile?.credits ?? 0;
  };

  const hasEnoughCredits = async (requiredCredits: number): Promise<boolean> => {
    const remaining = getRemainingCredits();
    return remaining >= requiredCredits;
  };

  const deductCredits = async (amount: number, audienceId?: string): Promise<DeductResult> => {
    setIsDeducting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      const currentCredits = profile?.credits ?? 0;
      
      if (currentCredits < amount) {
        toast({
          title: 'Insufficient Credits',
          description: `You need ${amount.toLocaleString()} credits but only have ${currentCredits.toLocaleString()}.`,
          variant: 'destructive',
        });
        return { 
          success: false, 
          remainingCredits: currentCredits,
          error: 'Insufficient credits',
        };
      }
      
      // Call the simplified database function
      const { data, error } = await supabase.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: amount,
      });
      
      if (error) throw error;
      
      const result = data as unknown as { success: boolean; remaining_credits: number; error?: string };
      
      if (!result.success) {
        toast({
          title: 'Insufficient Credits',
          description: result.error || 'You do not have enough credits.',
          variant: 'destructive',
        });
        return { 
          success: false, 
          remainingCredits: result.remaining_credits,
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
      
      // Refresh profile to update credits in UI
      await fetchProfile();
      
      toast({
        title: 'Credits Used',
        description: `${amount.toLocaleString()} credits used. ${result.remaining_credits.toLocaleString()} remaining.`,
      });
      
      return { success: true, remainingCredits: result.remaining_credits };
    } catch (error) {
      console.error('Error deducting credits:', error);
      toast({
        title: 'Error',
        description: 'Failed to deduct credits',
        variant: 'destructive',
      });
      return { success: false, remainingCredits: 0, error: 'Failed to deduct credits' };
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
