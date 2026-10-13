import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  compactFilters,
  type SignalBreakdown, type SignalFilters, type SignalRow, type SignalRun, type SignalSettings, type SignalSite,
  type SignalSource, type SignalStatus, type SourceStats, type TeamSignalSettings, type TypeCount,
} from '@/lib/signals';

// Signals tables / RPCs are not in the generated Supabase types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

// ------------------------------------------------------------- read side ---

/** The caller's team defaults (country filter) and admin flag. */
export function useSignalSettings() {
  return useQuery({
    queryKey: ['signals', 'settings'],
    queryFn: () => rpc<SignalSettings>('signals_my_settings'),
    staleTime: 5 * 60_000,
  });
}

/** Per-type counts of what the caller may read, under the market / country / search filters. */
export function useSignalsOverview(f: Pick<SignalFilters, 'markets' | 'country' | 'include_unknown_country'>, enabled = true) {
  return useQuery({
    queryKey: ['signals', 'overview', f],
    enabled,
    queryFn: () => rpc<TypeCount[]>('signals_overview', { p_filters: compactFilters(f) }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export const SIGNALS_PAGE_SIZE = 50;

export function useSignalsFeed(f: SignalFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: ['signals', 'feed', f, page],
    enabled: enabled && !!f.type,
    queryFn: () =>
      rpc<{ total: number; rows: SignalRow[] }>('signals_feed', {
        p_filters: compactFilters(f),
        p_limit: SIGNALS_PAGE_SIZE,
        p_offset: page * SIGNALS_PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });
}

/** Counts by industry / seniority / title / state / country / size (admins: + platform, campaign). */
export function useSignalsBreakdown(f: SignalFilters, enabled = true) {
  return useQuery({
    queryKey: ['signals', 'breakdown', f],
    enabled: enabled && !!f.type,
    queryFn: () => rpc<SignalBreakdown>('signals_breakdown', { p_filters: compactFilters(f) }),
    placeholderData: (prev) => prev,
  });
}

export function useSetSignalStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: Exclude<SignalStatus, 'pushed'> }) =>
      rpc<number>('signals_set_status', { p_signal_ids: ids, p_status: status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signals'] }),
  });
}

// ------------------------------------------------------------ admin side ---

export function useSignalSources(enabled = true) {
  return useQuery({
    queryKey: ['signals', 'sources'],
    enabled,
    queryFn: async (): Promise<SignalSource[]> => {
      const { data, error } = await sb.from('signal_sources').select('*').order('signal_type').order('key');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    refetchInterval: 30_000,
  });
}

export function useSourceStats(enabled = true) {
  return useQuery({
    queryKey: ['signals', 'source-stats'],
    enabled,
    queryFn: () => rpc<SourceStats[]>('signals_admin_source_stats'),
    refetchInterval: 60_000,
  });
}

export function useSignalRuns(sourceKey: string | null, enabled = true) {
  return useQuery({
    queryKey: ['signals', 'runs', sourceKey],
    enabled,
    queryFn: async (): Promise<SignalRun[]> => {
      let q = sb.from('signal_runs').select('*').order('started_at', { ascending: false }).limit(50);
      if (sourceKey) q = q.eq('source_key', sourceKey);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    refetchInterval: 30_000,
  });
}

export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { key: string; patch: Partial<Pick<SignalSource, 'name' | 'config' | 'is_active' | 'cadence' | 'default_markets'>> }) => {
      const { error } = await sb.from('signal_sources').update(p.patch).eq('key', p.key);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signals'] }),
  });
}

/** Admin "Run now": the dispatcher runs exactly this source with the caller's JWT. */
export function useRunSourceNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceKey: string) => {
      const { data, error } = await supabase.functions.invoke('dispatch-signal-sources', { body: { source_key: sourceKey } });
      if (error) throw new Error(error.message);
      return data as { ran: Array<{ source: string; status: string | null; inserted: number | null; error: string | null }> };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['signals'] }),
  });
}

// ----------------------------------------------------------------- sites ---

export function useSignalSites() {
  return useQuery({
    queryKey: ['signals', 'sites'],
    queryFn: async (): Promise<SignalSite[]> => {
      const { data, error } = await sb.from('signal_sites').select('site_key, team_id, domain, is_active, created_at').order('created_at');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useRegisterSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, teamId }: { domain: string; teamId?: string | null }) =>
      rpc<SignalSite>('signals_register_site', { p_domain: domain, p_team_id: teamId ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signals', 'sites'] }),
  });
}

export function useToggleSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ siteKey, isActive }: { siteKey: string; isActive: boolean }) => {
      const { error } = await sb.from('signal_sites').update({ is_active: isActive }).eq('site_key', siteKey);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signals', 'sites'] }),
  });
}

/** Admin: team names for the site list (teams is readable by admins via existing policies, else ids show). */
export function useTeamNames(ids: string[], enabled = true) {
  return useQuery({
    queryKey: ['signals', 'team-names', [...ids].sort()],
    enabled: enabled && ids.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data } = await sb.from('teams').select('id, name').in('id', ids);
      return Object.fromEntries((data ?? []).map((t: { id: string; name: string }) => [t.id, t.name]));
    },
  });
}

// ------------------------------------------------------- team settings ---

/** Admin: every team's Signals settings (default market, country, Apollo enrichment). */
export function useTeamSignalSettings(enabled = true) {
  return useQuery({
    queryKey: ['signals', 'team-settings'],
    enabled,
    queryFn: () => rpc<TeamSignalSettings[]>('signals_admin_teams'),
  });
}

export function useSetTeamSignalSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { teamId: string; defaultMarket: string | null; country: string | null; apolloEnrich: boolean }) =>
      rpc<void>('signals_admin_set_team', {
        p_team_id: p.teamId, p_default_market: p.defaultMarket, p_country: p.country, p_apollo_enrich: p.apolloEnrich,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signals'] }),
  });
}
