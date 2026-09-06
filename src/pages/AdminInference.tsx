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
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { ChartWithToggle } from '@/components/insights/charts/ChartWithToggle';

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
  let query = sb
    .from('inference_events')
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
          'id, occurred_at, person_key, team_id, organization_id, event_type, intent, channel, industry, job_title, city',
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
  const entries = Object.entries(map).filter(([k]) => !!k && k !== 'null' && k !== 'undefined');
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, n));
}

export default function AdminInference() {
  const navigate = useNavigate();
  const { isPlatformAdmin } = useAuthStore();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 90),
    to: new Date(),
  });
  const [teamId, setTeamId] = useState<string>('all');
  const [organizationId, setOrganizationId] = useState<string>('all');
  const [eventType, setEventType] = useState<string>('all');
  const [intent, setIntent] = useState<string>('all');
  const [channel, setChannel] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(25);

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

  // KPIs
  const totalEvents = sampleRows.length;
  const uniquePeople = useMemo(() => new Set(sampleRows.map((r) => r.person_key).filter(Boolean)).size, [sampleRows]);
  const distinctTeams = teamOptions.length;
  const dateSpan = useMemo(() => {
    const dates = sampleRows.map((r) => (r.occurred_at ? new Date(r.occurred_at) : null)).filter(Boolean) as Date[];
    if (dates.length === 0) return null;
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    return `${format(min, 'yyyy-MM-dd')} → ${format(max, 'yyyy-MM-dd')}`;
  }, [sampleRows]);
  const byEventType = useMemo(() => countBy(sampleRows, (r) => r.event_type || 'unknown'), [sampleRows]);
  const byIntent = useMemo(() => countBy(sampleRows, (r) => r.intent || 'unknown'), [sampleRows]);

  // Charts
  const byDay = useMemo(() => {
    const dayCounts: Record<string, number> = {};
    for (const r of sampleRows) {
      if (!r.occurred_at) continue;
      const d = format(new Date(r.occurred_at), 'yyyy-MM-dd');
      dayCounts[d] = (dayCounts[d] || 0) + 1;
    }
    return Object.entries(dayCounts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, count]) => ({ date, count }));
  }, [sampleRows]);

  const topIndustries = useMemo(() => topN(countBy(sampleRows, (r) => r.industry || 'unknown'), 10), [sampleRows]);
  const topTitles = useMemo(() => topN(countBy(sampleRows, (r) => r.job_title || 'unknown'), 10), [sampleRows]);
  const topCities = useMemo(() => topN(countBy(sampleRows, (r) => r.city || 'unknown'), 10), [sampleRows]);
  const channelMix = useMemo(() => countBy(sampleRows, (r) => r.channel || 'unknown'), [sampleRows]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [teamId, organizationId, eventType, intent, channel, dateRange.from?.toISOString(), dateRange.to?.toISOString()]);

  const loading = loadingAgg || loadingTable;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
            <SidebarTrigger />
            <img
              src={vrellyLogo}
              alt="Vrelly Data"
              className="h-[4.5rem] cursor-pointer"
              onClick={() => navigate('/')}
            />
            <h1 className="text-lg font-semibold ml-4">Inference Events (Admin)</h1>
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
                            <span>Pick a date range</span>
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
                          <Button size="sm" onClick={() => { refetch(); refetchTable(); }}>
                            Apply
                          </Button>
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

                  {/* Intent */}
                  <div>
                    <label className="text-sm text-muted-foreground">Intent</label>
                    <Select value={intent} onValueChange={(v) => setIntent(v)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="All intents" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {intents.map((i) => (
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Total events</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : totalEvents.toLocaleString()}</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Unique people</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : uniquePeople.toLocaleString()}</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Distinct teams</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : distinctTeams.toLocaleString()}</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Date span</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : dateSpan || '—'}</CardContent>
                </Card>
              </div>

              {/* Breakdowns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>By event type</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={byEventType} defaultType="bar" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>By intent</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={byIntent} defaultType="pie" />
                  </CardContent>
                </Card>
              </div>

              {/* Time series */}
              <Card>
                <CardHeader>
                  <CardTitle>Events over time</CardTitle>
                </CardHeader>
                <CardContent style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={byDay}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <RechartsTooltip />
                      <Line type="monotone" dataKey="count" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Top segments */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Top industries</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={topIndustries} defaultType="bar" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Top job titles</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={topTitles} defaultType="bar" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Top cities</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={topCities} defaultType="bar" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Channel mix</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartWithToggle title="" data={channelMix} defaultType="pie" />
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

