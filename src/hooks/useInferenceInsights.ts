import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  BACKFILL_SOURCE,
  Dimension,
  RpcBias,
  RpcCopy,
  RpcHeatmap,
  RpcStats,
  SegmentFilter,
  SourceFilter,
} from '@/lib/inferenceAnalytics';
import { LiveEvent, buildLiveCards, isFullyEnriched, num, startOfToday, startOfWeek } from '@/lib/liveFeed';

// inference_events / inference_deductions are not in the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (table: string): AnyQuery => (supabase.from as any)(table);

const PAGE = 1000;
const CONCURRENCY = 6;

// Page through a filtered table in parallel. `apply` adds the same filters to the count query
// and to every page query.
async function fetchAll<T>(table: string, select: string, apply: (q: AnyQuery) => AnyQuery): Promise<T[]> {
  const { count, error } = await apply(from(table).select('id', { count: 'exact', head: true }));
  if (error) throw new Error(error.message);
  const pages = Math.ceil((count ?? 0) / PAGE);
  const out: T[][] = new Array(pages);
  for (let start = 0; start < pages; start += CONCURRENCY) {
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pages - start) }, async (_, i) => {
        const p = start + i;
        const { data, error: pageError } = await apply(from(table).select(select))
          .order('id', { ascending: true })
          .range(p * PAGE, p * PAGE + PAGE - 1);
        if (pageError) throw new Error(pageError.message);
        out[p] = (data ?? []) as T[];
      }),
    );
  }
  return out.flat();
}

// Live = not the Reply.io history import and not a mirrored row flagged metadata.backfill.
const onlyLive = (q: AnyQuery) =>
  q.neq('source', BACKFILL_SOURCE).or('metadata->>backfill.is.null,metadata->>backfill.neq.true');

// -------- Inference aggregates (server-side) --------
// Everything the Inference tab shows is aggregated in Postgres by
// admin_inference_insights (admin-only). Two calls, so the expensive one is
// cached: 'summary' re-runs when the explorer dimensions or the focused segment
// change; 'suggestions' only when the source / date range changes.

export type InsightsFilters = { source: SourceFilter; from?: Date; to?: Date };

export type InsightsSummary = {
  baseline: RpcStats;
  bias: RpcBias;
  segment_stats: RpcStats;
  segments: Array<RpcStats & { values: SegmentFilter }>;
  covered: number;
  copy: RpcCopy;
  heatmap: RpcHeatmap;
  computed_at: string;
};

export type InsightsSuggestions = {
  baseline: RpcStats;
  bias: RpcBias;
  suggestions: {
    // Ranked by lift (ties as the client used to break them), up to 300 each.
    all: Array<RpcStats & { values: SegmentFilter }>;
    // Same candidates without any enrichment-biased dimension, ranked and capped
    // separately so biased high-lift segments cannot crowd them out.
    unbiased: Array<RpcStats & { values: SegmentFilter }>;
    biased_dims: Dimension[];
  };
  computed_at: string;
};

async function callInsights(
  f: InsightsFilters,
  extra: { dims: Dimension[]; includeUnknown: boolean; segment: SegmentFilter | null; sections: Array<'summary' | 'suggestions'> },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('admin_inference_insights', {
    p_source: f.source,
    p_from: f.from ? f.from.toISOString() : null,
    p_to: f.to ? f.to.toISOString() : null,
    p_dims: extra.dims,
    p_include_unknown: extra.includeUnknown,
    p_segment: extra.segment ?? {},
    p_sections: extra.sections,
  });
  if (error) throw new Error(error.message);
  return data;
}

const filterKey = (f: InsightsFilters) => [f.source, f.from?.toISOString() ?? null, f.to?.toISOString() ?? null];

export function useInsightsSummary(
  filters: InsightsFilters,
  view: { dims: Dimension[]; includeUnknown: boolean; segment: SegmentFilter | null },
) {
  return useQuery({
    queryKey: ['inference_insights', 'summary', ...filterKey(filters), view.dims, view.includeUnknown, view.segment ?? {}],
    staleTime: 5 * 60_000,
    // Keep showing the previous numbers while a new grouping loads.
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<InsightsSummary> =>
      callInsights(filters, { ...view, sections: ['summary'] }),
  });
}

