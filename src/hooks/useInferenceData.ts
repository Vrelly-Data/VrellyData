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
    queryFn: async (): Promise<{ rows: InferenceEvent[]; total: number; isCapped: boolean; limit: number }> => {
      const LIMIT = 10000;
      // 1) Total count (head request) with identical filters
      let countQuery = supabase
        .from('inference_events_enriched' as any)
        .select('id', { count: 'exact', head: true });
      countQuery = applyEventFilters(countQuery, filters);
      const { count: total = 0, error: countError } = await countQuery as any;
      if (countError) {
        // Non-fatal — proceed without a total
      }

      // 2) Fetch minimal columns needed for aggregations and timeline
      let query = supabase
        .from('inference_events_enriched' as any)
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
        .limit(LIMIT);

      query = applyEventFilters(query, filters);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as InferenceEvent[];
      return { rows, total, isCapped: total > LIMIT, limit: LIMIT };
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

// -------- Base KPIs (All-Time) --------
export type BaseInferenceKpis = {
  totalContactsDeduped: number;
  contactsRowsReply: number;
  contactsRowsSmartlead: number;
  emailSends: number;
  emailSendsSmartlead: number;
  emailSendsReply: number;
  emailRepliesCampaignTotal: number;
  emailRepliesSmartleadCampaign: number;
  emailRepliesReplyCampaign: number;
  linkedinMessagesSent: number;
  linkedinMessagesSentCampaign: number;
  linkedinConnectionsSent: number;
  linkedinConnectionsAccepted: number;
  contactsPeople: number; // distinct person_key of ANY event (events-based contacts)
  repliedPeople: number; // distinct people who replied (all channels)
  repliedPeopleEmail: number; // distinct people who replied on email channel
  repliedPeopleLinkedin: number; // distinct people who replied on linkedin channel
  interestedPeople: number; // distinct people classified as interested (all channels)
  sources: {
    totalContactsDeduped: string;
    contactsRowsReply: string;
    contactsRowsSmartlead: string;
    emailSends: string;
    emailSendsSmartlead: string;
    emailSendsReply: string;
    emailRepliesCampaignTotal: string;
    emailRepliesSmartleadCampaign: string;
    emailRepliesReplyCampaign: string;
    linkedinMessagesSent: string;
    linkedinMessagesSentCampaign: string;
    linkedinConnectionsSent: string;
    linkedinConnectionsAccepted: string;
    contactsPeople: string;
    repliedPeople: string;
    repliedPeopleEmail: string;
    repliedPeopleLinkedin: string;
    interestedPeople: string;
  };
};

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const v = email.trim().toLowerCase();
  return v || null;
}

function normalizeLinkedin(url: string | null | undefined): string | null {
  if (!url) return null;
  const v = url.trim().toLowerCase();
  if (!v) return null;
  const noParams = v.split('?')[0].replace(/\/+$/, '');
  return noParams.replace(/^https?:\/\//, '');
}

async function countDedupedContacts(teamIds?: string[]): Promise<number> {
  const PAGE = 1000;
  let offset = 0;
  let keepGoing = true;
  const seenKeys = new Set<string>();
  while (keepGoing) {
    let query = supabase
      .from('synced_contacts' as any)
      .select('id,email,linkedin_url,team_id')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (teamIds && teamIds.length > 0) {
      query = (query as any).in('team_id', teamIds);
    }
    const { data, error } = await (query as any);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; email: string | null; linkedin_url: string | null }>;
    for (const r of rows) {
      const e = normalizeEmail(r.email);
      const l = normalizeLinkedin(r.linkedin_url);
      const key = e ? `e:${e}` : l ? `l:${l}` : r.id ? `i:${r.id}` : null;
      if (key) seenKeys.add(key);
    }
    keepGoing = rows.length === PAGE;
    offset += PAGE;
  }
  return seenKeys.size;
}

async function fetchCampaignSourceMap(teamIds?: string[]) {
  let q = supabase.from('synced_campaigns' as any).select('id, source, team_id');
  if (teamIds && teamIds.length > 0) {
    q = (q as any).in('team_id', teamIds);
  }
  const { data, error } = await (q as any);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; source: string | null }>) {
    if (row.id) map.set(row.id, (row.source || '').toLowerCase());
  }
  return map;
}

