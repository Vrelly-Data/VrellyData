import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { CalendarIcon, Sparkles, Filter, Users, BarChart as BarChartIcon, Loader2 } from 'lucide-react';
import {
  InferenceEvent,
  InferenceFilters,
  useInferenceEvents,
  useExactInferencePeopleKpis,
  useOrganizationsLite,
  useTeams,
  useBaseInferenceKpis,
} from '@/hooks/useInferenceData';
import { BarChartComponent } from '@/components/insights/charts/BarChartComponentEnhanced';
import { SummaryCard } from '@/components/insights/charts/SummaryCard';
import { Progress } from '@/components/ui/progress';
import { ChartWithToggle } from '@/components/insights/charts/ChartWithToggle';

export function InferenceTab() {
  // Filters
  const [teamId, setTeamId] = useState<string | 'all'>('all');
  const [orgId, setOrgId] = useState<string | 'all'>('all');
  const [channels, setChannels] = useState<Array<'email' | 'linkedin' | 'other'>>(['email', 'linkedin']);
  const [intent, setIntent] = useState<'all' | NonNullable<InferenceEvent['intent']>>('all');
  const [eventTypes, setEventTypes] = useState<InferenceEvent['event_type'][]>(['sent', 'replied', 'classified']);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const { data: teams } = useTeams();
  const { data: orgs } = useOrganizationsLite();

  const filters: InferenceFilters = useMemo(
    () => ({
      teamIds: teamId !== 'all' ? [teamId] : undefined,
      organizationIds: orgId !== 'all' ? [orgId] : undefined,
      channels,
      eventTypes,
      dateFrom: dateFrom ? dateFrom.toISOString() : undefined,
      dateTo: dateTo ? dateTo.toISOString() : undefined,
    }),
    [teamId, orgId, channels, eventTypes, dateFrom, dateTo]
  );

  const { data: eventsResp, isLoading, error } = useInferenceEvents(filters);
  const events = (eventsResp?.rows ?? []) as InferenceEvent[];
  const totalEventsCount = eventsResp?.total ?? events.length;
  const isCapped = eventsResp?.isCapped ?? false;
  const limit = eventsResp?.limit ?? events.length;
  // Base KPIs (All Time, team/org filters where available)
  const baseFilters: InferenceFilters = {
    teamIds: filters.teamIds,
    // organizationIds intentionally omitted — base sources don't universally support it
    dateFrom: undefined,
    dateTo: undefined,
  };
  const { data: baseKpis, isLoading: loadingBase } = useBaseInferenceKpis(baseFilters);

  // Exact KPI totals and people-level intent mix — fetched via paged DB aggregates (not client samples)
  const { data: exactKpis, isLoading: loadingKpis } = useExactInferencePeopleKpis(filters);

  // New hierarchy metrics (mirror AdminInference)
  function groupBy<T, K extends string | number>(rows: T[], getKey: (r: T) => K | null | undefined): Record<string, T[]> {
    return rows.reduce<Record<string, T[]>>((acc, r) => {
      const k = getKey(r);
      if (!k && k !== 0) return acc;
      const key = String(k);
      (acc[key] ||= []).push(r);
      return acc;
    }, {});
  }
  function topN(map: Record<string, number>, n: number): Record<string, number> {
    const entries = Object.entries(map).filter(([k]) => {
      const key = String(k || '').trim();
      const lower = key.toLowerCase();
      return !!key && lower !== 'unknown' && key !== '(unknown)' && key !== 'null' && key !== 'undefined';
    });
    entries.sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(entries.slice(0, n));
  }
  // Exact KPI numbers derived from DB
  const uniqueContactsExact = exactKpis?.totalContacts ?? 0;
  const replyPeopleAllExact = exactKpis?.totalRepliesPeople ?? 0;
  const replyPeopleEmailExact = exactKpis?.emailRepliesPeople ?? 0;
  const replyPeopleLinkedInExact = exactKpis?.liRepliesPeople ?? 0;
  const intentComposition = exactKpis?.intentComposition ?? {
    interested: 0,
    not_interested: 0,
    referral: 0,
    out_of_office: 0,
    needs_more_info: 0,
    bounce: 0,
    unknown: 0,
  };
  const withinIntentPeopleExact = useMemo(() => {
    if (!exactKpis) return new Set<string>();
    if (intent === 'all') return new Set<string>(exactKpis.replyPeople ?? []);
    const s = new Set<string>();
    for (const [pk, v] of Object.entries(exactKpis.personIntentMap)) {
      if (v === intent) s.add(pk);
    }
    return s;
  }, [exactKpis, intent]);
  function rankBreakdownForPeople(
    peopleSet: Set<string>,
    dim: 'job_title' | 'industry' | 'company_size' | 'city_state',
    topK = 10,
  ): Record<string, number> {
    const personToBucket = new Map<string, string>();
    for (const r of events) {
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
      if (!key) continue;
      personToBucket.set(pk, key);
    }
    const counts: Record<string, number> = {};
    for (const key of personToBucket.values()) counts[key] = (counts[key] || 0) + 1;
    return topN(counts, topK);
  }
  function fillRateForPeople(peopleSet: Set<string>, field: 'job_title' | 'industry' | 'company_size' | 'city_state'): number {
    const seen = new Set<string>();
    let withValue = 0;
    for (const r of events) {
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
  const breakdownJobTitle = useMemo(() => rankBreakdownForPeople(withinIntentPeopleExact, 'job_title', 12), [withinIntentPeopleExact, events]);
  const breakdownIndustry = useMemo(() => rankBreakdownForPeople(withinIntentPeopleExact, 'industry', 12), [withinIntentPeopleExact, events]);
  const breakdownCompanySize = useMemo(
    () => rankBreakdownForPeople(withinIntentPeopleExact, 'company_size', 12),
    [withinIntentPeopleExact, events],
  );
  const breakdownGeo = useMemo(() => rankBreakdownForPeople(withinIntentPeopleExact, 'city_state', 12), [withinIntentPeopleExact, events]);
  const fillJobTitle = useMemo(() => fillRateForPeople(withinIntentPeopleExact, 'job_title'), [withinIntentPeopleExact, events]);
  const fillIndustry = useMemo(() => fillRateForPeople(withinIntentPeopleExact, 'industry'), [withinIntentPeopleExact, events]);
  const fillCompanySize = useMemo(() => fillRateForPeople(withinIntentPeopleExact, 'company_size'), [withinIntentPeopleExact, events]);
  const fillGeo = useMemo(() => fillRateForPeople(withinIntentPeopleExact, 'city_state'), [withinIntentPeopleExact, events]);
  // Person timeline
  const [personKeyQuery, setPersonKeyQuery] = useState('');
  const [timelinePersonKey, setTimelinePersonKey] = useState<string | null>(null);
  const personEvents: InferenceEvent[] = useMemo(() => {
    if (!timelinePersonKey) return [];
    return events
      .filter((e) => e.person_key === timelinePersonKey)
      .slice()
      .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  }, [events, timelinePersonKey]);

  useEffect(() => {
    // Clear selected person timeline when filters change drastically (team/org/date)
    setTimelinePersonKey(null);
  }, [teamId, orgId, dateFrom?.toISOString(), dateTo?.toISOString()]);

  return (
    <div className="space-y-6">
      {/* Base KPIs — All Time */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChartIcon className="h-4 w-4" /> Base KPIs (All Time)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: 'Total LI Contacts', value: baseKpis?.totalContactsLinkedinDeduped, source: baseKpis?.sources.totalContactsLinkedinDeduped },
              { title: 'Total Email Contacts', value: baseKpis?.totalContactsEmailDeduped, source: baseKpis?.sources.totalContactsEmailDeduped },
              { title: 'Total LI Replies', value: baseKpis?.repliedPeopleLinkedin, source: baseKpis?.sources.repliedPeopleLinkedin },
              { title: 'Total LI Acceptance', value: baseKpis?.linkedinConnectionsAccepted, source: baseKpis?.sources.linkedinConnectionsAccepted },
              { title: 'Total Email Replies', value: baseKpis?.repliedPeopleEmail, source: baseKpis?.sources.repliedPeopleEmail },
              { title: 'Interested Email Replies', value: baseKpis?.interestedPeopleEmail, source: baseKpis?.sources.interestedPeopleEmail },
              { title: 'Interested LI Replies', value: baseKpis?.interestedPeopleLinkedin, source: baseKpis?.sources.interestedPeopleLinkedin },
            ].map((kpi) => (
              <Card key={kpi.title}>
                <CardContent className="pt-6">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{kpi.title}</p>
                      <p className="text-2xl font-semibold mt-1">
                        {loadingBase ? '…' : (kpi.value ?? 0).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">{kpi.source}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Smartlead campaign volumes (seats and replies) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Smartlead — campaign volumes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { title: 'Smartlead Email Replies (campaign)', value: baseKpis?.emailRepliesSmartleadCampaign, source: baseKpis?.sources.emailRepliesSmartleadCampaign },
              { title: 'Smartlead Email Contacts / seats', value: baseKpis?.smartleadSeats, source: baseKpis?.sources.smartleadSeats },
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

      {/* Filters */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            {dateFrom && dateTo ? `${format(dateFrom, 'MMM d, yyyy')} – ${format(dateTo, 'MMM d, yyyy')}` : 'All Time'}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div>
            <Label>Team</Label>
            <Select value={teamId} onValueChange={(v) => setTeamId(v as any)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="All teams" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {(teams ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Organization</Label>
            <Select value={orgId} onValueChange={(v) => setOrgId(v as any)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="All orgs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All orgs</SelectItem>
                {(orgs ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Channels</Label>
            <ToggleGroup type="multiple" value={channels} onValueChange={(v) => setChannels(v as any)} className="flex flex-wrap">
              <ToggleGroupItem value="email" aria-label="Email">Email</ToggleGroupItem>
              <ToggleGroupItem value="linkedin" aria-label="LinkedIn">LinkedIn</ToggleGroupItem>
              <ToggleGroupItem value="other" aria-label="Other">Other</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div>
            <Label>Within intent</Label>
            <Select value={intent} onValueChange={(v) => setIntent(v as any)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="All intents" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="interested">interested</SelectItem>
                <SelectItem value="not_interested">not_interested</SelectItem>
                <SelectItem value="referral">referral</SelectItem>
                <SelectItem value="out_of_office">out_of_office</SelectItem>
                <SelectItem value="needs_more_info">needs_more_info</SelectItem>
                <SelectItem value="bounce">bounce</SelectItem>
                <SelectItem value="unknown">unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Event Types</Label>
            <ToggleGroup
              type="multiple"
              value={eventTypes}
              onValueChange={(v) => setEventTypes((v?.length ?? 0) > 0 ? (v as any) : [])}
              className="flex flex-wrap"
            >
              <ToggleGroupItem value="sent">sent</ToggleGroupItem>
              <ToggleGroupItem value="replied">replied</ToggleGroupItem>
              <ToggleGroupItem value="classified">classified</ToggleGroupItem>
              <ToggleGroupItem value="opened">opened</ToggleGroupItem>
              <ToggleGroupItem value="bounced">bounced</ToggleGroupItem>
              <ToggleGroupItem value="opted_out">opted_out</ToggleGroupItem>
              <ToggleGroupItem value="meeting_booked">meeting_booked</ToggleGroupItem>
              <ToggleGroupItem value="closed_won">closed_won</ToggleGroupItem>
              <ToggleGroupItem value="closed_lost">closed_lost</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div>
            <Label>Date range</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateFrom && dateTo ? (
                    <>
                      {format(dateFrom, 'MMM d, yyyy')} – {format(dateTo, 'MMM d, yyyy')}
                    </>
                  ) : (
                    <span>All Time</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="flex gap-2 p-2">
                  <div className="border rounded-md p-2">
                    <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} />
                  </div>
                  <div className="border rounded-md p-2">
                    <Calendar mode="single" selected={dateTo} onSelect={setDateTo} />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-2 pb-2">
                  <Button variant="ghost" size="sm" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
                    Clear (All Time)
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {/* TOP KPIs — people-level */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Contacts</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {loadingKpis ? <Loader2 className="h-5 w-5 animate-spin" /> : uniqueContactsExact.toLocaleString()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Replies (people)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {loadingKpis ? <Loader2 className="h-5 w-5 animate-spin" /> : replyPeopleAllExact.toLocaleString()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Email Replies (people)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {loadingKpis ? <Loader2 className="h-5 w-5 animate-spin" /> : replyPeopleEmailExact.toLocaleString()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">LinkedIn Replies (people)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {loadingKpis ? <Loader2 className="h-5 w-5 animate-spin" /> : replyPeopleLinkedInExact.toLocaleString()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">LI Connection accepts</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
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

      {/* (Legacy insights removed — rebuilt to match AdminInference hierarchy) */}
    </div>
  );
}

// (Legacy rate panels removed)

// (Legacy copy performance table removed)

// (Legacy firmographic quality panel removed)

// (Legacy person timeline removed)

