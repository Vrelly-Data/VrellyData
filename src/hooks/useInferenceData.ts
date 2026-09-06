import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type InferenceEvent = {
  id: string;
  team_id: string | null;
  organization_id: string | null;
  agent_config_id: string | null;
  person_key: string;
  email: string | null;
  linkedin_url: string | null;
  full_name: string | null;
  job_title: string | null;
  seniority: string | null;
  department: string | null;
  company_name: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  company_size: string | null;
  channel: 'email' | 'linkedin' | 'other';
  campaign_external_id: string | null;
  campaign_name: string | null;
  sequence_step_type: string | null;
  copy_fingerprint: string | null;
  subject: string | null;
  event_type:
    | 'sent'
    | 'opened'
    | 'replied'
    | 'bounced'
    | 'opted_out'
    | 'meeting_booked'
    | 'closed_won'
    | 'closed_lost'
    | 'classified';
  intent:
    | 'interested'
    | 'not_interested'
    | 'referral'
    | 'out_of_office'
    | 'bounce'
    | 'needs_more_info'
    | 'unknown'
    | null;
  is_objection: boolean | null;
  pipeline_stage: string | null;
  disposition_tag: string | null;
  occurred_at: string; // ISO timestamp
  source: string;
  source_row_id: string | null;
  metadata: Record<string, unknown> | null; // reply_text, outbound_message, provider*, etc.
  created_at?: string;
};

export type InferenceFilters = {
  teamIds?: string[];
  organizationIds?: string[];
  channels?: Array<'email' | 'linkedin' | 'other'>;
  eventTypes?: InferenceEvent['event_type'][];
  intents?: Exclude<InferenceEvent['intent'], null>[];
  dateFrom?: string; // ISO date string
  dateTo?: string; // ISO date string
};

function applyEventFilters(
  base:
    | ReturnType<typeof supabase.from<'inference_events'>>['select']
    | any,
  filters: InferenceFilters
) {
  let q = base;
  if (filters.teamIds && filters.teamIds.length > 0) {
    q = q.in('team_id', filters.teamIds);
  }
  if (filters.organizationIds && filters.organizationIds.length > 0) {
    q = q.in('organization_id', filters.organizationIds);
  }
  if (filters.channels && filters.channels.length > 0) {
    q = q.in('channel', filters.channels);
  }
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    q = q.in('event_type', filters.eventTypes);
  }
  if (filters.intents && filters.intents.length > 0) {
    q = q.in('intent', filters.intents);
  }
  if (filters.dateFrom) {
    q = q.gte('occurred_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    q = q.lte('occurred_at', filters.dateTo);
  }
  return q;
}

export function useInferenceEvents(filters: InferenceFilters) {
  return useQuery({
    queryKey: ['inference_events', filters],
    queryFn: async (): Promise<InferenceEvent[]> => {
      // fetch minimal columns needed for aggregations and timeline
      let query = supabase
        .from('inference_events' as any)
        .select(
          [
            'id',
            'team_id',
            'organization_id',
            'agent_config_id',
            'person_key',
            'email',
            'linkedin_url',
            'full_name',
            'job_title',
            'seniority',
            'department',
            'company_name',
            'industry',
            'city',
            'state',
            'country',
            'company_size',
            'channel',
            'campaign_external_id',
            'campaign_name',
            'sequence_step_type',
            'copy_fingerprint',
            'subject',
            'event_type',
            'intent',
            'is_objection',
            'pipeline_stage',
            'disposition_tag',
            'occurred_at',
            'source',
            'source_row_id',
            'metadata',
            'created_at',
          ].join(',')
        )
        .order('occurred_at', { ascending: false })
        .limit(10000); // safety cap, dataset ~9k rows per user brief

      query = applyEventFilters(query, filters);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as InferenceEvent[];
    },
  });
}

// Reply pairing view — replies joined to nearest preceding sent with sent_copy_fingerprint
export type ReplyLatencyRow = {
  team_id: string | null;
  person_key: string;
  channel: InferenceEvent['channel'];
  reply_provider: string | null;
  reply_thread_id: string | null;
  reply_occurred_at: string;
  sent_event_id: string | null;
  sent_provider: string | null;
  sent_thread_id: string | null;
  sent_copy_fingerprint: string | null;
  sent_subject: string | null;
  sent_occurred_at: string | null;
  reply_latency_seconds: number | null;
};

export function useReplyLatency(filters: InferenceFilters) {
  return useQuery({
    queryKey: ['inference_reply_latency', filters],
    queryFn: async (): Promise<ReplyLatencyRow[]> => {
      let query = supabase
        .from('inference_reply_latency' as any)
        .select(
          [
            'team_id',
            'person_key',
            'channel',
            'reply_provider',
            'reply_thread_id',
            'reply_occurred_at',
            'sent_event_id',
            'sent_provider',
            'sent_thread_id',
            'sent_copy_fingerprint',
            'sent_subject',
            'sent_occurred_at',
            'reply_latency_seconds',
          ].join(',')
        )
        .order('reply_occurred_at', { ascending: false })
        .limit(20000);

      // Filters supported: team/org/channel/date
      if (filters.teamIds && filters.teamIds.length > 0) {
        query = query.in('team_id', filters.teamIds);
      }
      if (filters.organizationIds && filters.organizationIds.length > 0) {
        // view does not expose organization_id — fallback to team filter only
      }
      if (filters.channels && filters.channels.length > 0) {
        query = query.in('channel', filters.channels);
      }
      if (filters.dateFrom) {
        query = query.gte('reply_occurred_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('reply_occurred_at', filters.dateTo);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as ReplyLatencyRow[];
    },
  });
}

export type Team = { id: string; name: string };
export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await supabase.from('teams').select('id,name').order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Team[];
    },
  });
}

