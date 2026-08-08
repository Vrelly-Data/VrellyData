import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Row shape of public.organizations. RLS is superadmin-only, so a non-superadmin
// simply gets [] from the query — the UI is additionally gated on isSuperAdmin.
export interface Organization {
  id: string;
  // Nullable since 20260807120000: an organization is a CRM record first and a
  // platform account second. NULL = no linked auth.users row yet. UNIQUE is
  // still enforced, but Postgres treats NULLs as distinct, so any number of
  // user-less orgs coexist while linked ones stay 1:1.
  user_id: string | null;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  // Split contact name — additive alongside contact_name, which remains what
  // the table's Contact column renders. Nothing is derived between them.
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  domain: string | null;
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

// Fields a superadmin can set when creating an org by hand. user_id is
// deliberately absent: manual records start unlinked and are associated with an
// account later, which is what nullable user_id bought us.
export type NewOrganization = Pick<
  Organization,
  | 'name'
  | 'contact_name'
  | 'contact_email'
  | 'contact_phone'
  | 'first_name'
  | 'last_name'
  | 'linkedin_url'
  | 'domain'
  | 'notes'
  | 'is_active'
  | 'manual_monthly_cents'
>;

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: NewOrganization): Promise<Organization> => {
      const { data, error } = await supabase
        .from('organizations')
        .insert(fields)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Organization;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

// Hard delete. Safe: nothing references organizations — verified against prod
// and dev, zero inbound foreign keys, zero views, zero functions. There is no
// cascade and no soft-delete column, so this is unrecoverable; the caller is
// responsible for confirming first.
export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('organizations').delete().eq('id', id);
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
