// Capture Scope — data hook. Stage 3 of 5.
//
// Serves every platform with a capture gate — Reply.io, Smartlead and
// HeyReach (capture_enabled) — via fetch-capture-scope. It is a FORK of useAvailableCampaigns, not an extension
// of it: that hook serves Reply.io's is_linked (reporting scope) dialog, and
// reshaping the object it returns would change what that dialog consumes.
// Nothing here imports it.
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
  // email | linkedin | multichannel when the platform knows it.
  channel?: string | null;
  // Replies dropped because this campaign was not capturing: last 14 days,
  // not yet recaptured. null when there are none.
  skippedReplies: { count: number; lastAt: string } | null;
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
  counts: { total: number; captureEnabled: number; captureDisabled: number; skippedReplies: number };
  autoCaptureNewCampaigns: boolean;
  skippedRepliesWindowDays: number;
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

  // Asks the platform's poller to re-read the last 14 days for campaigns that
  // were just switched on, so replies skipped while they were off land in the
  // inbox (with a draft). fetch-capture-scope accepts 50 per call.
  const recapture = useCallback(async (externalIds: string[]) => {
    if (!integrationId || externalIds.length === 0) return 0;
    let started = 0;
    for (let i = 0; i < externalIds.length; i += 50) {
      const { data, error } = await supabase.functions.invoke('fetch-capture-scope', {
        body: { integrationId, mode: 'recapture', externalIds: externalIds.slice(i, i + 50) },
      });
      if (error) throw new Error(error.message || 'Recapture failed');
      if (data?.error) throw new Error(data.error);
      started += data?.recapture?.campaignIds?.length ?? 0;
    }
    return started;
  }, [integrationId]);

  // Writes capture_enabled and nothing else. Deliberately does NOT touch
  // is_linked: that column is Data Analysis reporting scope and unrelated, and
  // conflating the two is what made "Manage Campaigns" look like a capture
  // switch when it never was.
  const save = useMutation({
    mutationFn: async (changes: { externalId: string; captureEnabled: boolean }[]) => {
      if (!integrationId || changes.length === 0) return { updated: 0, recaptured: 0 };

      const on = changes.filter((c) => c.captureEnabled).map((c) => c.externalId);
      const off = changes.filter((c) => !c.captureEnabled).map((c) => c.externalId);

      // Scoped by integration_id, the same key the sync upserts conflict on.
      // external_campaign_id alone is not unique across integrations.
      //
      // .select() makes the write verifiable: an update RLS filters out
      // returns no error and zero rows, which would otherwise read as a
      // successful save that changed nothing.
      for (const [ids, value] of [[on, true], [off, false]] as const) {
        if (ids.length === 0) continue;
        const { data, error } = await supabase
          .from('synced_campaigns')
          .update({ capture_enabled: value })
          .eq('integration_id', integrationId)
          .in('external_campaign_id', ids)
          .select('external_campaign_id');
        if (error) throw error;
        if ((data?.length ?? 0) !== ids.length) {
          throw new Error(
            `Only ${data?.length ?? 0} of ${ids.length} campaign(s) were updated — you may not have permission to change this integration.`,
          );
        }
      }
      // Smartlead: when enabling capture, reconcile webhooks so replies flow.
      if ((query.data?.platform ?? '').toLowerCase() === 'smartlead' && on.length > 0) {
        try {
          await supabase.functions.invoke('reconcile-smartlead-webhooks', {
            body: { integrationId, campaignIds: on },
          });
        } catch (e) {
          // Non-fatal to the save; surface as a toast via onError/onSuccess below.
          console.warn('Smartlead webhook reconcile error (non-fatal):', e);
        }
      }
      // Pull in what was skipped while these were off. A failure here does not
      // undo the save; it is reported separately.
      let recaptured = 0;
      if (on.length > 0) {
        try {
          recaptured = await recapture(on);
        } catch (e) {
          toast.error(`Capture is on, but re-reading recent replies failed: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }
      return { updated: changes.length, recaptured };
    },
    onSuccess: ({ updated, recaptured }) => {
      queryClient.invalidateQueries({ queryKey: ['capture-scope', integrationId] });
      if (updated > 0) {
        toast.success(
          `Updated ${updated} campaign${updated === 1 ? '' : 's'}` +
            (recaptured > 0 ? ` — pulling in replies from the last 14 days for ${recaptured}` : ''),
        );
      }
    },
    onError: (e: Error) => toast.error(`Failed to save: ${e.message}`),
  });

  // Integration-level default for campaigns a sync discovers from now on.
  // Never changes existing campaigns.
  const setAutoCapture = useMutation({
    mutationFn: async (value: boolean) => {
      if (!integrationId) return;
      const { data, error } = await supabase
        .from('outbound_integrations')
        // Column added in migration 20261007210000 (not in generated types yet).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ auto_capture_new_campaigns: value } as any)
        .eq('id', integrationId)
        .select('id');
      if (error) throw error;
      if ((data?.length ?? 0) !== 1) throw new Error('You may not have permission to change this integration.');
    },
    onSuccess: (_d, value) => {
      queryClient.invalidateQueries({ queryKey: ['capture-scope', integrationId] });
      toast.success(value ? 'New campaigns will be captured automatically' : 'New campaigns will start with capture off');
    },
    onError: (e: Error) => toast.error(`Failed to update setting: ${e.message}`),
  });

  // One click from a "replies skipped" badge: switch the campaign on (if it
  // is off) and pull in its last 14 days.
  const enableAndRecapture = useMutation({
    mutationFn: async (campaign: CaptureScopeCampaign) => {
      if (!campaign.captureEnabled) {
        await save.mutateAsync([{ externalId: campaign.externalId, captureEnabled: true }]);
        return; // save() already recaptures newly enabled campaigns
      }
      await recapture([campaign.externalId]);
      toast.success(`Pulling in replies from the last 14 days for ${campaign.name}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['capture-scope', integrationId] }),
    onError: (e: Error) => toast.error(e.message),
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
    counts: query.data?.counts ?? { total: 0, captureEnabled: 0, captureDisabled: 0, skippedReplies: 0 },
    autoCaptureNewCampaigns: query.data?.autoCaptureNewCampaigns ?? true,
    skippedRepliesWindowDays: query.data?.skippedRepliesWindowDays ?? 14,
    setAutoCapture: setAutoCapture.mutate,
    isSettingAutoCapture: setAutoCapture.isPending,
    enableAndRecapture: enableAndRecapture.mutate,
    enablingExternalId: enableAndRecapture.isPending ? enableAndRecapture.variables?.externalId ?? null : null,
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
