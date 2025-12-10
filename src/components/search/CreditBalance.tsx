import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';

const DAILY_LIMIT = 10000;

export function CreditBalance() {
  const [creditsUsedToday, setCreditsUsedToday] = useState(0);
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
      
      // Try to use the RPC function first
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_daily_credit_status', {
          p_user_id: user.id,
        });
        
        if (!rpcError && rpcData) {
          const status = rpcData as unknown as { credits_used_today: number };
          setCreditsUsedToday(status.credits_used_today || 0);
          return;
        }
      } catch {
        // Fall through to fallback
      }
      
      // Fallback to direct query with type casting
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (data) {
        const profileData = data as any;
        setCreditsUsedToday(profileData.credits_used_today || 0);
      }
    } catch (error) {
      console.error('Error fetching credits:', error);
    } finally {
      setLoading(false);
    }
  }

  const remaining = DAILY_LIMIT - creditsUsedToday;
  const percentUsed = (creditsUsedToday / DAILY_LIMIT) * 100;

  const colorClass = cn(
    'transition-colors',
    remaining >= 8000 ? 'text-green-600' :
    remaining >= 2000 ? 'text-yellow-600' :
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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-3 text-sm cursor-help">
            <Coins className={cn('h-4 w-4', colorClass)} />
            <div className="flex flex-col gap-1 min-w-[120px]">
              <div className="flex items-center justify-between">
                <span className={cn('font-semibold', colorClass)}>
                  {remaining.toLocaleString()}
                </span>
                <span className="text-muted-foreground text-xs">
                  / {DAILY_LIMIT.toLocaleString()}
                </span>
              </div>
              <Progress 
                value={100 - percentUsed} 
                className="h-1.5" 
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1">
            <p className="font-medium">Daily Credits Remaining</p>
            <p className="text-sm text-muted-foreground">
              {creditsUsedToday.toLocaleString()} used today • Resets at midnight
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
