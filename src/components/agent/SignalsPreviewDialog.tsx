import { useEffect, useState } from 'react';
import {
  Loader2, ChevronLeft, ChevronRight, Rocket, CheckCircle2, Info, ExternalLink, AlertTriangle, Coins,
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { verticalLabel } from '@/lib/signals';
import { PERSON_SOURCE_LABEL, type SignalAudienceFilters } from '@/lib/signalAudienceFilters';
import {
  useSignalAudiencePreview, useRunAudience, useAudienceCampaigns, signalPersonKey, APOLLO_STATUS_TEXT,
  type AgentAudience, type SignalPreview, type SignalPreviewPerson, type AudienceRunResult,
} from '@/hooks/useAgentAudiences';

const PER_PAGE = 10;

const SOURCE_TONE: Record<SignalPreviewPerson['source'], string> = {
  vrelly: 'border-emerald-500 text-emerald-700 dark:text-emerald-400',
  signal: 'border-sky-500 text-sky-700 dark:text-sky-400',
  apollo: 'border-amber-500 text-amber-700 dark:text-amber-400',
};

const nameOf = (p: SignalPreviewPerson) => [p.first_name, p.last_name].filter(Boolean).join(' ') || '(no name)';

/**
 * Preview & run for a Signals-source audience: each signal, its company, and
 * the people a run would push there, with where each came from — Vrelly (free),
 * the signal itself (free) or Apollo (paid, enriched only when pushed). The
 * credit figure is the most a run of this page could spend; nothing is spent by
 * the preview.
 *
 * `signalIds` restricts the preview and the run to signals picked in
 * Agent → Signals / Admin → Signals ("Build audience from these").
 *
 * Pushing:
 *   * tick people → push exactly those (the server re-resolves and only pushes
 *     people it finds itself);
 *   * push next N → no selection: what the scheduled run does — best signals
 *     first, whole companies, up to max per run.
 */
export function SignalsPreviewDialog(
  { audience, open, onOpenChange, signalIds = null }:
  { audience: AgentAudience | null; open: boolean; onOpenChange: (v: boolean) => void; signalIds?: string[] | null },
) {
  const { toast } = useToast();
  const preview = useSignalAudiencePreview();
  const runAudience = useRunAudience();

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SignalPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // person_key -> signal_id
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [platform, setPlatform] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'selected' | 'next' | null>(null);
  const [runResult, setRunResult] = useState<AudienceRunResult | null>(null);
  const { data: campaigns = [] } = useAudienceCampaigns(platform ?? undefined);

  const load = async (p: number) => {
    if (!audience) return;
    setError(null);
    try {
      const r = await preview.mutateAsync({
        filters: (audience.filters ?? {}) as SignalAudienceFilters, page: p, per_page: PER_PAGE,
        signal_ids: signalIds, audience_id: audience.id,
      });
      setResult(r);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  };

  useEffect(() => {
    if (!open || !audience) return;
    setPage(1);
    setResult(null);
    setSelected(new Map());
    setRunResult(null);
    setPlatform(audience.default_platform);
    setCampaignId(audience.default_synced_campaign_id);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, audience?.id, (signalIds ?? []).join(',')]);

  const allowance = audience
    ? Math.max(0, audience.max_total !== null && audience.max_total !== undefined
      ? Math.min(audience.max_per_run, audience.max_total - audience.total_pushed)
      : audience.max_per_run)
    : 0;
  const atCap = selected.size >= allowance;
  const rows = result?.signals ?? [];
  const peopleOnPage = rows.reduce((n, r) => n + r.people.length, 0);
  const selectedPending = [...selected.keys()].filter((k) => k.startsWith('a:')).length;

  const toggle = (key: string, signalId: string, on: boolean) => setSelected((prev) => {
    const next = new Map(prev);
    if (on) { if (next.size >= allowance) return prev; next.set(key, signalId); } else next.delete(key);
    return next;
  });

  const campaignName = campaigns.find((c) => c.id === campaignId)?.name ?? null;
  const destinationSet = !!platform && !!campaignId;
  const budget = result?.apollo_budget ?? null;
  const est = result?.estimated_credits ?? 0;
  const overBudget = budget?.remaining !== null && budget?.remaining !== undefined && est > budget.remaining;

  const doRun = async (mode: 'selected' | 'next') => {
    if (!audience || !platform || !campaignId) return;
    setConfirm(null);
    try {
      const r = await runAudience.mutateAsync({
        audience_id: audience.id, platform, synced_campaign_id: campaignId,
        ...(mode === 'selected'
          ? { selections: [...selected.entries()].map(([person_key, signal_id]) => ({ signal_id, person_key })) }
          : signalIds ? { signal_ids: signalIds } : {}),
      });
      setRunResult(r);
      setSelected(new Map());
      toast({
        title: r.pushed > 0 ? `Pushed ${r.pushed} contact${r.pushed === 1 ? '' : 's'}` : 'Run finished',
        description: r.note ?? `status: ${r.status ?? 'success'}${r.credits_spent ? ` · ${r.credits_spent} Apollo credits` : ''}`,
      });
    } catch (e) {
      toast({ title: 'Run failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview &amp; run{audience ? ` — ${audience.name.trim()}` : ''}</DialogTitle>
            <DialogDescription>
              Signals → company → people. Vrelly and signal contacts are free; Apollo contacts cost up to one credit
              each when pushed. The push is irreversible.
              {signalIds?.length ? ` Limited to the ${signalIds.length} signal${signalIds.length === 1 ? '' : 's'} you picked.` : ''}
            </DialogDescription>
          </DialogHeader>

          {runResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="font-medium">Run {runResult.status ?? 'complete'}</span>
                {runResult.run_id && <span className="text-xs text-muted-foreground">run {runResult.run_id.slice(0, 8)}</span>}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {([
                  ['People', runResult.searched],
                  ['Pushed', runResult.pushed],
                  ['Duplicates', runResult.skipped_duplicate],
                  ['Failed', runResult.failed],
                  ['Apollo credits', runResult.credits_spent],
                ] as const).map(([label, value]) => (
                  <div key={label} className="border rounded-md p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              {runResult.note && (
                <p className="text-sm text-muted-foreground flex items-center gap-2"><Info className="h-4 w-4" />{runResult.note}</p>
              )}
              {runResult.status === 'success' && (
                <p className="text-sm text-emerald-700">This audience now has a successful run, so it can be armed for scheduled runs.</p>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setRunResult(null); void load(1); }}>Preview again</Button>
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Push to platform</Label>
                  <Select value={platform ?? ''} onValueChange={(v) => { setPlatform(v); setCampaignId(null); }}>
                    <SelectTrigger><SelectValue placeholder="Choose a platform" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reply.io">Reply.io</SelectItem>
                      <SelectItem value="smartlead">Smartlead</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Campaign</Label>
                  <Select value={campaignId ?? ''} onValueChange={setCampaignId} disabled={!platform}>
                    <SelectTrigger><SelectValue placeholder={platform ? 'Select a campaign' : 'Pick a platform first'} /></SelectTrigger>
                    <SelectContent>{campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              {preview.isPending && !result ? (
                <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : error ? (
                <div className="border rounded-lg py-10 px-6 text-center">
                  <p className="text-sm text-destructive flex items-center justify-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => void load(page)}>Try again</Button>
                </div>
              ) : !result ? (
                <div className="border rounded-lg py-12 text-center text-muted-foreground text-sm">No preview yet.</div>
              ) : rows.length === 0 ? (
                <div className="border rounded-lg py-12 px-6 text-center text-muted-foreground">
                  <p className="font-medium">No signals to use</p>
                  <p className="text-sm mt-1">
                    No matching signals this audience hasn&rsquo;t used yet. Widen the signal types, the date window or the
                    minimum score.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-semibold">
                      {result.pagination.total_entries !== null
                        ? `${result.pagination.total_entries.toLocaleString()} signal${result.pagination.total_entries === 1 ? '' : 's'}`
                        : 'Signals'}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        this page: {result.people_by_source.vrelly} Vrelly · {result.people_by_source.signal} signal · {result.people_by_source.apollo} Apollo
                      </span>
                    </p>
                    <span className={cn('text-sm', atCap ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
                      {selected.size} / {allowance} selected
                    </span>
                  </div>

                  <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', overBudget && 'border-amber-500')}>
                    <Coins className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Estimated Apollo credits for this page: <span className="font-medium">{est}</span>
                      {budget
                        ? budget.key_source === 'client'
                          ? ' · your own Apollo key (not capped here)'
                          : ` · ${budget.remaining ?? 0} of ${budget.cap ?? 0} left this month`
                        : result.apollo_enabled ? '' : ' · Apollo fallback off'}
                    </span>
                    {overBudget && <span className="text-amber-700 dark:text-amber-400">— a run stops at the cap</span>}
                  </div>

                  <div className="space-y-3">
                    {rows.map((r) => (
                      <div key={r.signal.id} className="border rounded-lg">
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2 bg-muted/30">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{r.signal.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {verticalLabel(r.signal.vertical)} · {format(new Date(r.signal.occurred_at), 'MMM d, yyyy')} · score {r.signal.score}
                              {' · '}{r.signal.company_name ?? '—'}
                              {r.domain && <> · {r.domain}{r.derived_domain && r.domain === r.derived_domain ? ' (matched by name)' : ''}</>}
                            </p>
                          </div>
                          {r.signal.url && (
                            <a href={r.signal.url} target="_blank" rel="noreferrer noopener" className="text-xs text-blue-600 hover:underline inline-flex items-center">
                              source <ExternalLink className="h-3 w-3 ml-0.5" />
                            </a>
                          )}
                        </div>
                        {r.people.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">
                            {APOLLO_STATUS_TEXT[r.apollo] || 'Nobody matching found'}
                            {r.apollo_error ? ` (${r.apollo_error})` : ''}
                          </p>
                        ) : (
                          <ul className="divide-y">
                            {r.people.map((p) => {
                              const key = signalPersonKey(p);
                              const isSel = !!key && selected.has(key);
                              return (
                                <li key={key ?? nameOf(p)} className="flex items-center gap-3 px-3 py-2 text-sm">
                                  <Checkbox
                                    checked={isSel}
                                    disabled={!key || (!isSel && atCap)}
                                    onCheckedChange={(v) => key && toggle(key, r.signal.id, !!v)}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span className="font-medium">{nameOf(p)}</span>
                                    {p.linkedin_url && (
                                      <a href={p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`}
                                        target="_blank" rel="noreferrer noopener"
                                        className="ml-1.5 inline-flex items-center text-blue-600 hover:underline text-xs">
                                        in <ExternalLink className="h-3 w-3 ml-0.5" />
                                      </a>
                                    )}
                                    <span className="block text-xs text-muted-foreground truncate">
                                      {p.title ?? '—'}{p.company_name ? ` · ${p.company_name}` : ''}
                                      {[p.city, p.state].filter(Boolean).length ? ` · ${[p.city, p.state].filter(Boolean).join(', ')}` : ''}
                                    </span>
                                  </div>
                                  <span className="text-xs text-muted-foreground break-all max-w-[14rem]">
                                    {p.email ?? 'email on push'}
                                  </span>
                                  <Badge variant="outline" className={cn('shrink-0', SOURCE_TONE[p.source])}>
                                    {PERSON_SOURCE_LABEL[p.source]}{p.pending ? ' · 1 credit' : p.cached ? ' · cached' : ''}
                                  </Badge>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-muted-foreground">{result.notice}</p>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Page {page}{result.pagination.total_pages ? ` of ${result.pagination.total_pages.toLocaleString()}` : ''}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1 || preview.isPending} onClick={() => void load(page - 1)}>
                        <ChevronLeft className="h-4 w-4" /> Prev
                      </Button>
                      <Button variant="outline" size="sm"
                        disabled={rows.length < PER_PAGE || preview.isPending} onClick={() => void load(page + 1)}>
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {!runResult && (
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                variant="outline"
                disabled={!destinationSet || peopleOnPage === 0 || allowance === 0 || runAudience.isPending}
                onClick={() => setConfirm('next')}
                title="What the scheduled run does: best signals first, whole companies, up to max per run"
              >
                Push next {allowance}
              </Button>
              <Button disabled={!destinationSet || selected.size === 0 || runAudience.isPending} onClick={() => setConfirm('selected')}>
                {runAudience.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
                Push {selected.size > 0 ? selected.size : ''} selected
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm !== null} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'selected'
                ? `Enrol ${selected.size} contact${selected.size === 1 ? '' : 's'}?`
                : `Enrol up to ${allowance} contacts?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {confirm === 'next'
                    ? 'Takes the best signals first, whole companies at a time — exactly what the scheduled run does — and enrols them into '
                    : 'Enrols the people you ticked into '}
                  <span className="font-medium">{campaignName ?? 'the selected campaign'}</span>
                  {platform ? ` on ${platform}` : ''}, with the signal (type, title, date, link) as custom fields.
                </p>
                <p>
                  {confirm === 'selected'
                    ? selectedPending > 0
                      ? `${selectedPending} of them come from Apollo and cost up to one credit each.`
                      : 'No Apollo credits are spent.'
                    : 'Companies with nobody in Vrelly may be enriched on Apollo, up to your monthly cap.'}
                </p>
                <p>This cannot be undone. Dedup is client-wide, so a pushed person is never offered to another audience.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void doRun(confirm)}>Push</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