export type OrganizationLite = { id: string; name: string };
export function useOrganizationsLite() {
  return useQuery({
    queryKey: ['organizations-lite'],
    queryFn: async (): Promise<OrganizationLite[]> => {
      // Non-superadmins may receive [] due to RLS — acceptable for filter list
      const { data, error } = await supabase.from('organizations' as any).select('id,name').order('name', { ascending: true });
      if (error) {
        // Swallow organizations errors for non-superadmins; fall back to empty list
        return [];
      }
      return (data ?? []) as OrganizationLite[];
    },
  });
}

// Client-side aggregations
export type RateRow = {
  key: string;
  channel: InferenceEvent['channel'] | 'all';
  sent: number;
  replied: number;
  classified: number;
  interested: number;
  replyRate: number; // replied / sent
  interestedRate: number; // interested / classified
};

export function computeRatesByDimension(
  events: InferenceEvent[],
  dim: 'industry' | 'job_title' | 'city',
  channels: InferenceEvent['channel'][] | undefined
): RateRow[] {
  const includeAllChannels = !channels || channels.length === 0;
  const map = new Map<string, RateRow>();
  for (const e of events) {
    if (!includeAllChannels && !channels!.includes(e.channel)) continue;
    const key = String((e as any)[dim] || '(unknown)');
    const composite = `${key}||${e.channel}`;
    const baseKey = includeAllChannels ? key : composite;
    const existing = map.get(baseKey) || {
      key,
      channel: includeAllChannels ? 'all' : e.channel,
      sent: 0,
      replied: 0,
      classified: 0,
      interested: 0,
      replyRate: 0,
      interestedRate: 0,
    };
    if (e.event_type === 'sent') existing.sent += 1;
    if (e.event_type === 'replied') existing.replied += 1;
    if (e.event_type === 'classified') {
      existing.classified += 1;
      if (e.intent === 'interested') existing.interested += 1;
    }
    map.set(baseKey, existing);
  }
  const rows: RateRow[] = [];
  map.forEach((r) => {
    r.replyRate = r.sent > 0 ? r.replied / r.sent : 0;
    r.interestedRate = r.classified > 0 ? r.interested / r.classified : 0;
    rows.push(r);
  });
  // Sort by interestedRate desc, then replyRate desc, then volume
  rows.sort((a, b) => {
    if (b.interestedRate !== a.interestedRate) return b.interestedRate - a.interestedRate;
    if (b.replyRate !== a.replyRate) return b.replyRate - a.replyRate;
    return b.classified - a.classified;
  });
  return rows;
}

export type CopyPerformanceRow = {
  copy_fingerprint: string;
  subject: string | null;
  outbound_snippet: string | null;
  sent: number;
  replied: number;
  classified: number;
  interested: number;
  replyRate: number;
  interestedRate: number;
};

export function computeCopyPerformance(
  events: InferenceEvent[],
  replyPairs: ReplyLatencyRow[]
): CopyPerformanceRow[] {
  const sentByFp = new Map<string, number>();
  const subjByFp = new Map<string, string | null>();
  const snippetByFp = new Map<string, string | null>();
  const classifiedByFp = new Map<string, number>();
  const interestedByFp = new Map<string, number>();
  const repliedByFp = new Map<string, number>();

  for (const e of events) {
    if (e.copy_fingerprint) {
      if (e.event_type === 'sent') {
        sentByFp.set(e.copy_fingerprint, (sentByFp.get(e.copy_fingerprint) || 0) + 1);
        if (!snippetByFp.has(e.copy_fingerprint)) {
          const snippet = typeof e.metadata?.['outbound_message'] === 'string'
            ? String(e.metadata?.['outbound_message']).slice(0, 160)
            : null;
          snippetByFp.set(e.copy_fingerprint, snippet);
        }
      }
      if (e.subject && !subjByFp.has(e.copy_fingerprint)) {
        subjByFp.set(e.copy_fingerprint, e.subject);
      }
      if (e.event_type === 'classified') {
        classifiedByFp.set(e.copy_fingerprint, (classifiedByFp.get(e.copy_fingerprint) || 0) + 1);
        if (e.intent === 'interested') {
          interestedByFp.set(e.copy_fingerprint, (interestedByFp.get(e.copy_fingerprint) || 0) + 1);
        }
      }
    }
  }
  for (const r of replyPairs) {
    const fp = r.sent_copy_fingerprint;
    if (fp) {
      repliedByFp.set(fp, (repliedByFp.get(fp) || 0) + 1);
      if (!subjByFp.has(fp) && r.sent_subject) subjByFp.set(fp, r.sent_subject);
    }
  }

  const fps = new Set<string>([
    ...sentByFp.keys(),
    ...classifiedByFp.keys(),
    ...interestedByFp.keys(),
    ...repliedByFp.keys(),
  ]);
  const rows: CopyPerformanceRow[] = [];
  for (const fp of fps) {
    const sent = sentByFp.get(fp) || 0;
    const replied = repliedByFp.get(fp) || 0;
    const classified = classifiedByFp.get(fp) || 0;
    const interested = interestedByFp.get(fp) || 0;
    rows.push({
      copy_fingerprint: fp,
      subject: subjByFp.get(fp) ?? null,
      outbound_snippet: snippetByFp.get(fp) ?? null,
      sent,
      replied,
      classified,
      interested,
      replyRate: sent > 0 ? replied / sent : 0,
      interestedRate: classified > 0 ? interested / classified : 0,
    });
  }
  rows.sort((a, b) => {
    if (b.interestedRate !== a.interestedRate) return b.interestedRate - a.interestedRate;
    if (b.replyRate !== a.replyRate) return b.replyRate - a.replyRate;
    return b.classified - a.classified;
  });
  return rows;
}

