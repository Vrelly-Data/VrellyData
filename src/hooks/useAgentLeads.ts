import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AgentLead {
  id: string;
  user_id: string;
  external_id: string;
  full_name: string | null;
  email: string | null;
  last_reply_text: string | null;
  inbox_status: string;
  channel: string;
  heyreach_conversation_id: string | null;
  heyreach_account_id: number | null;
  linkedin_url: string | null;
  draft_approved: boolean;
  created_at: string;
  updated_at: string;
}

interface UseAgentLeadsOptions {
  status?: string;
  channel?: string;
}

export function useAgentLeads(options: UseAgentLeadsOptions = {}) {
  const { status, channel } = options;

  return useQuery({
    queryKey: ['agent-leads', status, channel],
    queryFn: async (): Promise<AgentLead[]> => {
      let query = supabase
        .from('agent_leads')
        .select('*')
        .order('updated_at', { ascending: false });

      if (status) {
        query = query.eq('inbox_status', status);
      }

      if (channel) {
        query = query.eq('channel', channel);
      }

      const { data, error } = await query;

      if (error) throw error;
      return (data || []) as AgentLead[];
    },
  });
}