export function useInsightsSuggestions(filters: InsightsFilters) {
  return useQuery({
    queryKey: ['inference_insights', 'suggestions', ...filterKey(filters)],
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<InsightsSuggestions> =>
      callInsights(filters, { dims: ['industry'], includeUnknown: false, segment: null, sections: ['suggestions'] }),
  });
}

// -------- Live Feed: Realtime, falling back to 15s polling --------
export type FeedMode = 'connecting' | 'realtime' | 'polling';

const LIVE_SELECT =
  'id,team_id,person_key,event_type,channel,occurred_at,source,intent,full_name,job_title,company_name,industry,company_size,city,state,seniority,campaign_name,copy_fingerprint,subject,metadata';
const FEED_LIMIT = 80;

export function useLiveFeed() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<FeedMode>('connecting');

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel('admin-inference-live-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inference_events' }, () => {
        // Bulk writes (e.g. a backfill) arrive as bursts — refetch once per burst
        clearTimeout(debounce);
        debounce = setTimeout(() => queryClient.invalidateQueries({ queryKey: ['inference_live'] }), 1500);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setMode('realtime');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setMode('polling');
      });
    return () => {
      clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const refetchInterval = mode === 'realtime' ? false : 15_000;

  const feed = useQuery({
    queryKey: ['inference_live', 'feed'],
    refetchInterval,
    queryFn: async () => {
      const { data, error } = await onlyLive(from('inference_events').select(LIVE_SELECT))
        .in('event_type', ['replied', 'classified'])
        .order('occurred_at', { ascending: false })
        .limit(FEED_LIMIT);
      if (error) throw new Error(error.message);
      return buildLiveCards((data ?? []) as LiveEvent[]);
    },
  });

  const counters = useQuery({
    queryKey: ['inference_live', 'counters'],
    refetchInterval,
    queryFn: async () => {
      const weekStart = startOfWeek();
      const today = startOfToday();
      const events = await fetchAll<LiveEvent>('inference_events', LIVE_SELECT, (q) =>
        onlyLive(q).in('event_type', ['replied', 'classified']).gte('occurred_at', weekStart.toISOString()),
      );
      const replies = buildLiveCards(events).filter((c) => c.kind === 'reply');
      const enriched = replies.filter(isFullyEnriched).length;
      return {
        today: replies.filter((c) => new Date(c.occurredAt) >= today).length,
        week: replies.length,
        fullyEnriched: enriched,
        fullyEnrichedPct: replies.length ? (enriched / replies.length) * 100 : null,
      };
    },
  });

  return { mode, feed, counters };
}

// -------- Capture health (live capture only) --------
type HealthRow = {
  id: string;
  person_key: string;
  channel: string;
  event_type: string;
  intent: string | null;
  job_title: string | null;
  industry: string | null;
  company_size: string | null;
  city: string | null;
  campaign_external_id: string | null;
  campaign_name: string | null;
  step_number: unknown;
  sequence_number: unknown;
};

export const HEALTH_FIELDS = ['job_title', 'industry', 'company_size', 'city', 'campaign', 'step'] as const;
export type HealthField = (typeof HEALTH_FIELDS)[number];
const PEOPLE_FIELDS: HealthField[] = ['job_title', 'industry', 'city'];

export type ChannelHealth = {
  channel: 'email' | 'linkedin';
  contacts: number; // distinct people with any live event
  repliedPeople: number;
  interestedPeople: number;
  total: number; // replied + interested-classified events (coverage denominator)
  fields: Record<HealthField, { captured: number; withPeople: number | null }>;
};

const present = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

