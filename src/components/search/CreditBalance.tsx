import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function CreditBalance() {
  const [credits, setCredits] = useState(0);
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
        .select('credits')
        .eq('id', user.id)
        .single();
      
      if (data) {
        setCredits(data.credits || 0);
      }
    } catch (error) {
      console.error('Error fetching credits:', error);
    } finally {
      setLoading(false);
    }
  }

  const colorClass = cn(
    'transition-colors',
    credits >= 1000 ? 'text-green-600' :
    credits >= 100 ? 'text-yellow-600' :
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
          <div className="flex items-center gap-2 text-sm cursor-help">
            <Coins className={cn('h-4 w-4', colorClass)} />
            <span className={colorClass}>
              <span className="font-semibold">{credits.toLocaleString()}</span>
              <span className="text-muted-foreground ml-1">credits</span>
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Your available wallet credits. Monthly usage is shown in Settings.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
