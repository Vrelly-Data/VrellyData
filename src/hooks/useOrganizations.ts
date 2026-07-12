import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Row shape of public.organizations. RLS is superadmin-only, so a non-superadmin
// simply gets [] from the query — the UI is additionally gated on isSuperAdmin.
export interface Organization {
  id: string;
  user_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  manual_monthly_cents: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_monthly_cents: number | null;
  stripe_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

// Effective monthly amount — MANUAL OVERRIDE ALWAYS WINS. A $0 from Stripe (the
// 100%-off-coupon case) is NOT a real number, so the manual override carries it.
export function effectiveMonthlyCents(o: Organization): number | null {
  return o.manual_monthly_cents ?? o.stripe_monthly_cents ?? null;
}
export function effectiveSource(o: Organization): 'manual' | 'stripe' | 'none' {
  if (o.manual_monthly_cents != null) return 'manual';
  if (o.stripe_monthly_cents != null) return 'stripe';
  return 'none';
}

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: async (): Promise<Organization[]> => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .order('is_active', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Organization[];
    },
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Organization> & { id: string }) => {
      const { id, ...fields } = patch;
      const { error } = await supabase.from('organizations').update(fields).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

// Fire the superadmin-gated sync-org-billing edge function, then refresh.
export function useSyncOrgBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ synced: number; errors: number }> => {
      const { data, error } = await supabase.functions.invoke('sync-org-billing', { body: {} });
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return data as { synced: number; errors: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}
