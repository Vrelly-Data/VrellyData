// Capture Scope — data hook. Stage 3 of 5.
//
// Serves Smartlead + HeyReach (and any future platform whose adapter is
// registered in fetch-capture-scope). It is a FORK of useAvailableCampaigns,
// not an extension of it: that hook and its dialog serve Reply.io, most
// clients are on Reply.io, and reshaping the object it returns would change
// what the Reply.io dialog consumes. Nothing here imports it, and Reply.io
// integrations are rejected by fetch-capture-scope itself.
//
// The Reply.io team-filter machinery (skipTeamFilter, discoveredTeamIds,
// multi-team views) is deliberately absent — no other platform has the
// concept, and it was ~40% of the original hook.

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CaptureScopeSender {
  label: string;
  identifier: string;
}

export interface CaptureScopeCampaign {
  externalId: string;
  name: string;
  status: string;
  rawStatus: string | null;
  captureEnabled: boolean;
  senders: CaptureScopeSender[];
  // null means UNKNOWN, not zero — only a subset of Smartlead campaigns carry
  // analytics, and rendering "0 sent" for a campaign that sent thousands is
  // worse than rendering nothing.
  volume: { sent: number | null; replies: number | null };
  group: { id: string; label: string } | null;
}

export interface CaptureScopeGroup {
  id: string;
  label: string;
  campaignCount: number;
}

interface CaptureScopeResponse {
  platform: string;
  integrationId: string;
  campaigns: CaptureScopeCampaign[];
  groups: CaptureScopeGroup[];
  ungroupedCount: number;
  counts: { total: number; captureEnabled: number; captureDisabled: number };
  sendersAvailable: boolean;
  sendersDeferred: boolean;
  maxSenderLookup: number;
}

export function useCaptureScope(integrationId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  // externalId -> senders, filled in progressively by loadSenders().
  const [senders, setSenders] = useState<Record<string, CaptureScopeSender[]>>({});
  const [sendersLoading, setSendersLoading] = useState(false);
  const [sendersProgress, setSendersProgress] = useState<{ done: number; total: number } | null>(null);

  const query = useQuery({
    queryKey: ['capture-scope', integrationId],
    enabled: !!integrationId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<CaptureScopeResponse> => {
      const { data, error } = await supabase.functions.invoke('fetch-capture-scope', {
        body: { integrationId },
      });
      if (error) throw new Error(error.message || 'Failed to load campaigns');
      if (data?.error) throw new Error(data.error);
      return data as CaptureScopeResponse;
    },
  });

  const maxLookup = query.data?.maxSenderLookup ?? 60;

  // Senders are fetched separately and in pages because the vendor exposes
  // them only per campaign against a 200 req/min account limit — requesting
  // all of SourceCo's 379 in one pass 429s rather than merely being slow.
  // Each page is committed to state as it arrives so the UI fills in
  // progressively instead of blocking on the whole set.
  const loadSenders = useCallback(async (externalIds: string[]) => {
    if (!integrationId) return;
    const pending = externalIds.filter((id) => !(id in senders));
    if (pending.length === 0) return;

    setSendersLoading(true);
    setSendersProgress({ done: 0, total: pending.length });
    try {
      for (let i = 0; i < pending.length; i += maxLookup) {
        const page = pending.slice(i, i + maxLookup);
        const { data, error } = await supabase.functions.invoke('fetch-capture-scope', {
          body: { integrationId, mode: 'senders', externalIds: page },
        });
        if (error) throw new Error(error.message || 'Failed to load senders');
        if (data?.error) throw new Error(data.error);
        setSenders((prev) => ({ ...prev, ...(data.senders ?? {}) }));
        setSendersProgress({ done: Math.min(i + page.length, pending.length), total: pending.length });
      }
    } catch (e) {
      toast.error(`Could not load senders: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setSendersLoading(false);
      setSendersProgress(null);
    }
  }, [integrationId, senders, maxLookup]);

  // Writes capture_enabled and nothing else. Deliberately does NOT touch
  // is_linked: that column is Data Analysis reporting scope and unrelated, and
  // conflating the two is what made "Manage Campaigns" look like a capture
  // switch when it never was.
  const save = useMutation({
    mutationFn: async (changes: { externalId: string; captureEnabled: boolean }[]) => {
      if (!integrationId || changes.length === 0) return { updated: 0 };

      const on = changes.filter((c) => c.captureEnabled).map((c) => c.externalId);
      const off = changes.filter((c) => !c.captureEnabled).map((c) => c.externalId);

      // Scoped by integration_id, the same key the sync upserts conflict on.
      // external_campaign_id alone is not unique across integrations.
      for (const [ids, value] of [[on, true], [off, false]] as const) {
        if (ids.length === 0) continue;
        const { error } = await supabase
          .from('synced_campaigns')
          .update({ capture_enabled: value })
          .eq('integration_id', integrationId)
          .in('external_campaign_id', ids);
        if (error) throw error;
      }
      return { updated: changes.length };
    },
    onSuccess: ({ updated }) => {
      queryClient.invalidateQueries({ queryKey: ['capture-scope', integrationId] });
      if (updated > 0) toast.success(`Updated ${updated} campaign${updated === 1 ? '' : 's'}`);
    },
    onError: (e: Error) => toast.error(`Failed to save: ${e.message}`),
  });

  // Merge fetched senders onto the campaign list so consumers read one shape.
  const campaigns = useMemo(() => {
    const list = query.data?.campaigns ?? [];
    if (Object.keys(senders).length === 0) return list;
    return list.map((c) => (senders[c.externalId] ? { ...c, senders: senders[c.externalId] } : c));
  }, [query.data, senders]);

  return {
    campaigns,
    groups: query.data?.groups ?? [],
    ungroupedCount: query.data?.ungroupedCount ?? 0,
    counts: query.data?.counts ?? { total: 0, captureEnabled: 0, captureDisabled: 0 },
    sendersAvailable: query.data?.sendersAvailable ?? false,
    // false => senders already arrived with the list; no second call needed.
    sendersDeferred: query.data?.sendersDeferred ?? false,
    maxSenderLookup: maxLookup,
    sendersLoadedFor: senders,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    loadSenders,
    sendersLoading,
    sendersProgress,
    save: save.mutateAsync,
    isSaving: save.isPending,
  };
}
