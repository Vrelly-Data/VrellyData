import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Radar, Sparkles, X } from 'lucide-react';
import { format, formatDistanceToNowStrict, subDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  type SignalFilters, type SignalRow, type SignalStatus, type TypeCount, locationOf, scoreTone,
} from '@/lib/signals';
import { COUNTRY_OPTIONS, MARKETS, SIGNAL_TYPES, type SignalTypeInfo, marketLabel } from '@/lib/signalCatalog';
import {
  SIGNALS_PAGE_SIZE, useSetSignalStatus, useSignalSettings, useSignalsBreakdown, useSignalsFeed, useSignalsOverview,
} from '@/hooks/useSignals';
import { SignalDetailSheet } from './SignalDetailSheet';
import { AdminSourcesPanel, TeamSettingsPanel, TypeSourcesAdmin } from './AdminSourcesPanel';
import { PixelSitesPanel } from './PixelSitesPanel';
import { SignalInputsPanel } from './SignalInputsPanel';
import { BuildAudienceDialog } from './BuildAudienceDialog';
import { BreakdownPanel, type BreakdownKey } from './BreakdownPanel';

type Mode = 'admin' | 'client';

/** Shared across tabs: which markets and which country. */
interface Scope {
  markets: string[];
  country: string; // ISO alpha-2 or 'all'
  includeUnknown: boolean;
}

const ZERO = (type: string): TypeCount => ({ type, today: 0, d7: 0, d30: 0, total: 0, new: 0 });

