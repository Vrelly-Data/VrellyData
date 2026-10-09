import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Radar, Sparkles } from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  type SignalFilters, type SignalRow, type SignalStatus, type VerticalCount, locationOf, scoreTone, sortVerticals, verticalLabel,
} from '@/lib/signals';
import { SIGNALS_PAGE_SIZE, useSetSignalStatus, useSignalsFeed, useSignalsOverview } from '@/hooks/useSignals';
import { SignalDetailSheet } from './SignalDetailSheet';
import { AdminSourcesPanel, VerticalSourcesAdmin } from './AdminSourcesPanel';
import { PixelSitesPanel } from './PixelSitesPanel';

type Mode = 'admin' | 'client';

export function SignalsView({ mode }: { mode: Mode }) {
  const overview = useSignalsOverview();

  // Clients see only verticals with signals they can read (RLS decides), plus
  // "Website visitors", where they get their own pixel. Admins see every
  // configured vertical. A new vertical is just a new signal_sources row.
  const verticals = useMemo(() => {
    const rows = [...(overview.data ?? [])].filter((v) => mode === 'admin' || v.total > 0);
    if (mode === 'client' && !rows.some((v) => v.vertical === 'web_visitors')) {
      rows.push({ vertical: 'web_visitors', today: 0, d7: 0, d30: 0, total: 0, new: 0 });
    }
    return sortVerticals(rows);
  }, [overview.data, mode]);

  const [active, setActive] = useState<string>('');
  useEffect(() => {
    if (verticals.length && !verticals.some((v) => v.vertical === active)) setActive(verticals[0].vertical);
  }, [verticals, active]);

  return (
    <div className={cn('space-y-4', mode === 'client' && 'p-6')}>
      {mode === 'client' && (
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><Radar className="h-5 w-5" /> Signals</h2>
          <p className="text-sm text-muted-foreground">
            Companies and people showing in-market activity — FDA clearances, sales hiring, product launches and visits to your site.
          </p>
        </div>
      )}
      {mode === 'admin' && <AdminSourcesPanel />}

      {overview.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading signals…</div>
      ) : overview.error ? (
        <p className="text-sm text-destructive">Could not load signals: {(overview.error as Error).message}</p>
      ) : verticals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No signals yet.</p>
      ) : (
        <Tabs value={active} onValueChange={setActive} className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            {verticals.map((v) => (
              <TabsTrigger key={v.vertical} value={v.vertical} className="gap-2">
                {verticalLabel(v.vertical)}
                {v.new > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{v.new.toLocaleString()}</Badge>}
              </TabsTrigger>
            ))}
          </TabsList>
          {verticals.map((v) => (
            <TabsContent key={v.vertical} value={v.vertical} className="space-y-4">
              {active === v.vertical && <VerticalPanel counts={v} mode={mode} />}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'open', label: 'Open (not dismissed)' },
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'pushed', label: 'Pushed' },
];

function VerticalPanel({ counts, mode }: { counts: VerticalCount; mode: Mode }) {
  const { toast } = useToast();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<SignalRow | null>(null);
  const [draft, setDraft] = useState({ from: '', to: '', minScore: 'any', status: 'open', state: '', country: '', search: '' });
  const [applied, setApplied] = useState(draft);

  // Filters apply 350ms after the last change (typing in the text boxes).
  useEffect(() => {
    const t = setTimeout(() => { setApplied(draft); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [draft]);

  const filters: SignalFilters = {
    vertical: counts.vertical,
    from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : null,
    to: applied.to ? new Date(new Date(`${applied.to}T00:00:00`).getTime() + 86_400_000).toISOString() : null,
    minScore: applied.minScore === 'any' ? null : Number(applied.minScore),
    status: applied.status === 'open' ? null : (applied.status as SignalStatus),
    state: applied.state.trim() || null,
    country: applied.country.trim() || null,
    search: applied.search.trim() || null,
  };
  const feed = useSignalsFeed(filters, page);
  const setStatus = useSetSignalStatus();
  const rows = feed.data?.rows ?? [];
  const total = feed.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / SIGNALS_PAGE_SIZE));

  useEffect(() => setSelected(new Set()), [counts.vertical, page, applied]);

  const mark = (ids: string[], status: 'reviewed' | 'dismissed' | 'new') =>
    setStatus.mutate({ ids, status }, {
      onSuccess: (n) => {
        toast({ title: `${n} signal${n === 1 ? '' : 's'} marked ${status}` });
        setSelected(new Set());
        setDetail((d) => (d && ids.includes(d.id) ? { ...d, team_status: status } : d));
      },
      onError: (e) => toast({ title: 'Could not update status', description: (e as Error).message, variant: 'destructive' }),
    });

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const showPerson = rows.some((r) => r.person_name || r.person_title);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today" value={counts.today} />
        <Stat label="Last 7 days" value={counts.d7} />
        <Stat label="Last 30 days" value={counts.d30} />
        <Stat label="New for your team" value={counts.new} />
      </div>

      {mode === 'admin' && <VerticalSourcesAdmin vertical={counts.vertical} />}
      {counts.vertical === 'web_visitors' && <PixelSitesPanel mode={mode} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex flex-wrap items-center gap-2">
            {verticalLabel(counts.vertical)}
            <span className="text-xs font-normal text-muted-foreground">{feed.isFetching ? 'loading…' : `${total.toLocaleString()} matching`}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!selected.size || setStatus.isPending} onClick={() => mark([...selected], 'reviewed')}>
                Mark reviewed{selected.size ? ` (${selected.size})` : ''}
              </Button>
              <Button size="sm" variant="outline" disabled={!selected.size || setStatus.isPending} onClick={() => mark([...selected], 'dismissed')}>
                Dismiss{selected.size ? ` (${selected.size})` : ''}
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* span: a disabled button doesn't fire hover events */}
                    <span tabIndex={0}>
                      <Button size="sm" disabled className="gap-1"><Sparkles className="h-3.5 w-3.5" /> Build audience from these</Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon: turn signals into an Agent audience with contact enrichment.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardTitle>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-2 pt-2">
            <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label="From date" />
            <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="To date" />
            <Select value={draft.minScore} onValueChange={(v) => setDraft({ ...draft, minScore: v })}>
              <SelectTrigger aria-label="Minimum score"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any score</SelectItem>
                <SelectItem value="50">Score ≥ 50</SelectItem>
                <SelectItem value="75">Score ≥ 75</SelectItem>
                <SelectItem value="90">Score ≥ 90</SelectItem>
              </SelectContent>
            </Select>
            <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="State" value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
            <Input placeholder="Country" value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
            <Input placeholder="Search company, person, title…" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={allOnPage}
                      onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())}
                      aria-label="Select page"
                    />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Company</TableHead>
                  {showPerson && <TableHead>Person</TableHead>}
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                      {feed.isLoading ? 'Loading…' : 'No signals match these filters.'}
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id} className={cn('cursor-pointer', r.team_status === 'dismissed' && 'opacity-60')} onClick={() => setDetail(r)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(r.id); else n.delete(r.id); return n; })}
                        aria-label="Select signal"
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs" title={format(new Date(r.occurred_at), 'PPpp')}>
                      {format(new Date(r.occurred_at), 'MMM d, yyyy')}
                      <div className="text-muted-foreground">{formatDistanceToNowStrict(new Date(r.occurred_at), { addSuffix: true })}</div>
                    </TableCell>
                    <TableCell><ScoreBadge score={r.score} /></TableCell>
                    <TableCell className="max-w-[28rem]"><div className="line-clamp-2 text-sm">{r.title}</div></TableCell>
                    <TableCell className="text-sm">
                      {r.company_name ?? '—'}
                      {r.company_domain && <div className="text-xs text-muted-foreground">{r.company_domain}</div>}
                    </TableCell>
                    {showPerson && (
                      <TableCell className="text-sm">
                        {r.person_name ?? '—'}
                        {r.person_title && <div className="text-xs text-muted-foreground line-clamp-1">{r.person_title}</div>}
                      </TableCell>
                    )}
                    <TableCell className="text-xs">{locationOf(r) || '—'}</TableCell>
                    <TableCell><StatusBadge status={r.team_status} /></TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open evidence">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <SignalDetailSheet signal={detail} onClose={() => setDetail(null)} onMark={(status) => detail && mark([detail.id], status)} busy={setStatus.isPending} />
    </>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = scoreTone(score);
  return (
    <Badge
      variant="outline"
      className={cn('tabular-nums', tone === 'high' && 'border-primary text-primary', tone === 'low' && 'text-muted-foreground')}
    >
      {score}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: SignalStatus }) {
  const variant = status === 'new' ? 'default' : status === 'dismissed' ? 'outline' : 'secondary';
  return <Badge variant={variant} className="capitalize">{status}</Badge>;
}