async function countContactRowsBySource(teamIds?: string[]) {
  const campaignSource = await fetchCampaignSourceMap(teamIds);
  const PAGE = 1000;
  let offset = 0;
  let keepGoing = true;
  let replyRows = 0;
  let smartleadRows = 0;
  while (keepGoing) {
    let q = supabase
      .from('synced_contacts' as any)
      .select('campaign_id,team_id')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (teamIds && teamIds.length > 0) {
      q = (q as any).in('team_id', teamIds);
    }
    const { data, error } = await (q as any);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ campaign_id: string | null }>;
    for (const r of rows) {
      const src = r.campaign_id ? campaignSource.get(r.campaign_id) : undefined;
      if (src === 'reply_io') replyRows += 1;
      else if (src === 'smartlead') smartleadRows += 1;
    }
    keepGoing = rows.length === PAGE;
    offset += PAGE;
  }
  return { replyRows, smartleadRows };
}

async function sumCampaignStats(teamIds?: string[]) {
  let query = supabase
    .from('synced_campaigns' as any)
    .select('team_id, source, channel, stats');
  if (teamIds && teamIds.length > 0) {
    query = (query as any).in('team_id', teamIds);
  }
  const { data, error } = await (query as any);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ source: string | null; channel: string | null; stats: Record<string, unknown> | null }>;
  let emailSends = 0;
  let emailSendsReplyNullChannel = 0; // track for footnote
  let emailRepliesSmartleadCampaign = 0;
  let emailRepliesReplyCampaign = 0;
  let emailSendsSmartlead = 0;
  let emailSendsReply = 0;
  let linkedinMessagesSentReply = 0;
  let linkedinConnectionsSent = 0;
  let linkedinConnectionsAccepted = 0;

  for (const r of rows) {
    const s = (r.stats ?? {}) as Record<string, unknown>;
    const source = (r.source || '').toLowerCase();
    const channel = (r.channel || '').toLowerCase();
    if (channel === 'email') {
      const sent = Number(s['sent'] ?? 0);
      if (!Number.isNaN(sent)) {
        emailSends += sent;
        if (source === 'smartlead') emailSendsSmartlead += sent;
        if (source === 'reply_io') emailSendsReply += sent;
      }
      // Campaign replies (email)
      const replies = Number(s['replies'] ?? 0);
      if (source === 'smartlead' && !Number.isNaN(replies)) emailRepliesSmartleadCampaign += replies;
      if (source === 'reply_io' && !Number.isNaN(replies)) emailRepliesReplyCampaign += replies;
    } else {
      // Reply null/other channel sent — excluded from Email Sends, but footnote the amount
      if (source === 'reply_io') {
        const sentOther = Number(s['sent'] ?? 0);
        if (!Number.isNaN(sentOther)) emailSendsReplyNullChannel += sentOther;
      }
    }
    // Reply.io LinkedIn messages sent (campaign stats)
    if (source === 'reply_io') {
      const liMsgs = Number((s as any)['linkedinMessagesSent'] ?? 0);
      if (!Number.isNaN(liMsgs)) linkedinMessagesSentReply += liMsgs;
    }
    const connSent = Number(
      (s as any)['linkedinConnectionsSent'] ??
      (s as any)['connectionsSent'] ??
      0
    );
    const connAccepted = Number(
      (s as any)['linkedinConnectionsAccepted'] ??
      (s as any)['connectionsAccepted'] ??
      0
    );
    if (!Number.isNaN(connSent)) linkedinConnectionsSent += connSent;
    if (!Number.isNaN(connAccepted)) linkedinConnectionsAccepted += connAccepted;
  }
  return {
    emailSends,
    emailSendsSmartlead,
    emailSendsReply,
    emailSendsReplyNullChannel,
    emailRepliesSmartleadCampaign,
    emailRepliesReplyCampaign,
    linkedinMessagesSentReply,
    linkedinConnectionsSent,
    linkedinConnectionsAccepted,
  };
}

