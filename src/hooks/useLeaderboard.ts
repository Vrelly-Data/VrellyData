import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LeaderboardEntry {
  rank: number;
  messages_sent: number;
  replies: number;
  reply_rate: number;
  contacts: number;
  completion_rate: number;
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ['campaign-leaderboard'],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { data, error } = await supabase
        .rpc('get_campaign_leaderboard', { p_limit: 50 });
      
      if (error) throw error;
      return (data || []) as LeaderboardEntry[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
