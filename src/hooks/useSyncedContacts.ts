import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SyncedContact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  status: string | null;
  campaign_id: string;
}

export function useSyncedContacts() {
  return useQuery({
    queryKey: ['synced-contacts'],
    queryFn: async (): Promise<SyncedContact[]> => {
      const { data, error } = await supabase
        .from('synced_contacts')
        .select('id, email, first_name, last_name, company, job_title, status, campaign_id')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    },
  });
}
