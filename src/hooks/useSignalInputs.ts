import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { SignalRow } from '@/lib/signals';
import type { InputFamily, InputFilters, InputPreview, SignalInput } from '@/lib/signalInputs';

// signal_inputs and its RPCs are not in the generated Supabase types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

async function invokeRunner<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.functions.invoke('signal-inputs-run', { body });
  if (error) {
    // functions.invoke hides the JSON error body behind a generic message
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}

/** Inputs the caller may see (RLS: own team; admins every team). */
export function useSignalInputs() {
  return useQuery({
    queryKey: ['signal-inputs'],
    queryFn: async () => {
      const { data, error } = await sb.from('signal_inputs').select('*').order('created_at');
      if (error) throw new Error(error.message);
      return (data ?? []) as SignalInput[];
    },
  });
}

export function useSaveSignalInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      id?: string; team_id: string; source_key: InputFamily; name: string; filters: InputFilters; is_active?: boolean; all_clients?: boolean;
    }) => {
      const row = { name: p.name, filters: p.filters, is_active: p.is_active ?? true, ...(p.all_clients !== undefined ? { all_clients: p.all_clients } : {}) };
      const q = p.id
        ? sb.from('signal_inputs').update(row).eq('id', p.id).select('*').single()
        : sb.from('signal_inputs').insert({ ...row, team_id: p.team_id, source_key: p.source_key }).select('*').single();
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data as SignalInput;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signal-inputs'] }),
  });
}

export function useToggleSignalInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; patch: Partial<Pick<SignalInput, 'is_active' | 'all_clients'>> }) => {
      const { error } = await sb.from('signal_inputs').update(p.patch).eq('id', p.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signal-inputs'] }),
  });
}

export function useDeleteSignalInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from('signal_inputs').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signal-inputs'] }),
  });
}

/** Count + up to 5 examples for the given filters; nothing is written. */
export function usePreviewSignalInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { family: InputFamily; filters: InputFilters; input_id?: string }) =>
      invokeRunner<InputPreview>({ mode: 'preview', ...p }),
    onSuccess: (_d, p) => { if (p.input_id) qc.invalidateQueries({ queryKey: ['signal-inputs'] }); },
  });
}

export function useRunSignalInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inputId: string) => invokeRunner<{ results: Array<{ writer: string; status: string; inserted: number; updated: number; error: string | null }> }>(
      { mode: 'run', input_id: inputId },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['signal-inputs'] });
      qc.invalidateQueries({ queryKey: ['signal-input-results'] });
      qc.invalidateQueries({ queryKey: ['signals'] });
    },
  });
}

export function useSignalInputResults(inputId: string | null) {
  return useQuery({
    queryKey: ['signal-input-results', inputId],
    enabled: !!inputId,
    queryFn: async () => {
      const { data, error } = await sb.rpc('signal_input_results', { p_input_id: inputId, p_limit: 25 });
      if (error) throw new Error(error.message);
      return data as { total: number; d7: number; rows: SignalRow[] };
    },
  });
}

export interface SiteStatus {
  site_key: string; team_id: string; domain: string; is_active: boolean; created_at: string; last_hit_at: string | null; hits_7d: number;
}

/** Website visitor sites with their last pixel hit (so a client can confirm the install). */
export function useSiteStatus() {
  return useQuery({
    queryKey: ['signals', 'site-status'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc('signals_site_status');
      if (error) throw new Error(error.message);
      return (data ?? []) as SiteStatus[];
    },
  });
}