export function useCaptureHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['inference_live', 'health'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ChannelHealth[]> => {
      const [rows, enrichedRows] = await Promise.all([
        fetchAll<HealthRow>(
          'inference_events',
          'id,person_key,channel,event_type,intent,job_title,industry,company_size,city,campaign_external_id,campaign_name,step_number:metadata->sequence_step_number,sequence_number:metadata->sequence_number',
          (q) => onlyLive(q).in('channel', ['email', 'linkedin']),
        ),
        // The enriched view back-fills job_title / industry / city from public.people
        fetchAll<{ id: string; job_title: string | null; industry: string | null; city: string | null }>(
          'inference_events_enriched',
          'id,job_title,industry,city',
          (q) => onlyLive(q).in('channel', ['email', 'linkedin']),
        ),
      ]);
      const enrichedById = new Map(enrichedRows.map((r) => [r.id, r]));
      return (['email', 'linkedin'] as const).map((channel) => {
        const inChannel = rows.filter((r) => r.channel === channel);
        const signal = inChannel.filter(
          (r) => r.event_type === 'replied' || (r.event_type === 'classified' && r.intent === 'interested'),
        );
        const fields = {} as ChannelHealth['fields'];
        for (const f of HEALTH_FIELDS) {
          const captured = signal.filter((r) =>
            f === 'campaign'
              ? present(r.campaign_external_id) || present(r.campaign_name)
              : f === 'step'
                ? num(r.step_number) !== null || num(r.sequence_number) !== null
                : present(r[f]),
          ).length;
          const withPeople = PEOPLE_FIELDS.includes(f)
            ? signal.filter((r) => present(enrichedById.get(r.id)?.[f as 'job_title' | 'industry' | 'city'])).length
            : null;
          fields[f] = { captured, withPeople };
        }
        const distinct = (pred: (r: HealthRow) => boolean) => new Set(inChannel.filter(pred).map((r) => r.person_key)).size;
        return {
          channel,
          contacts: distinct(() => true),
          repliedPeople: distinct((r) => r.event_type === 'replied'),
          interestedPeople: distinct((r) => r.event_type === 'classified' && r.intent === 'interested'),
          total: signal.length,
          fields,
        };
      });
    },
  });
}

// -------- Deductions --------
export type DeductionStatus = 'suggested' | 'accepted' | 'rejected';
export type Deduction = {
  id: string;
  title: string;
  body: string | null;
  segment_filter: { segment?: SegmentFilter; source?: string; dateFrom?: string | null; dateTo?: string | null } | null;
  evidence: Record<string, unknown> | null;
  status: DeductionStatus;
  suggestion_key: string | null;
  created_at: string;
};
export type DeductionInput = Omit<Deduction, 'id' | 'created_at'>;

export function useDeductions() {
  return useQuery({
    queryKey: ['inference_deductions'],
    queryFn: async (): Promise<Deduction[]> => {
      const { data, error } = await from('inference_deductions')
        .select('id,title,body,segment_filter,evidence,status,suggestion_key,created_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Deduction[];
    },
  });
}

export function useSaveDeduction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeductionInput & { id?: string }) => {
      const { id, ...row } = input;
      const query = id
        ? from('inference_deductions').update(row).eq('id', id)
        : row.suggestion_key
          ? // a suggestion decided again (e.g. rejected, later accepted) updates its existing row
            from('inference_deductions').upsert(row, { onConflict: 'suggestion_key' })
          : from('inference_deductions').insert(row);
      const { error } = await query;
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inference_deductions'] }),
  });
}

// -------- Capture Scope alert (admin Live Feed) --------
// Replies dropped by Capture Scope (campaign not capturing) and recorded in
// capture_scope_skips within the window, per team + integration. Comes from an
// admin-gated RPC because team / integration names are not readable across
// teams under RLS.
export type CaptureSkipAlert = {
  team_id: string;
  team_name: string | null;
  integration_id: string;
  integration_name: string | null;
  platform: string;
  skipped: number;
  campaigns: number;
  last_reply_at: string | null;
  last_detected_at: string | null;
};

export function useCaptureSkipAlerts(hours = 24) {
  return useQuery({
    // Under 'inference_live' so the Live Feed's Realtime/polling refresh covers it.
    queryKey: ['inference_live', 'capture_skip_alerts', hours],
    staleTime: 60_000,
    queryFn: async (): Promise<CaptureSkipAlert[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('admin_capture_scope_skip_alerts', { p_hours: hours });
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []) as CaptureSkipAlert[];
    },
  });
}
