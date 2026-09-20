import { useEffect, useMemo, useState } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format, subDays } from 'date-fns';
import { CalendarIcon, Loader2, ArrowLeft } from 'lucide-react';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { ChartWithToggle } from '@/components/insights/charts/ChartWithToggle';
import { useBaseInferenceKpis, InferenceFilters, useExactInferencePeopleKpis } from '@/hooks/useInferenceData';

type InferenceEvent = {
  id: string;
  team_id: string | null;
  organization_id: string | null;
  agent_config_id: string | null;
  person_key: string | null;
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
  channel: string | null;
  campaign_external_id: string | null;
  campaign_name: string | null;
  sequence_step_type: string | null;
  copy_fingerprint: string | null;
  subject: string | null;
  event_type: string | null;
  intent: string | null;
  is_objection: boolean | null;
  pipeline_stage: string | null;
  disposition_tag: string | null;
  occurred_at: string | null;
  source: string | null;
  source_row_id: string | null;
  metadata: unknown | null;
  created_at: string | null;
};

type DateRange = {
  from: Date | undefined;
  to: Date | undefined;
};

// Build a safe Supabase query for our filters. Cast supabase to any because
// inference_events is not present in the generated Database types yet.
function buildInferenceQuery(filters: {
  dateRange: DateRange;
  teamId?: string;
  organizationId?: string;
  eventType?: string;
  intent?: string;
  channel?: string;
  select: string;
  orderByOccurredAt?: boolean;
  from?: number;
  to?: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = supabase;
  // Prefer enriched view which coalesces firmographics from people when blanks
  let query = sb
    .from('inference_events_enriched' as any)
    .select(filters.select, { count: 'exact' });

  const { dateRange, teamId, organizationId, eventType, intent, channel } = filters;

  if (dateRange.from) {
    query = query.gte('occurred_at', dateRange.from.toISOString());
  }
  if (dateRange.to) {
    // Include the entire day for "to" — set to end-of-day UTC
    const end = new Date(dateRange.to);
    end.setUTCHours(23, 59, 59, 999);
    query = query.lte('occurred_at', end.toISOString());
  }
  if (teamId && teamId !== 'all') query = query.eq('team_id', teamId);
  if (organizationId && organizationId !== 'all') query = query.eq('organization_id', organizationId);
  if (eventType && eventType !== 'all') query = query.eq('event_type', eventType);
  if (intent && intent !== 'all') query = query.eq('intent', intent);
  if (channel && channel !== 'all') query = query.eq('channel', channel);

  if (filters.orderByOccurredAt) {
    query = query.order('occurred_at', { ascending: false, nullsFirst: false });
  }

  if (typeof filters.from === 'number' && typeof filters.to === 'number') {
    query = query.range(filters.from, filters.to);
  }

  return query;
}

function useInferenceSample(filters: {
  dateRange: DateRange;
  teamId?: string;
  organizationId?: string;
  eventType?: string;
  intent?: string;
  channel?: string;
}) {
  return useQuery({
    queryKey: ['inference-agg', filters],
    queryFn: async (): Promise<InferenceEvent[]> => {
      const { data, error } = await buildInferenceQuery({
        ...filters,
        select:
          'id, occurred_at, person_key, team_id, organization_id, event_type, intent, channel, industry, job_title, city, state, company_size',
        orderByOccurredAt: false,
      });
      if (error) throw error;
      return (data || []) as InferenceEvent[];
    },
  });
}

function useInferencePaged(filters: {
  dateRange: DateRange;
  teamId?: string;
  organizationId?: string;
  eventType?: string;
  intent?: string;
  channel?: string;
  page: number;
  perPage: number;
}) {
  return useQuery({
    queryKey: ['inference-paged', filters],
    queryFn: async (): Promise<{ rows: InferenceEvent[]; total: number }> => {
      const from = (filters.page - 1) * filters.perPage;
      const to = from + filters.perPage - 1;
      const { data, error, count } = await buildInferenceQuery({
        ...filters,
        select:
          'id, occurred_at, full_name, email, company_name, job_title, industry, city, state, country, company_size, channel, campaign_name, event_type, intent, copy_fingerprint, source',
        orderByOccurredAt: true,
        from,
        to,
      });
      if (error) throw error;
      return { rows: (data || []) as InferenceEvent[], total: count || 0 };
    },
  });
}

function groupBy<T, K extends string | number>(rows: T[], getKey: (r: T) => K | null | undefined): Record<string, T[]> {
  return rows.reduce<Record<string, T[]>>((acc, r) => {
    const k = getKey(r);
    if (!k && k !== 0) return acc;
    const key = String(k);
    (acc[key] ||= []).push(r);
    return acc;
  }, {});
}

function countBy<T, K extends string | number>(rows: T[], getKey: (r: T) => K | null | undefined): Record<string, number> {
  const grouped = groupBy(rows, getKey);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(grouped)) out[k] = v.length;
  return out;
}

