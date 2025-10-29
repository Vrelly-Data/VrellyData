import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useAudienceStore } from '@/stores/audienceStore';
import { toast } from '@/hooks/use-toast';

const MOCK_MODE = true;

export function useCreditCheck() {
  const [isDeducting, setIsDeducting] = useState(false);
  const currentType = useAudienceStore(state => state.currentType);

  const getCurrentCredits = async (): Promise<number> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;
    
    const { data } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single();
    
    return data?.credits || 0;
  };

  const hasEnoughCredits = async (requiredCredits: number): Promise<boolean> => {
    const credits = await getCurrentCredits();
    return credits >= requiredCredits;
  };

  const deductCredits = async (amount: number, audienceId?: string) => {
    setIsDeducting(true);
    
    try {
      if (MOCK_MODE) {
        // In mock mode, only simulate the deduction
        console.log(`[MOCK] Would deduct ${amount} credits for audience ${audienceId}`);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const currentCredits = await getCurrentCredits();
        
        toast({
          title: 'Mock Mode',
          description: `Would deduct ${amount} credits. Current: ${currentCredits}`,
        });
        
        return { success: true, remainingCredits: currentCredits - amount };
      } else {
        // Real mode: Call database function
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');
        
        const { error } = await supabase.rpc('deduct_credits', {
          p_user_id: user.id,
          p_amount: amount,
        });
        
        if (error) throw error;
        
        // Log transaction
        await supabase.from('credit_transactions').insert({
          user_id: user.id,
          audience_id: audienceId || '',
          entity_type: currentType,
          records_returned: amount,
          credits_deducted: amount,
        });
        
        const remainingCredits = await getCurrentCredits();
        
        toast({
          title: 'Credits Deducted',
          description: `${amount} credits used. ${remainingCredits} remaining.`,
        });
        
        return { success: true, remainingCredits };
      }
    } catch (error) {
      console.error('Error deducting credits:', error);
      toast({
        title: 'Error',
        description: 'Failed to deduct credits',
        variant: 'destructive',
      });
      return { success: false, remainingCredits: 0 };
    } finally {
      setIsDeducting(false);
    }
  };

  return { 
    hasEnoughCredits, 
    deductCredits, 
    getCurrentCredits,
    isDeducting 
  };
}
