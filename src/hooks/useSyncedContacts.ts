import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Json } from '@/integrations/supabase/types';

export interface EngagementData {
  replied?: boolean;
  delivered?: boolean;
  bounced?: boolean;
  opened?: boolean;
  clicked?: boolean;
  optedOut?: boolean;
  addedAt?: string;
  lastStepCompletedAt?: string;
}

export interface SyncedContact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  status: string | null;
  campaign_id: string;
  engagement_data: EngagementData | null;
}

export function useSyncedContacts() {
  return useQuery({
    queryKey: ['synced-contacts'],
    queryFn: async (): Promise<SyncedContact[]> => {
      const { data, error } = await supabase
        .from('synced_contacts')
        .select('id, email, first_name, last_name, company, job_title, status, campaign_id, engagement_data')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(row => ({
        ...row,
        engagement_data: row.engagement_data as EngagementData | null,
      }));
    },
  });
}
