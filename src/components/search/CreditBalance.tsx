import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CreditBalance() {
  const [credits, setCredits] = useState(0);
  const [monthlyLimit, setMonthlyLimit] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCredits();
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('profile-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => {
        fetchCredits();
      })
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchCredits() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data } = await supabase
        .from('profiles')
        .select('credits, monthly_credit_limit')
        .eq('id', user.id)
        .single();
      
      if (data) {
        setCredits(data.credits);
        setMonthlyLimit(data.monthly_credit_limit || 0);
      }
    } catch (error) {
      console.error('Error fetching credits:', error);
    } finally {
      setLoading(false);
    }
  }

  const percentageRemaining = monthlyLimit > 0 ? (credits / monthlyLimit) * 100 : 100;
  
  const colorClass = cn(
    'transition-colors',
    percentageRemaining > 50 ? 'text-green-600' :
    percentageRemaining > 20 ? 'text-yellow-600' :
    'text-red-600'
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Coins className="h-4 w-4 animate-pulse" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Coins className={cn('h-4 w-4', colorClass)} />
      <span className={colorClass}>
        <span className="font-semibold">{credits}</span>
        {monthlyLimit > 0 && <span className="text-muted-foreground"> / {monthlyLimit}</span>}
        <span className="text-muted-foreground ml-1">credits</span>
      </span>
    </div>
  );
}
