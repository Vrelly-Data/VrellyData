import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SyncedSequence {
  id: string;
  campaign_id: string;
  external_sequence_id: string | null;
  step_number: number;
  step_type: string | null;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  delay_days: number | null;
  stats: Record<string, number> | null;
  created_at: string;
  updated_at: string;
}

export interface SequenceWithCampaign extends SyncedSequence {
  campaign_name: string;
}

export function useSyncedSequences(campaignId?: string) {
  return useQuery({
    queryKey: ['synced-sequences', campaignId],
    queryFn: async (): Promise<SequenceWithCampaign[]> => {
      let query = supabase
        .from('synced_sequences')
        .select(`
          id,
          campaign_id,
          external_sequence_id,
          step_number,
          step_type,
          subject,
          body_html,
          body_text,
          delay_days,
          stats,
          created_at,
          updated_at,
          synced_campaigns!inner(name)
        `)
        .order('step_number', { ascending: true });

      if (campaignId) {
        query = query.eq('campaign_id', campaignId);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map(seq => ({
        id: seq.id,
        campaign_id: seq.campaign_id,
        external_sequence_id: seq.external_sequence_id,
        step_number: seq.step_number,
        step_type: seq.step_type,
        subject: seq.subject,
        body_html: seq.body_html,
        body_text: seq.body_text,
        delay_days: seq.delay_days,
        stats: seq.stats as Record<string, number> | null,
        created_at: seq.created_at,
        updated_at: seq.updated_at,
        campaign_name: (seq.synced_campaigns as { name: string })?.name || 'Unknown Campaign',
      }));
    },
  });
}

export function useSyncSequences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ campaignId, integrationId }: { campaignId: string; integrationId: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('sync-reply-sequences', {
        body: { campaignId, integrationId },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['synced-sequences'] });
      toast.success(`Synced ${data.stepsSynced} sequence steps`);
    },
    onError: (error) => {
      toast.error(`Failed to sync sequences: ${error.message}`);
    },
  });
}
