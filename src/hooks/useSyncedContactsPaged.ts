import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EngagementData, SyncedContact } from './useSyncedContacts';

interface UseSyncedContactsPagedParams {
  campaignId?: string;
  status?: string;
  page: number;
  perPage: number;
}

interface PagedContactsResult {
  contacts: SyncedContact[];
  totalCount: number;
}

export function useSyncedContactsPaged({
  campaignId,
  status,
  page,
  perPage,
}: UseSyncedContactsPagedParams) {
  return useQuery({
    queryKey: ['synced-contacts-paged', campaignId, status, page, perPage],
    queryFn: async (): Promise<PagedContactsResult> => {
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;

      let query = supabase
        .from('synced_contacts')
        .select('id, email, first_name, last_name, company, job_title, status, campaign_id, engagement_data, industry, company_size, city, state, country, phone, linkedin_url, added_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      // Apply filters
      if (campaignId && campaignId !== 'all') {
        query = query.eq('campaign_id', campaignId);
      }

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      const contacts = (data || []).map(row => ({
        ...row,
        engagement_data: row.engagement_data as EngagementData | null,
      }));

      return {
        contacts,
        totalCount: count || 0,
      };
    },
  });
}

// Helper to fetch all contacts for CSV export (paginated fetches)
export async function fetchAllContactsForExport(
  campaignId?: string,
  status?: string
): Promise<SyncedContact[]> {
  const allContacts: SyncedContact[] = [];
  const batchSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('synced_contacts')
      .select('id, email, first_name, last_name, company, job_title, status, campaign_id, engagement_data, industry, company_size, city, state, country, phone, linkedin_url, added_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (campaignId && campaignId !== 'all') {
      query = query.eq('campaign_id', campaignId);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    const contacts = (data || []).map(row => ({
      ...row,
      engagement_data: row.engagement_data as EngagementData | null,
    }));

    allContacts.push(...contacts);
    
    // If we got fewer than batchSize, we've reached the end
    hasMore = contacts.length === batchSize;
    offset += batchSize;
  }

  return allContacts;
}
