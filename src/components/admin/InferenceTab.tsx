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
import { CalendarIcon, Sparkles, Filter, Users, BarChart as BarChartIcon } from 'lucide-react';
import {
  InferenceEvent,
  InferenceFilters,
  ReplyLatencyRow,
  computeCopyPerformance,
  computeRatesByDimension,
  useInferenceEvents,
  useOrganizationsLite,
  useReplyLatency,
  useTeams,
} from '@/hooks/useInferenceData';
import { BarChartComponent } from '@/components/insights/charts/BarChartComponent';
import { SummaryCard } from '@/components/insights/charts/SummaryCard';

export function InferenceTab() {
  // Filters
  const [teamId, setTeamId] = useState<string | 'all'>('all');
  const [orgId, setOrgId] = useState<string | 'all'>('all');
  const [channels, setChannels] = useState<Array<'email' | 'linkedin' | 'other'>>(['email', 'linkedin']);
  const [intent, setIntent] = useState<'all' | NonNullable<InferenceEvent['intent']>>('all');
  const [eventTypes, setEventTypes] = useState<InferenceEvent['event_type'][]>(['sent', 'replied', 'classified']);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d;
  });
  const [dateTo, setDateTo] = useState<Date | undefined>(new Date());

  const { data: teams } = useTeams();
  const { data: orgs } = useOrganizationsLite();

  const filters: InferenceFilters = useMemo(
    () => ({
      teamIds: teamId !== 'all' ? [teamId] : undefined,
      organizationIds: orgId !== 'all' ? [orgId] : undefined,
      channels,
      intents: intent !== 'all' ? [intent] : undefined,
      eventTypes,
      dateFrom: dateFrom ? dateFrom.toISOString() : undefined,
      dateTo: dateTo ? dateTo.toISOString() : undefined,
    }),
    [teamId, orgId, channels, intent, eventTypes, dateFrom, dateTo]
  );

  const { data: events = [], isLoading, error } = useInferenceEvents(filters);
  const { data: replyPairs = [] } = useReplyLatency(filters);

  // Derived metrics
  const ratesByIndustry = useMemo(() => computeRatesByDimension(events, 'industry', channels), [events, channels]);
  const ratesByTitle = useMemo(() => computeRatesByDimension(events, 'job_title', channels), [events, channels]);
  const ratesByCity = useMemo(() => computeRatesByDimension(events, 'city', channels), [events, channels]);
  const copyPerf = useMemo(() => computeCopyPerformance(events, replyPairs), [events, replyPairs]);

  const interestedTotal = useMemo(() => events.filter((e) => e.event_type === 'classified' && e.intent === 'interested').length, [events]);
  const classifiedTotal = useMemo(() => events.filter((e) => e.event_type === 'classified').length, [events]);
  const interestedRateOverall = classifiedTotal > 0 ? interestedTotal / classifiedTotal : 0;
  const sentTotal = useMemo(() => events.filter((e) => e.event_type === 'sent').length, [events]);
  const repliedTotal = useMemo(() => events.filter((e) => e.event_type === 'replied').length, [events]);
  const replyRateOverall = sentTotal > 0 ? repliedTotal / sentTotal : 0;

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
      {/* Filters */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            {dateFrom ? format(dateFrom, 'MMM d, yyyy') : '—'} – {dateTo ? format(dateTo, 'MMM d, yyyy') : '—'}
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
            <Label>Intent</Label>
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
                    <span>Pick a range</span>
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
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Interested rate"
          value={`${(interestedRateOverall * 100).toFixed(1)}%`}
          description={`${interestedTotal} interested of ${classifiedTotal} classified`}
          icon={Sparkles}
        />
        <SummaryCard
          title="Reply rate"
          value={`${(replyRateOverall * 100).toFixed(1)}%`}
          description={`${repliedTotal} replies of ${sentTotal} sends`}
          icon={BarChartIcon}
        />
        <SummaryCard title="Events loaded" value={events.length} icon={Users} />
      </div>

      {/* Insights */}
      <Tabs defaultValue="industry" className="space-y-4">
        <div className="border-b">
          <TabsList>
            <TabsTrigger value="industry">By Industry</TabsTrigger>
            <TabsTrigger value="title">By Job Title</TabsTrigger>
            <TabsTrigger value="city">By City</TabsTrigger>
            <TabsTrigger value="copy">By Copy</TabsTrigger>
            <TabsTrigger value="person">Person Timeline</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="industry" className="space-y-6">
          <InsightRatesPanel title="Reply rate by industry" rows={ratesByIndustry} kind="reply" />
          <InsightRatesPanel title="Interested rate by industry" rows={ratesByIndustry} kind="interested" />
        </TabsContent>
        <TabsContent value="title" className="space-y-6">
          <InsightRatesPanel title="Reply rate by job title" rows={ratesByTitle} kind="reply" />
          <InsightRatesPanel title="Interested rate by job title" rows={ratesByTitle} kind="interested" />
        </TabsContent>
        <TabsContent value="city" className="space-y-6">
          <InsightRatesPanel title="Reply rate by city" rows={ratesByCity} kind="reply" />
          <InsightRatesPanel title="Interested rate by city" rows={ratesByCity} kind="interested" />
        </TabsContent>
        <TabsContent value="copy" className="space-y-4">
          <CopyPerformanceTable rows={copyPerf} onOpenTimeline={(personKey) => setTimelinePersonKey(personKey)} />
        </TabsContent>
        <TabsContent value="person" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Person timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter person_key (email or LinkedIn URL)"
                  value={personKeyQuery}
                  onChange={(e) => setPersonKeyQuery(e.target.value)}
                />
                <Button disabled={!personKeyQuery.trim()} onClick={() => setTimelinePersonKey(personKeyQuery.trim())}>
                  Load
                </Button>
              </div>
              {timelinePersonKey && <PersonTimeline personKey={timelinePersonKey} events={personEvents} />}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog timeline when opened from a row click */}
      <Dialog open={!!timelinePersonKey && personKeyQuery === ''} onOpenChange={(o) => !o && setTimelinePersonKey(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Timeline — {timelinePersonKey}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto">
            {timelinePersonKey && <PersonTimeline personKey={timelinePersonKey} events={personEvents} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InsightRatesPanel({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: ReturnType<typeof computeRatesByDimension>;
  kind: 'reply' | 'interested';
}) {
  const top10 = rows.slice(0, 10);
  const data: Record<string, number> = {};
  for (const r of top10) {
    data[`${r.key}${r.channel !== 'all' ? ` (${r.channel})` : ''}`] = (kind === 'reply' ? r.replyRate : r.interestedRate) * 100;
  }
  return <BarChartComponent title={title} data={data} yAxisLabel="% rate" />;
}

function CopyPerformanceTable({
  rows,
  onOpenTimeline,
}: {
  rows: ReturnType<typeof computeCopyPerformance>;
  onOpenTimeline: (personKey: string) => void;
}) {
  const top = rows.slice(0, 25);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance by copy fingerprint</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Copy</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Snippet</TableHead>
                <TableHead className="text-right">Interested rate</TableHead>
                <TableHead className="text-right">Reply rate</TableHead>
                <TableHead className="text-right">Classified</TableHead>
                <TableHead className="text-right">Replies</TableHead>
                <TableHead className="text-right">Sends</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((r) => (
                <TableRow key={r.copy_fingerprint}>
                  <TableCell className="max-w-[220px]">
                    <div className="font-mono text-xs break-all">{r.copy_fingerprint}</div>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="truncate">{r.subject ?? '—'}</div>
                  </TableCell>
                  <TableCell className="max-w-[360px]">
                    <div className="truncate text-muted-foreground">{r.outbound_snippet ?? '—'}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{(r.interestedRate * 100).toFixed(1)}%</Badge>
                  </TableCell>
                  <TableCell className="text-right">{(r.replyRate * 100).toFixed(1)}%</TableCell>
                  <TableCell className="text-right">{r.classified}</TableCell>
                  <TableCell className="text-right">{r.replied}</TableCell>
                  <TableCell className="text-right">{r.sent}</TableCell>
                </TableRow>
              ))}
              {top.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No data for the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function PersonTimeline({ personKey, events }: { personKey: string; events: InferenceEvent[] }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-2">{events.length} events</div>
      <div className="space-y-3">
        {events.map((e) => (
          <div key={e.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{e.channel}</Badge>
                <Badge variant="secondary">{e.event_type}</Badge>
                {e.intent && <Badge className="bg-primary/10 text-primary hover:bg-primary/20">{e.intent}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{format(new Date(e.occurred_at), 'MMM d, yyyy HH:mm')}</div>
            </div>
            <Separator className="my-2" />
            <div className="space-y-1">
              {e.subject && <div className="text-sm"><span className="font-medium">Subject:</span> {e.subject}</div>}
              {/* Outbound message for sent */}
              {e.event_type === 'sent' && typeof e.metadata?.['outbound_message'] === 'string' && (
                <div className="text-sm">
                  <span className="font-medium">Sent:</span>{' '}
                  <span className="text-muted-foreground">{String(e.metadata?.['outbound_message']).slice(0, 400)}</span>
                </div>
              )}
              {/* Reply text for replied */}
              {e.event_type === 'replied' && typeof e.metadata?.['reply_text'] === 'string' && (
                <div className="text-sm">
                  <span className="font-medium">Reply:</span>{' '}
                  <span className="text-muted-foreground">{String(e.metadata?.['reply_text']).slice(0, 400)}</span>
                </div>
              )}
              {/* Copy fingerprint */}
              {e.copy_fingerprint && (
                <div className="text-xs text-muted-foreground">copy_fingerprint: <span className="font-mono">{e.copy_fingerprint}</span></div>
              )}
              {/* Provenance */}
              <div className="text-xs text-muted-foreground">source: {e.source}</div>
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-sm text-muted-foreground">No events found for {personKey}.</div>
        )}
      </div>
    </div>
  );
}