function topN(map: Record<string, number>, n: number): Record<string, number> {
  const entries = Object.entries(map).filter(([k]) => {
    const key = String(k || '').trim();
    const lower = key.toLowerCase();
    // Exclude blank/unknown buckets from the ranked bars
    return !!key && lower !== 'unknown' && key !== '(unknown)' && key !== 'null' && key !== 'undefined';
  });
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, n));
}

export default function AdminInference() {
  const navigate = useNavigate();
  const { isPlatformAdmin } = useAuthStore();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: undefined,
    to: undefined,
  });
  const [teamId, setTeamId] = useState<string>('all');
  const [organizationId, setOrganizationId] = useState<string>('all');
  // Event-type selector remains available but UI focuses on replies-based analytics
  const [eventType, setEventType] = useState<string>('all');
  // "Within an intent" pivot (default all)
  const [intent, setIntent] = useState<string>('all');
  const [channel, setChannel] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(25);

  // Base KPIs (All Time)
  const baseFilters: InferenceFilters = useMemo(() => ({
    teamIds: teamId !== 'all' ? [teamId] : undefined,
    dateFrom: undefined,
    dateTo: undefined,
  }), [teamId]);
  const { data: baseKpis, isLoading: loadingBase } = useBaseInferenceKpis(baseFilters);

  // Aggregation sample — minimal columns
  const { data: sampleRows = [], isLoading: loadingAgg, refetch } = useInferenceSample({
    dateRange,
    teamId,
    organizationId,
    eventType,
    intent,
    channel,
  });

  // Paged table
  const {
    data: paged,
    isLoading: loadingTable,
    refetch: refetchTable,
  } = useInferencePaged({
    dateRange,
    teamId,
    organizationId,
    eventType,
    intent,
    channel,
    page,
    perPage,
  });

  // Derive filter option sets from the current aggregation sample (keeps network simple for v1).
  const teamOptions = useMemo(() => Array.from(new Set(sampleRows.map((r) => r.team_id).filter(Boolean))) as string[], [sampleRows]);
  const orgOptions = useMemo(
    () => Array.from(new Set(sampleRows.map((r) => r.organization_id).filter(Boolean))) as string[],
    [sampleRows],
  );
  const eventTypes = useMemo(
    () => Array.from(new Set(sampleRows.map((r) => r.event_type).filter(Boolean))) as string[],
    [sampleRows],
  );
  const intents = useMemo(
    () => Array.from(new Set(sampleRows.map((r) => r.intent).filter(Boolean))) as string[],
    [sampleRows],
  );
  const channels = useMemo(
    () => Array.from(new Set(sampleRows.map((r) => r.channel).filter(Boolean))) as string[],
    [sampleRows],
  );

  // Exact KPIs via shared hook
  const kpiFilters: InferenceFilters = useMemo(
    () => ({
      teamIds: teamId !== 'all' ? [teamId] : undefined,
      organizationIds: organizationId !== 'all' ? [organizationId] : undefined,
      channels: channel === 'all' ? undefined : [channel as 'email' | 'linkedin' | 'other'],
      dateFrom: dateRange.from ? dateRange.from.toISOString() : undefined,
      dateTo: dateRange.to ? dateRange.to.toISOString() : undefined,
    }),
    [teamId, organizationId, channel, dateRange.from, dateRange.to]
  );
  const { data: exactKpis, isLoading: loadingKpis } = useExactInferencePeopleKpis(kpiFilters);
  const uniqueContacts = exactKpis?.totalContacts ?? 0;
  const replyPeopleAll = useMemo(() => new Set(exactKpis?.replyPeople ?? []), [exactKpis]);
  const replyPeopleEmail = useMemo(() => exactKpis?.emailRepliesPeople ?? 0, [exactKpis]);
  const replyPeopleLinkedIn = useMemo(() => exactKpis?.liRepliesPeople ?? 0, [exactKpis]);
  const dateSpan = useMemo(() => {
    const dates = sampleRows.map((r) => (r.occurred_at ? new Date(r.occurred_at) : null)).filter(Boolean) as Date[];
    if (dates.length === 0) return null;
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    return `${format(min, 'yyyy-MM-dd')} → ${format(max, 'yyyy-MM-dd')}`;
  }, [sampleRows]);

  // Replies-only subsets for composition & breakdowns
  const replyRows = useMemo(
    () => sampleRows.filter((r) => r.event_type === 'replied' && (channel === 'all' || r.channel === channel)),
    [sampleRows, channel],
  );
  const classifiedRows = useMemo(
    () => sampleRows.filter((r) => r.event_type === 'classified' && (channel === 'all' || r.channel === channel)),
    [sampleRows, channel],
  );

  // Intent mix (counts + % of replies). Prefer classified rows when intent populated.
  const intentOrder = ['interested', 'not_interested', 'referral', 'out_of_office', 'needs_more_info', 'bounce', 'unknown'];
  const intentComposition = useMemo(() => {
    return (
      exactKpis?.intentComposition ?? Object.fromEntries(intentOrder.map((k) => [k, 0]))
    );
  }, [exactKpis]);

  // "Within an intent" filter (default all replies)
  const withinIntentPeople = useMemo(() => {
    // Use intentComposition resolution to pick the set of people included
    // Build set of person_keys that match selected intent (or all)
    const result = new Set<string>();
    if (intent === 'all') {
      for (const r of replyRows) if (r.person_key) result.add(r.person_key);
      return result;
    }
    // Recompute best-intent mapping to know which people to include
    const classByPerson = groupBy(
      classifiedRows.slice().sort((a, b) => (a.occurred_at && b.occurred_at ? (a.occurred_at < b.occurred_at ? 1 : -1) : 0)),
      (r) => r.person_key || '',
    );
    for (const r of replyRows) {
      const pk = r.person_key || '';
      if (!pk) continue;
      const classList = classByPerson[pk] || [];
      const chosen =
        classList.find((c) => c.intent && c.intent !== 'unknown')?.intent ||
        (r.intent && r.intent !== 'unknown' ? r.intent : 'unknown');
      if (chosen === intent) result.add(pk);
    }
    return result;
  }, [replyRows, classifiedRows, intent]);

  function rankBreakdownForPeople(
    peopleSet: Set<string>,
    dim: 'job_title' | 'industry' | 'company_size' | 'city_state',
    topK = 10,
  ): Record<string, number> {
    // One person -> one bucket. Deduplicate by person_key before counting.
    const personToBucket = new Map<string, string>();
    for (const r of sampleRows) {
      const pk = (r.person_key || '').trim();
      if (!pk || !peopleSet.has(pk) || personToBucket.has(pk)) continue;
      let key = '';
      if (dim === 'city_state') {
        const city = (r.city || '').trim();
        const state = (r.state || '').trim();
        key = [city, state].filter(Boolean).join(', ');
      } else {
        key = String((r as any)[dim] || '').trim();
      }
      if (!key) continue; // hide unknown/blank
      personToBucket.set(pk, key);
    }
    const counts: Record<string, number> = {};
    for (const key of personToBucket.values()) counts[key] = (counts[key] || 0) + 1;
    return topN(counts, topK);
  }

  // Data quality notes (fill rates) for each dim among the included people
  function fillRateForPeople(peopleSet: Set<string>, field: 'job_title' | 'industry' | 'company_size' | 'city_state'): number {
    const seen = new Set<string>();
    let withValue = 0;
    for (const r of sampleRows) {
      const pk = r.person_key || '';
      if (!peopleSet.has(pk) || seen.has(pk)) continue;
      seen.add(pk);
      let has = false;
      if (field === 'city_state') {
        has = !!((r.city || '').trim() || (r.state || '').trim());
      } else {
        has = !!String((r as any)[field] || '').trim();
      }
      if (has) withValue += 1;
    }
    const denom = peopleSet.size || 1;
    return (withValue / denom) * 100;
  }

  const breakdownJobTitle = useMemo(() => rankBreakdownForPeople(withinIntentPeople, 'job_title', 12), [withinIntentPeople, sampleRows]);
  const breakdownIndustry = useMemo(() => rankBreakdownForPeople(withinIntentPeople, 'industry', 12), [withinIntentPeople, sampleRows]);
  const breakdownCompanySize = useMemo(
    () => rankBreakdownForPeople(withinIntentPeople, 'company_size', 12),
    [withinIntentPeople, sampleRows],
  );
  const breakdownGeo = useMemo(() => rankBreakdownForPeople(withinIntentPeople, 'city_state', 12), [withinIntentPeople, sampleRows]);
  const fillJobTitle = useMemo(() => fillRateForPeople(withinIntentPeople, 'job_title'), [withinIntentPeople, sampleRows]);
  const fillIndustry = useMemo(() => fillRateForPeople(withinIntentPeople, 'industry'), [withinIntentPeople, sampleRows]);
  const fillCompanySize = useMemo(() => fillRateForPeople(withinIntentPeople, 'company_size'), [withinIntentPeople, sampleRows]);
  const fillGeo = useMemo(() => fillRateForPeople(withinIntentPeople, 'city_state'), [withinIntentPeople, sampleRows]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [teamId, organizationId, eventType, intent, channel, dateRange.from?.toISOString(), dateRange.to?.toISOString()]);

  const loading = loadingAgg || loadingTable || loadingKpis;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
            <SidebarTrigger />
            <img
              src={vrellyLogo}
              alt="Vrelly"
              className="h-8 max-h-8 cursor-pointer"
              onClick={() => navigate('/')}
            />
            <h1 className="text-lg font-semibold ml-4">Admin — Inference Analytics (People-level)</h1>
            <div className="ml-auto">
              {!isPlatformAdmin && <Badge variant="destructive">Admin only</Badge>}
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">
            <div className="max-w-7xl mx-auto space-y-6">
              {/* Back link */}
              <Link
                to="/admin"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Admin
              </Link>
              {/* Filters */}
              <Card>
                <CardHeader>
                  <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-4">
                  {/* Date range */}
                  <div className="col-span-2">
                    <label className="text-sm text-muted-foreground">Date range</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            'w-full justify-start text-left font-normal mt-1',
                            !dateRange.from && !dateRange.to && 'text-muted-foreground',
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dateRange.from ? (
                            dateRange.to ? (
                              <>
                                {format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}
                              </>
                            ) : (
                              format(dateRange.from, 'LLL dd, y')
                            )
                          ) : (
                            <span>All Time</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          initialFocus
                          mode="range"
                          defaultMonth={dateRange.from}
                          selected={dateRange as any}
                          onSelect={(range) => setDateRange(range as unknown as DateRange)}
                          numberOfMonths={2}
                        />
                        <div className="flex items-center justify-between p-2 border-t">
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setDateRange({ from: subDays(new Date(), 7), to: new Date() })}>
                              Last 7d
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDateRange({ from: subDays(new Date(), 30), to: new Date() })}>
                              Last 30d
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDateRange({ from: subDays(new Date(), 90), to: new Date() })}>
                              Last 90d
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setDateRange({ from: undefined, to: undefined })}>
                              Clear (All Time)
                            </Button>
                            <Button size="sm" onClick={() => { refetch(); refetchTable(); }}>
                              Apply
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Team */}
                  <div>
                    <label className="text-sm text-muted-foreground">Team</label>
                    <Select value={teamId} onValueChange={(v) => setTeamId(v)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="All teams" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {teamOptions.map((id) => (
                          <SelectItem key={id} value={id}>
                            {id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Organization */}
                  <div>
                    <label className="text-sm text-muted-foreground">Organization</label>
                    <Select value={organizationId} onValueChange={(v) => setOrganizationId(v)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="All orgs" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {orgOptions.map((id) => (
                          <SelectItem key={id} value={id}>
                            {id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Event type */}
                  <div>
                    <label className="text-sm text-muted-foreground">Event type</label>
                    <Select value={eventType} onValueChange={(v) => setEventType(v)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="All types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {eventTypes.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Within intent (pivot for breakdowns) */}
                  <div>
                    <label className="text-sm text-muted-foreground">Within intent</label>
                    <Select value={intent} onValueChange={(v) => setIntent(v)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="All replies" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All replies</SelectItem>
                        {['interested','not_interested','referral','out_of_office','needs_more_info','bounce','unknown']
                          .filter((i) => intents.includes(i as any) || i === 'unknown')
                          .map((i) => (
                          <SelectItem key={i} value={i}>
                            {i}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Channel */}
                  <div>
                    <label className="text-sm text-muted-foreground">Channel</label>
                    <Select value={channel} onValueChange={(v) => setChannel(v)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="All channels" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {channels.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* KPI cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Base KPIs (All Time) */}
                <Card className="md:col-span-2 lg:col-span-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Base KPIs (All Time)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        { title: 'Total Contacts', value: baseKpis?.totalContactsDeduped, source: baseKpis?.sources.totalContactsDeduped },
                        { title: 'Email Sends', value: baseKpis?.emailSends, source: baseKpis?.sources.emailSends },
                        { title: 'Email Replies (campaign)', value: baseKpis?.emailRepliesCampaignTotal, source: baseKpis?.sources.emailRepliesCampaignTotal },
                        { title: 'LI Connections Sent', value: baseKpis?.linkedinConnectionsSent, source: baseKpis?.sources.linkedinConnectionsSent },
                        { title: 'LI Connections Accepted', value: baseKpis?.linkedinConnectionsAccepted, source: baseKpis?.sources.linkedinConnectionsAccepted },
                        { title: 'LI Messages Sent', value: baseKpis?.linkedinMessagesSent, source: baseKpis?.sources.linkedinMessagesSent },
                        { title: 'Interested (people)', value: baseKpis?.interestedPeople, source: baseKpis?.sources.interestedPeople },
                      ].map((kpi) => (
                        <Card key={kpi.title}>
                          <CardContent className="pt-6">
                            <div>
                              <p className="text-sm text-muted-foreground">{kpi.title}</p>
                              <p className="text-2xl font-semibold mt-1">{loadingBase ? '…' : (kpi.value ?? 0).toLocaleString()}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">{kpi.source}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Legacy sample-driven KPIs */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Total Contacts</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : uniqueContacts.toLocaleString()}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Total Replies (people)</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : replyPeopleAll.size.toLocaleString()}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Email Replies (people)</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : Number(replyPeopleEmail).toLocaleString()}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">LinkedIn Replies (people)</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : Number(replyPeopleLinkedIn).toLocaleString()}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">LI Connection accepts</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    {/* No dedicated accept signal in prod — present honest empty note */}
                    —
                    <div className="text-xs text-muted-foreground mt-1">
                      Not captured in events; no safe detection in HeyReach payloads.
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* OF REPLIES — intent mix (counts + % of replies; classified preferred) */}
              <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Intent mix (of replies)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground mb-2">
                      Uses classified rows when available; unclassified replies counted as unknown.
                    </div>
                    <ChartWithToggle title="" data={intentComposition} defaultType="pie" />
                  </CardContent>
                </Card>
              </div>

              {/* WITHIN AN INTENT — breakdowns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Job titles</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={breakdownJobTitle} defaultType="bar" />
                    <div className="text-xs text-muted-foreground mt-2">
                      Data quality: {fillJobTitle.toFixed(0)}% of replies have a job title.
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Geography (City, State)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={breakdownGeo} defaultType="bar" />
                    <div className="text-xs text-muted-foreground mt-2">
                      Data quality: {fillGeo.toFixed(0)}% of replies have city/state.
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Industry</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={breakdownIndustry} defaultType="bar" />
                    <div className="text-xs text-muted-foreground mt-2">
                      Data quality: {fillIndustry.toFixed(0)}% of replies have industry.
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Company size</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={breakdownCompanySize} defaultType="bar" />
                    <div className="text-xs text-muted-foreground mt-2">
                      Data quality: {fillCompanySize.toFixed(0)}% of replies have company size.
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Recent events table */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent events</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="text-sm text-muted-foreground">
                      {paged?.total?.toLocaleString() ?? '—'} total
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <label className="text-sm text-muted-foreground">Per page</label>
                      <Input
                        type="number"
                        className="w-20 h-8"
                        min={5}
                        max={100}
                        value={perPage}
                        onChange={(e) => setPerPage(Math.max(5, Math.min(100, Number(e.target.value) || 25)))}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          refetchTable();
                        }}
                      >
                        Refresh
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[140px]">Occurred</TableHead>
                          <TableHead>Person</TableHead>
                          <TableHead>Firmographics</TableHead>
                          <TableHead>Channel</TableHead>
                          <TableHead>Campaign</TableHead>
                          <TableHead>Event</TableHead>
                          <TableHead>Intent</TableHead>
                          <TableHead>Copy FP</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingTable && (
                          <TableRow>
                            <TableCell colSpan={9}>
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        {!loadingTable &&
                          (paged?.rows || []).map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="whitespace-nowrap">{r.occurred_at ? format(new Date(r.occurred_at), 'yyyy-MM-dd HH:mm') : '—'}</TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium">{r.full_name || '—'}</span>
                                  <span className="text-xs text-muted-foreground">{r.email || '—'}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">
                                  <div className="flex flex-wrap gap-2">
                                    {r.company_name && <Badge variant="outline">{r.company_name}</Badge>}
                                    {r.job_title && <Badge variant="secondary">{r.job_title}</Badge>}
                                    {r.industry && <Badge variant="outline">{r.industry}</Badge>}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {[r.city, r.state, r.country].filter(Boolean).join(', ') || '—'}
                                  </div>
                                  <div className="text-xs text-muted-foreground">{r.company_size || ''}</div>
                                </div>
                              </TableCell>
                              <TableCell>{r.channel || '—'}</TableCell>
                              <TableCell className="max-w-[220px] truncate">{r.campaign_name || '—'}</TableCell>
                              <TableCell>{r.event_type || '—'}</TableCell>
                              <TableCell>{r.intent || '—'}</TableCell>
                              <TableCell className="max-w-[140px] truncate">{r.copy_fingerprint || '—'}</TableCell>
                              <TableCell>{r.source || '—'}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-sm text-muted-foreground">
                      Page {page} of {paged?.total ? Math.max(1, Math.ceil(paged.total / perPage)) : 1}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!paged?.total || page >= Math.ceil((paged.total || 0) / perPage)}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