export function SignalsView({ mode }: { mode: Mode }) {
  const settings = useSignalSettings();
  const [scope, setScope] = useState<Scope | null>(null);
  // The Country filter starts at the team's preference (US unless set otherwise).
  useEffect(() => {
    if (!scope && (settings.data || settings.isError)) {
      setScope({ markets: [], country: settings.data?.country || 'US', includeUnknown: true });
    }
  }, [settings.data, settings.isError, scope]);

  const scopeFilters = scope
    ? { markets: scope.markets, country: scope.country === 'all' ? null : scope.country, include_unknown_country: scope.includeUnknown }
    : {};
  const overview = useSignalsOverview(scopeFilters, !!scope);
  const counts = useMemo(() => new Map((overview.data ?? []).map((c) => [c.type, c])), [overview.data]);

  const [active, setActive] = useState<string>('');
  useEffect(() => {
    if (active || !overview.data) return;
    const first = SIGNAL_TYPES.find((t) => !t.comingSoon && (counts.get(t.key)?.d30 ?? 0) > 0);
    setActive(first?.key ?? 'high_intent');
  }, [overview.data, counts, active]);

  const toggleMarket = (m: string | null) =>
    setScope((s) => s && {
      ...s,
      markets: m === null ? [] : s.markets.includes(m) ? s.markets.filter((x) => x !== m) : [...s.markets, m],
    });

  return (
    <div className={cn('space-y-4', mode === 'client' && 'p-6')}>
      {mode === 'client' && (
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><Radar className="h-5 w-5" /> Signals</h2>
          <p className="text-sm text-muted-foreground">
            Companies and people showing in-market activity — high intent, FDA clearances, hiring, product launches and visits to your site.
          </p>
        </div>
      )}
      {mode === 'admin' && <AdminSourcesPanel />}
      {mode === 'admin' && <TeamSettingsPanel />}

      {!scope || (overview.isLoading && !overview.data) ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading signals…</div>
      ) : overview.error ? (
        <p className="text-sm text-destructive">Could not load signals: {(overview.error as Error).message}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Market">
            <span className="text-xs text-muted-foreground mr-1">Market</span>
            <MarketChip label="All" active={scope.markets.length === 0} onClick={() => toggleMarket(null)} />
            {MARKETS.map((m) => (
              <MarketChip key={m.key} label={m.label} active={scope.markets.includes(m.key)} onClick={() => toggleMarket(m.key)} />
            ))}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Country</span>
              <Select value={scope.country} onValueChange={(v) => setScope({ ...scope, country: v })}>
                <SelectTrigger className="h-8 w-44" aria-label="Country"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All countries</SelectItem>
                  {COUNTRY_OPTIONS.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {scope.country !== 'all' && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox checked={scope.includeUnknown} onCheckedChange={(c) => setScope({ ...scope, includeUnknown: !!c })} />
                  incl. unknown
                </label>
              )}
            </div>
          </div>

          <Tabs value={active} onValueChange={setActive} className="space-y-4">
            <TabsList className="flex-wrap h-auto">
              {SIGNAL_TYPES.map((t) => {
                const c = counts.get(t.key);
                return (
                  <TabsTrigger key={t.key} value={t.key} className={cn('gap-2', t.comingSoon && 'opacity-50')} title={t.description}>
                    {t.label}
                    {!t.comingSoon && (
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums" title="Last 30 days">
                        {(c?.d30 ?? 0).toLocaleString()}
                      </Badge>
                    )}
                  </TabsTrigger>
                );
              })}
              <TabsTrigger value="signal_inputs" className="gap-2" title="Choose what Vrelly watches for: hiring, GitHub, medical/FDA, your website">
                Signal Inputs
              </TabsTrigger>
            </TabsList>
            {SIGNAL_TYPES.map((t) => (
              <TabsContent key={t.key} value={t.key} className="space-y-4">
                {active === t.key && (t.comingSoon
                  ? <ComingSoon info={t} />
                  : <TypePanel info={t} counts={counts.get(t.key) ?? ZERO(t.key)} mode={mode} scope={scope} />)}
              </TabsContent>
            ))}
            <TabsContent value="signal_inputs" className="space-y-4">
              {active === 'signal_inputs' && <SignalInputsPanel mode={mode} />}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function MarketChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

function ComingSoon({ info }: { info: SignalTypeInfo }) {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-1">
        <p className="font-medium">{info.label.replace(' (coming soon)', '')} — coming soon</p>
        <p className="text-sm text-muted-foreground">{info.description}</p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
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

const BREAKDOWN_FILTER_KEY: Record<BreakdownKey, keyof SignalFilters> = {
  industry: 'industry', seniority: 'seniority', title: 'title', state: 'breakdown_state', country: 'breakdown_country',
  company_size: 'company_size', platform: 'platform', campaign: 'campaign',
};
const BREAKDOWN_LABEL: Record<BreakdownKey, string> = {
  industry: 'Industry', seniority: 'Seniority', title: 'Title', state: 'State', country: 'Country',
  company_size: 'Company size', platform: 'Platform', campaign: 'Campaign',
};

const thirtyDaysAgo = () => format(subDays(new Date(), 30), 'yyyy-MM-dd');

function TypePanel({ info, counts, mode, scope }: { info: SignalTypeInfo; counts: TypeCount; mode: Mode; scope: Scope }) {
  const { toast } = useToast();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<SignalRow | null>(null);
  const [building, setBuilding] = useState(false);
  // Default window: the last 30 days (matches the tab counts).
  const [draft, setDraft] = useState({ from: thirtyDaysAgo(), to: '', minScore: 'any', status: 'open', state: '', search: '' });
  const [applied, setApplied] = useState(draft);
  const [picked, setPicked] = useState<Partial<Record<BreakdownKey, string>>>({});

  // Filters apply 350ms after the last change (typing in the text boxes).
  useEffect(() => {
    const t = setTimeout(() => { setApplied(draft); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [draft]);

  const base: SignalFilters = {
    type: info.key,
    markets: scope.markets,
    country: scope.country === 'all' ? null : scope.country,
    include_unknown_country: scope.includeUnknown,
    from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : null,
    to: applied.to ? new Date(new Date(`${applied.to}T00:00:00`).getTime() + 86_400_000).toISOString() : null,
    min_score: applied.minScore === 'any' ? null : Number(applied.minScore),
    status: applied.status === 'open' ? null : (applied.status as SignalStatus),
    state: applied.state.trim() || null,
    search: applied.search.trim() || null,
  };
  const filters: SignalFilters = {
    ...base,
    ...Object.fromEntries(Object.entries(picked).map(([k, v]) => [BREAKDOWN_FILTER_KEY[k as BreakdownKey], v])),
  };
  const feed = useSignalsFeed(filters, page);
  const isHighIntent = info.key === 'high_intent';
  const breakdown = useSignalsBreakdown(filters, isHighIntent);
  const setStatus = useSetSignalStatus();
  const rows = feed.data?.rows ?? [];
  const total = feed.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / SIGNALS_PAGE_SIZE));

  useEffect(() => setSelected(new Set()), [info.key, page, applied, picked, scope]);
  useEffect(() => setPage(0), [picked, scope]);

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
  const showIndustry = rows.some((r) => r.industry);
  const showTeam = mode === 'admin' && rows.some((r) => r.team_name);

  return (
    <>
      <p className="text-sm text-muted-foreground -mt-1">{info.description}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today" value={counts.today} />
        <Stat label="Last 7 days" value={counts.d7} />
        <Stat label="Last 30 days" value={counts.d30} />
        <Stat label="New for your team" value={counts.new} />
      </div>

      {mode === 'admin' && <TypeSourcesAdmin type={info.key} />}
      {info.key === 'website_visit' && <PixelSitesPanel mode={mode} />}

      {isHighIntent && (
        <BreakdownPanel
          data={breakdown.data ?? null}
          loading={breakdown.isLoading}
          selected={picked}
          onPick={(k, v) => setPicked((p) => (p[k] === v ? Object.fromEntries(Object.entries(p).filter(([x]) => x !== k)) : { ...p, [k]: v }))}
          admin={mode === 'admin'}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex flex-wrap items-center gap-2">
            {info.label}
            <span className="text-xs font-normal text-muted-foreground">{feed.isFetching ? 'loading…' : `${total.toLocaleString()} matching`}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!selected.size || setStatus.isPending} onClick={() => mark([...selected], 'reviewed')}>
                Mark reviewed{selected.size ? ` (${selected.size})` : ''}
              </Button>
              <Button size="sm" variant="outline" disabled={!selected.size || setStatus.isPending} onClick={() => mark([...selected], 'dismissed')}>
                Dismiss{selected.size ? ` (${selected.size})` : ''}
              </Button>
              <Button size="sm" className="gap-1" disabled={!selected.size} onClick={() => setBuilding(true)}>
                <Sparkles className="h-3.5 w-3.5" /> Build audience from these{selected.size ? ` (${selected.size})` : ''}
              </Button>
            </div>
          </CardTitle>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pt-2">
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
            <Input placeholder="Search company, person, title…" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} />
          </div>
          {Object.keys(picked).length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {(Object.entries(picked) as Array<[BreakdownKey, string]>).map(([k, v]) => (
                <Badge key={k} variant="secondary" className="gap-1">
                  {BREAKDOWN_LABEL[k]}: {v}
                  <button type="button" aria-label={`Clear ${BREAKDOWN_LABEL[k]}`} onClick={() => setPicked((p) => Object.fromEntries(Object.entries(p).filter(([x]) => x !== k)))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
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
                  {showIndustry && <TableHead>Industry</TableHead>}
                  <TableHead>Location</TableHead>
                  {showTeam && <TableHead>Team</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
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
                    <TableCell className="max-w-[28rem]">
                      <div className="line-clamp-2 text-sm">{r.title}</div>
                      {r.markets?.length > 0 && (
                        <div className="text-[11px] text-muted-foreground">{r.markets.map(marketLabel).join(' · ')}</div>
                      )}
                    </TableCell>
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
                    {showIndustry && (
                      <TableCell className="text-xs">
                        {r.industry ?? '—'}
                        {r.company_size && <div className="text-muted-foreground">{r.company_size}</div>}
                      </TableCell>
                    )}
                    <TableCell className="text-xs">{locationOf(r) || '—'}</TableCell>
                    {showTeam && <TableCell className="text-xs">{r.team_name ?? (r.visibility === 'admin' ? 'Admin only' : '—')}</TableCell>}
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

      <SignalDetailSheet
        signal={detail} onClose={() => setDetail(null)} onMark={(status) => detail && mark([detail.id], status)}
        busy={setStatus.isPending} admin={mode === 'admin'}
      />
      <BuildAudienceDialog open={building} onOpenChange={setBuilding} signals={rows.filter((r) => selected.has(r.id))} />
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