async function countEventsQuick(filters: InferenceFilters, channel: 'linkedin' | 'email', eventType: InferenceEvent['event_type']) {
  let countQuery = supabase
    .from('inference_events_enriched' as any)
    .select('id', { count: 'exact', head: true });
  countQuery = (countQuery as any).eq('channel', channel).eq('event_type', eventType);
  if (filters.teamIds && filters.teamIds.length > 0) {
    countQuery = (countQuery as any).in('team_id', filters.teamIds);
  }
  if (filters.dateFrom) {
    countQuery = (countQuery as any).gte('occurred_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    countQuery = (countQuery as any).lte('occurred_at', filters.dateTo);
  }
  const { count = 0 } = (await (countQuery as any)) as any;
  return count;
}

async function countDistinctPeopleForEvents(filters: InferenceFilters, predicate: (row: InferenceEvent) => boolean) {
  const PAGE = 1000;
  const seen = new Set<string>();
  let offset = 0;
  let keepGoing = true;
  while (keepGoing) {
    let q = supabase
      .from('inference_events_enriched' as any)
      .select('person_key, event_type, intent, team_id, occurred_at, channel')
      .order('occurred_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (filters.teamIds && filters.teamIds.length > 0) {
      q = (q as any).in('team_id', filters.teamIds);
    }
    if (filters.dateFrom) q = (q as any).gte('occurred_at', filters.dateFrom);
    if (filters.dateTo) q = (q as any).lte('occurred_at', filters.dateTo);
    const { data, error } = await (q as any);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as InferenceEvent[];
    for (const r of rows) {
      if (r.person_key && predicate(r)) {
        seen.add(r.person_key);
      }
    }
    keepGoing = rows.length === PAGE;
    offset += PAGE;
  }
  return seen.size;
}

export function useBaseInferenceKpis(filters: InferenceFilters) {
  return useQuery({
    queryKey: ['base_inference_kpis', { teamIds: filters.teamIds, dateFrom: filters.dateFrom, dateTo: filters.dateTo }],
    queryFn: async (): Promise<BaseInferenceKpis> => {
      const [
        contactsCount,
        campaignSums,
        rowsBySource,
        liMsgsSent,
        contactsPeople,
        repliedPeople,
        repliedPeopleEmail,
        repliedPeopleLinkedin,
        interestedPeople,
      ] = await Promise.all([
        countDedupedContacts(filters.teamIds),
        sumCampaignStats(filters.teamIds),
        countContactRowsBySource(filters.teamIds),
        countEventsQuick(filters, 'linkedin', 'sent'),
        countDistinctPeopleForEvents(filters, (_r) => true), // any event
        countDistinctPeopleForEvents(filters, (r) => r.event_type === 'replied'),
        countDistinctPeopleForEvents(filters, (r) => r.event_type === 'replied' && r.channel === 'email'),
        countDistinctPeopleForEvents(filters, (r) => r.event_type === 'replied' && r.channel === 'linkedin'),
        countDistinctPeopleForEvents(filters, (r) => r.event_type === 'classified' && r.intent === 'interested'),
      ]);

      if (repliedPeople > contactsCount) {
        // eslint-disable-next-line no-console
        console.warn('Invariant violated: repliedPeople exceeds totalContacts', { repliedPeople, contactsCount });
      }

      return {
        totalContactsDeduped: contactsCount,
        contactsRowsReply: rowsBySource.replyRows,
        contactsRowsSmartlead: rowsBySource.smartleadRows,
        emailSends: campaignSums.emailSends,
        emailSendsSmartlead: campaignSums.emailSendsSmartlead,
        emailSendsReply: campaignSums.emailSendsReply,
        emailRepliesCampaignTotal:
          (campaignSums.emailRepliesSmartleadCampaign || 0) + (campaignSums.emailRepliesReplyCampaign || 0),
        emailRepliesSmartleadCampaign: campaignSums.emailRepliesSmartleadCampaign || 0,
        emailRepliesReplyCampaign: campaignSums.emailRepliesReplyCampaign || 0,
        linkedinMessagesSent: liMsgsSent,
        linkedinMessagesSentCampaign: campaignSums.linkedinMessagesSentReply,
        linkedinConnectionsSent: campaignSums.linkedinConnectionsSent,
        linkedinConnectionsAccepted: campaignSums.linkedinConnectionsAccepted,
        contactsPeople,
        repliedPeople,
        repliedPeopleEmail,
        repliedPeopleLinkedin,
        interestedPeople,
        sources: {
          totalContactsDeduped:
            'synced_contacts (dedup by email/linkedin_url/fallback id) — Smartlead roster incomplete',
          contactsRowsReply: 'synced_contacts rows via joined synced_campaigns.source=reply_io',
          contactsRowsSmartlead:
            'synced_contacts rows via joined synced_campaigns.source=smartlead — roster sync incomplete',
          emailSends: `synced_campaigns.stats.sent (channel=email, all sources). Reply null-channel excluded: ${campaignSums.emailSendsReplyNullChannel}`,
          emailSendsSmartlead: 'synced_campaigns.stats.sent where source=smartlead AND channel=email',
          emailSendsReply: 'synced_campaigns.stats.sent where source=reply_io AND channel=email',
          emailRepliesCampaignTotal: `synced_campaigns.stats.replies (Smartlead + Reply email). IE email replied people: ${repliedPeopleEmail}`,
          emailRepliesSmartleadCampaign: 'synced_campaigns.stats.replies where source=smartlead',
          emailRepliesReplyCampaign: 'synced_campaigns.stats.replies where source=reply_io AND channel=email',
          linkedinMessagesSent: 'inference_events_enriched (channel=linkedin, event_type=sent, count exact)',
          linkedinMessagesSentCampaign: 'synced_campaigns.stats.linkedinMessagesSent where source=reply_io',
          linkedinConnectionsSent: 'synced_campaigns.stats.linkedinConnectionsSent / connectionsSent',
          linkedinConnectionsAccepted: 'synced_campaigns.stats.linkedinConnectionsAccepted / connectionsAccepted',
          contactsPeople: 'inference_events_enriched distinct person_key across ANY event',
          repliedPeople: 'inference_events_enriched distinct person_key where event_type=replied',
          repliedPeopleEmail: "inference_events_enriched distinct person_key where event_type='replied' and channel='email'",
          repliedPeopleLinkedin: "inference_events_enriched distinct person_key where event_type='replied' and channel='linkedin'",
          interestedPeople: "inference_events_enriched distinct person_key where event_type=classified and intent='interested'",
        },
      };
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
    const rawKey = String((e as any)[dim] || '').trim();
    const isUnknown =
      rawKey === '' ||
      rawKey === '(unknown)' ||
      rawKey.toLowerCase() === 'unknown' ||
      rawKey.toLowerCase() === 'n/a';
    if (isUnknown) {
      // Exclude unknowns from ranked insights — product preference
      continue;
    }
    const key = rawKey;
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

// Exact people-level KPIs and intent mix across full dataset (paged)
export type ExactInferencePeopleKpis = {
  totalContacts: number;
  totalRepliesPeople: number;
  emailRepliesPeople: number;
  liRepliesPeople: number;
  // Array form for react-query JSON serialization
  replyPeople: string[];
  // Counts per intent; keys include: interested, not_interested, referral, out_of_office, needs_more_info, bounce, unknown
  intentComposition: Record<string, number>;
  // Best intent per reply person (most recent non-unknown classified; else 'unknown')
  personIntentMap: Record<string, string>;
};

export function useExactInferencePeopleKpis(filters: InferenceFilters) {
  return useQuery({
    queryKey: ['inference-kpis-exact', filters],
    queryFn: async (): Promise<ExactInferencePeopleKpis> => {
      // Helper to normalize end-of-day for inclusive upper bound
      const endOfDayIso = (iso?: string) => {
        if (!iso) return undefined;
        const d = new Date(iso);
        d.setUTCHours(23, 59, 59, 999);
        return d.toISOString();
      };
      // Apply common filters to a query builder
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyFilters = (q: any) => {
        if (filters.teamIds && filters.teamIds.length > 0) q = q.in('team_id', filters.teamIds);
        if (filters.organizationIds && filters.organizationIds.length > 0) q = q.in('organization_id', filters.organizationIds);
        if (filters.channels && filters.channels.length > 0) q = q.in('channel', filters.channels);
        if (filters.dateFrom) q = q.gte('occurred_at', filters.dateFrom);
        if (filters.dateTo) q = q.lte('occurred_at', endOfDayIso(filters.dateTo));
        return q;
      };
      // Fetch distinct people keys by (optional) event type and (optional) channel override, paging by person_key only
      const PAGE = 5000;
      async function fetchDistinctPeople(eventType?: InferenceEvent['event_type'], channelOverride?: Array<'email' | 'linkedin' | 'other'>) {
        const people = new Set<string>();
        let from = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb: any = supabase;
        while (true) {
          let q = sb.from('inference_events_enriched' as any).select('person_key', { count: 'exact' }).order('occurred_at', { ascending: false });
          if (eventType) q = q.eq('event_type', eventType);
          q = applyFilters(q);
          if (channelOverride && channelOverride.length > 0) {
            q = q.in('channel', channelOverride);
          }
          q = q.range(from, from + PAGE - 1);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          const rows = (data || []) as Array<{ person_key: string | null }>;
          for (const r of rows) {
            const pk = (r.person_key || '').trim();
            if (pk) people.add(pk);
          }
          if (rows.length < PAGE) break;
          from += PAGE;
        }
        return Array.from(people);
      }
      // Replies (respect current channels selection if provided)
      const replyPeople = await fetchDistinctPeople('replied');
      // Email/LinkedIn channel subsets regardless of current filter (stable per-channel KPIs)
      const emailPeople = await fetchDistinctPeople('replied', ['email']);
      const liPeople = await fetchDistinctPeople('replied', ['linkedin']);
      // Total contacts — any event respecting current filter selection
      const contactPeople = await fetchDistinctPeople(undefined);

      // Build best-intent per reply person using classified events (most recent non-unknown)
      const byPersonBestIntent = new Map<string, string>();
      const replyKeys = replyPeople;
      const CHUNK = 400;
      for (let i = 0; i < replyKeys.length; i += CHUNK) {
        const slice = replyKeys.slice(i, i + CHUNK);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb: any = supabase;
        let q = sb
          .from('inference_events_enriched' as any)
          .select('person_key,intent,occurred_at,channel')
          .eq('event_type', 'classified')
          .in('person_key', slice)
          .order('occurred_at', { ascending: false });
        q = applyFilters(q);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = (data || []) as Array<{ person_key: string | null; intent: string | null; occurred_at: string }>;
        for (const r of rows) {
          const pk = (r.person_key || '').trim();
          if (!pk) continue;
          if (byPersonBestIntent.has(pk)) continue;
          if (r.intent && r.intent !== 'unknown') {
            byPersonBestIntent.set(pk, r.intent);
          }
        }
      }
      // Assign unknown for any reply people not classified or only unknown
      for (const pk of replyPeople) {
        if (!byPersonBestIntent.has(pk)) byPersonBestIntent.set(pk, 'unknown');
      }
      const orderedIntents = ['interested', 'not_interested', 'referral', 'out_of_office', 'needs_more_info', 'bounce', 'unknown'];
      const intentCounts: Record<string, number> = Object.fromEntries(orderedIntents.map((k) => [k, 0]));
      for (const v of byPersonBestIntent.values()) {
        const key = orderedIntents.includes(String(v)) ? String(v) : 'unknown';
        intentCounts[key] = (intentCounts[key] || 0) + 1;
      }
      const personIntentMap: Record<string, string> = {};
      for (const [pk, intent] of byPersonBestIntent.entries()) personIntentMap[pk] = intent;

      return {
        totalContacts: new Set(contactPeople).size,
        totalRepliesPeople: new Set(replyPeople).size,
        emailRepliesPeople: new Set(emailPeople).size,
        liRepliesPeople: new Set(liPeople).size,
        replyPeople,
        intentComposition: intentCounts,
        personIntentMap,
      };
    },
    staleTime: 60_000,
  });
}

