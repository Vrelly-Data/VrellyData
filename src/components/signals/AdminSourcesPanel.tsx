import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Play, XCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { type SignalSource, type TeamSignalSettings, VISIBILITY_LABEL } from '@/lib/signals';
import { COUNTRY_OPTIONS, MARKETS, marketLabel, signalTypeLabel } from '@/lib/signalCatalog';
import {
  useRunSourceNow, useSetTeamSignalSettings, useSignalRuns, useSignalSources, useSourceStats, useTeamSignalSettings,
} from '@/hooks/useSignals';
import { SourceConfigEditor } from './SourceConfigEditor';

const DISPATCH_NOTE =
  "Dispatcher: pg_cron 'dispatch-signal-sources' every hour at :05 UTC. A daily source runs once it is a full day past its last run, counted in whole hours.";

function StatusIcon({ status }: { status: string | null }) {
  if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-primary" aria-label="success" />;
  if (status === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="partial" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" aria-label="failed" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin" aria-label="running" />;
  return <Clock className="h-4 w-4 text-muted-foreground" aria-label="never run" />;
}

const ago = (iso: string | null) => (iso ? formatDistanceToNowStrict(new Date(iso), { addSuffix: true }) : 'never');

/** Admin only: health strip (one card per source) + the run log. */
export function AdminSourcesPanel() {
  const { toast } = useToast();
  const sources = useSignalSources();
  const stats = useSourceStats();
  const runNow = useRunSourceNow();
  const [logSource, setLogSource] = useState<string>('all');
  const runs = useSignalRuns(logSource === 'all' ? null : logSource);
  const statsBy = Object.fromEntries((stats.data ?? []).map((s) => [s.source_key, s]));

  const run = (s: SignalSource) =>
    runNow.mutate(s.key, {
      onSuccess: (d) => {
        const r = d?.ran?.[0];
        toast({ title: `${s.name}: ${r?.status ?? 'done'}`, description: r?.error ?? `${r?.inserted ?? 0} new signals` });
      },
      onError: (e) => toast({ title: `${s.name} failed to start`, description: (e as Error).message, variant: 'destructive' }),
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Source health</CardTitle>
          <p className="text-xs text-muted-foreground">{DISPATCH_NOTE}</p>
        </CardHeader>
        <CardContent>
          {sources.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              {(sources.data ?? []).map((s) => {
                const st = statsBy[s.key];
                return (
                  <div key={s.key} className={cn('rounded-md border p-3 space-y-1.5', !s.is_active && 'opacity-60')}>
                    <div className="flex items-center gap-2">
                      <StatusIcon status={s.last_run_status} />
                      <span className="font-medium text-sm truncate" title={s.name}>{s.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">{signalTypeLabel(s.signal_type)}</Badge>
                      {(s.default_markets ?? []).map((m) => (
                        <Badge key={m} variant="outline" className="text-[10px]">{marketLabel(m)}</Badge>
                      ))}
                      <Badge variant="outline" className="text-[10px]">{s.cadence}</Badge>
                      <Badge variant="outline" className="text-[10px]">{VISIBILITY_LABEL[s.default_visibility]}</Badge>
                      {!s.is_active && <Badge variant="secondary" className="text-[10px]">paused</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground" title={s.last_run_at ?? ''}>
                      Last run {ago(s.last_run_at)} · {s.items_last_run ?? 0} new
                    </p>
                    <p className="text-xs">
                      <span className="font-semibold tabular-nums">{(st?.total ?? 0).toLocaleString()}</span>
                      <span className="text-muted-foreground"> signals · {(st?.d7 ?? 0).toLocaleString()} in 7d</span>
                    </p>
                    {s.last_error && <p className="text-xs text-destructive line-clamp-2" title={s.last_error}>{s.last_error}</p>}
                    <Button size="sm" variant="outline" className="h-7 gap-1 w-full" disabled={runNow.isPending || !s.is_active} onClick={() => run(s)}>
                      {runNow.isPending && runNow.variables === s.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Run now
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Run log
            <Select value={logSource} onValueChange={setLogSource}>
              <SelectTrigger className="ml-auto h-8 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {(sources.data ?? []).map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Fetched</TableHead>
                  <TableHead className="text-right">Inserted</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                  <TableHead className="text-right">Deduped</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-6">No runs yet.</TableCell></TableRow>
                )}
                {(runs.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">{format(new Date(r.started_at), 'MMM d HH:mm:ss')}</TableCell>
                    <TableCell className="text-xs">{r.source_key}</TableCell>
                    <TableCell className="text-xs">{r.triggered_by.startsWith('admin:') ? 'admin' : r.triggered_by}</TableCell>
                    <TableCell><span className="flex items-center gap-1 text-xs"><StatusIcon status={r.status} /> {r.status}</span></TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{r.fetched.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{r.inserted.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{r.updated.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{r.deduped.toLocaleString()}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.finished_at ? `${((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000).toFixed(1)}s` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-destructive max-w-xs"><span className="line-clamp-2" title={r.error ?? ''}>{r.error}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Admin only, inside a type tab: config / watchlist editors for that type's sources. */
export function TypeSourcesAdmin({ type }: { type: string }) {
  const sources = useSignalSources();
  const internal = type === 'high_intent' ? 'positive_response' : type;
  const mine = (sources.data ?? []).filter((s) => s.signal_type === internal);
  if (!mine.length) return null;
  return (
    <div className="space-y-3">
      {mine.map((s) => <SourceConfigEditor key={s.key} source={s} />)}
    </div>
  );
}

/**
 * Admin only: per-team Signals settings. Default market drives the market of
 * the team's own signals (High Intent, website visits) when the company's
 * industry does not; country is the team's default Country filter; Apollo
 * enrichment lets High Intent enrichment spend that team's Apollo credits
 * (counted against its monthly cap) after the free sources.
 */
export function TeamSettingsPanel() {
  const { toast } = useToast();
  const teams = useTeamSignalSettings();
  const save = useSetTeamSignalSettings();
  const [open, setOpen] = useState(false);
  const update = (t: TeamSignalSettings, patch: Partial<TeamSignalSettings>) => {
    const n = { ...t, ...patch };
    save.mutate(
      { teamId: t.team_id, defaultMarket: n.default_market, country: n.country, apolloEnrich: n.apollo_enrich },
      {
        onSuccess: () => toast({ title: `${t.name}: saved` }),
        onError: (e) => toast({ title: 'Could not save', description: (e as Error).message, variant: 'destructive' }),
      },
    );
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          Team settings
          <span className="text-xs font-normal text-muted-foreground">default market, country filter, Apollo enrichment for High Intent</span>
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</Button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent>
          {teams.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead>Default market</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Apollo enrichment (paid)</TableHead>
                    <TableHead className="text-right">High Intent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(teams.data ?? []).map((t) => (
                    <TableRow key={t.team_id}>
                      <TableCell className="text-sm">{t.name}</TableCell>
                      <TableCell>
                        <Select value={t.default_market ?? 'none'} onValueChange={(v) => update(t, { default_market: v === 'none' ? null : v })}>
                          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">From industry</SelectItem>
                            {MARKETS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={t.country ?? 'US'} onValueChange={(v) => update(t, { country: v })}>
                          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {COUNTRY_OPTIONS.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Switch checked={t.apollo_enrich} disabled={save.isPending} onCheckedChange={(v) => update(t, { apollo_enrich: v })}
                          aria-label={`Apollo enrichment for ${t.name}`} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{t.high_intent.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
