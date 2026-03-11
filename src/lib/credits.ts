import { supabase } from '@/integrations/supabase/client';

export async function useCredit(type: 'export' | 'ai_generation', amount = 1): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-and-use-credits`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credit_type: type, amount }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    if (err.code === 'NO_SUBSCRIPTION') throw new Error('UPGRADE_REQUIRED');
    if (err.code === 'NO_CREDITS') throw new Error('OUT_OF_CREDITS');
    if (err.code === 'DAILY_LIMIT') throw new Error('DAILY_LIMIT_REACHED');
    throw new Error(err.error || 'Credit check failed');
  }
}
