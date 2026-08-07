import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// HeyReach LinkedIn sender accounts, keyed by the numeric id stored on
// agent_leads.heyreach_account_id.
//
// WHY THIS EXISTS. The inbox shows which sender owns a conversation by reading
// `fromName` off the most recent role:'sender' entry in reply_thread. Only the
// Reply.io ingest writes that field — poll-heyreach-inbox, heyreach-webhook and
// send-heyreach-message never do — so HeyReach leads render no sender at all.
// The account NAME is not stored anywhere in the database: no table maps
// heyreach account id to a name, and sender_profiles keys on sender_name
// matching fromName, which HeyReach leads lack. What every HeyReach lead DOES
// carry is heyreach_account_id, so the id is resolved to a name here.
//
// Reuses the already-deployed fetch-heyreach-accounts edge function and the
// same ['heyreach-accounts'] query key as NewClientAnalysisDialog, so the two
// share one cache entry. No backend change, no migration, no backfill.
//
// The function is owner-scoped (JWT + created_by = caller), NOT admin-gated, so
// an ordinary operator gets their own tenant's accounts. When the caller has no
// active HeyReach integration it returns 200 with { accounts: [], reason:
// "no_integration" } — which lands here as an empty map and simply renders
// nothing, exactly as today.
export interface HeyReachAccountSummary {
  id: number;
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
  profileUrl: string | null;
}

function displayName(a: HeyReachAccountSummary): string | null {
  const full = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
  return full || a.emailAddress || null;
}

/**
 * @param enabled Gate the network call — pass false when the visible leads
 *   contain no HeyReach account id, so Reply.io/Smartlead-only tenants never
 *   make the request.
 */
export function useHeyReachAccountNames(enabled: boolean) {
  const query = useQuery({
    queryKey: ['heyreach-accounts'],
    queryFn: async (): Promise<HeyReachAccountSummary[]> => {
      const { data, error } = await supabase.functions.invoke('fetch-heyreach-accounts');
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return ((data as { accounts?: HeyReachAccountSummary[] })?.accounts ?? []);
    },
    enabled,
    staleTime: 5 * 60_000, // sender accounts change rarely
    // Display-only enrichment: a failure must never surface as an error state,
    // it just means the sender line stays hidden as it is today.
    retry: 1,
  });

  const names = new Map<number, string>();
  for (const a of query.data ?? []) {
    const n = displayName(a);
    if (n != null && Number.isFinite(a.id)) names.set(Number(a.id), n);
  }
  return names;
}
