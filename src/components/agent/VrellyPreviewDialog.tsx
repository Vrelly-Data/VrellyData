import { useEffect, useState } from 'react';
import {
  Loader2, ChevronLeft, ChevronRight, Rocket, CheckCircle2, Info, ExternalLink, AlertTriangle,
} from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import type { VrellyAudienceFilters } from '@/lib/vrellyAudienceFilters';
import {
  useVrellyPreview, useRunAudience, useAudienceCampaigns, formatVrellyCount,
  type AgentAudience, type VrellyPreview, type VrellyPreviewPerson, type AudienceRunResult,
} from '@/hooks/useAgentAudiences';

const PER_PAGE = 25;

const fullName = (p: VrellyPreviewPerson) =>
  [p.first_name, p.last_name].filter(Boolean).join(' ') || '(no name)';

/**
 * Preview & run for a Vrelly-source audience.
 *
 * Unlike Apollo there is nothing to buy: every row is a complete record with a
 * work email, so there is no Reveal and no credit counter. Everyone a run
 * would skip (already pushed by this client, an existing lead, a synced
 * contact) is already excluded server-side, so every row here is pushable and
 * the count is "people a run could still add".
 *
 * Two ways to push:
 *   * tick people → push exactly those;
 *   * push next N → no selection: the first N matches in list order, which is
 *     precisely what the scheduled run does. That is also how an audience gets
 *     the successful run it needs before it can be armed.
 */
export function VrellyPreviewDialog(
  { audience, open, onOpenChange }:
  { audience: AgentAudience | null; open: boolean; onOpenChange: (v: boolean) => void },
) {
  const { toast } = useToast();
  const preview = useVrellyPreview();
  const runAudience = useRunAudience();

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<VrellyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
        filters: (audience.filters ?? {}) as VrellyAudienceFilters, page: p, per_page: PER_PAGE,
      });
      setResult(r);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  };

  // One effect, keyed on identity — see AudiencePreviewDialog for why a split
  // reset/load pair silently skips the second open.
  useEffect(() => {
    if (!open || !audience) return;
    setPage(1);
    setResult(null);
    setSelected(new Set());
    setRunResult(null);
    setPlatform(audience.default_platform);
    setCampaignId(audience.default_synced_campaign_id);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, audience?.id]);

  const allowance = audience
    ? Math.max(0, audience.max_total !== null && audience.max_total !== undefined
      ? Math.min(audience.max_per_run, audience.max_total - audience.total_pushed)
      : audience.max_per_run)
    : 0;
  const atCap = selected.size >= allowance;
  const people = result?.people ?? [];
  const allPageSelected = people.length > 0 && people.every((p) => selected.has(p.prospect_id));

  const toggle = (id: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) { if (next.size >= allowance) return prev; next.add(id); } else next.delete(id);
    return next;
  });
  const toggleAllOnPage = (on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const p of people) {
      if (on) { if (next.size >= allowance) break; next.add(p.prospect_id); } else next.delete(p.prospect_id);
    }
    return next;
  });

  const campaignName = campaigns.find((c) => c.id === campaignId)?.name ?? null;
  const destinationSet = !!platform && !!campaignId;
  const total = result?.pagination.total_entries ?? null;
  const nextN = Math.min(allowance, total ?? allowance);

  const doRun = async (mode: 'selected' | 'next') => {
    if (!audience || !platform || !campaignId) return;
    setConfirm(null);
    try {
      const r = await runAudience.mutateAsync({
        audience_id: audience.id, platform, synced_campaign_id: campaignId,
        ...(mode === 'selected' ? { person_ids: [...selected] } : {}),
      });
      setRunResult(r);
      setSelected(new Set());
      toast({
        title: r.pushed > 0 ? `Pushed ${r.pushed} contact${r.pushed === 1 ? '' : 's'}` : 'Run finished',
        description: r.note ?? `status: ${r.status ?? 'success'}`,
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
              Vrelly database — free, complete records, no credits. The push is irreversible: a pushed
              prospect is never offered to another audience.
            </DialogDescription>
          </DialogHeader>

          {runResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="font-medium">Run {runResult.status ?? 'complete'}</span>
                {runResult.run_id && <span className="text-xs text-muted-foreground">run {runResult.run_id.slice(0, 8)}</span>}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([
                  ['Matched', runResult.searched],
                  ['Pushed', runResult.pushed],
                  ['Duplicates', runResult.skipped_duplicate],
                  ['Failed', runResult.failed],
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
                    <SelectTrigger>
                      <SelectValue placeholder={platform ? 'Select a campaign' : 'Pick a platform first'} />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
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
              ) : people.length === 0 ? (
                <div className="border rounded-lg py-12 px-6 text-center text-muted-foreground">
                  <p className="font-medium">Nobody new matches</p>
                  <p className="text-sm mt-1">
                    Everyone matching these filters is already pushed, an existing lead, or a synced contact — or
                    nobody matches. Widen the filters to find more.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-base font-semibold">
                      {formatVrellyCount(result.pagination) ?? 'Count unavailable'}
                    </p>
                    <span className={`text-sm ${atCap ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                      {selected.size} / {allowance} selected
                    </span>
                  </div>
                  {result.pagination.total_is_estimate && (
                    <p className="text-xs text-muted-foreground">
                      Approximate: the keyword share is measured on a sample of the matches.
                    </p>
                  )}

                  <div className="border rounded-lg overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox checked={allPageSelected} onCheckedChange={(v) => toggleAllOnPage(!!v)} />
                          </TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Email</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {people.map((p) => {
                          const isSel = selected.has(p.prospect_id);
                          return (
                            <TableRow key={p.prospect_id}>
                              <TableCell>
                                <Checkbox
                                  checked={isSel}
                                  disabled={!isSel && atCap}
                                  onCheckedChange={(v) => toggle(p.prospect_id, !!v)}
                                />
                              </TableCell>
                              <TableCell className="font-medium whitespace-nowrap">
                                {fullName(p)}
                                {p.linkedin_url && (
                                  <a
                                    href={p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`}
                                    target="_blank" rel="noreferrer noopener"
                                    className="ml-1.5 inline-flex items-center text-blue-600 hover:underline text-xs font-normal"
                                  >
                                    in <ExternalLink className="h-3 w-3 ml-0.5" />
                                  </a>
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {p.title ?? '—'}
                                {p.seniority && <span className="block text-xs">{p.seniority}</span>}
                              </TableCell>
                              <TableCell className="text-sm">
                                {p.company_name ?? '—'}
                                <span className="block text-xs text-muted-foreground">
                                  {[p.company_industry, p.company_size ? `${p.company_size} staff` : null].filter(Boolean).join(' · ')}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {[p.city, p.state, p.country].filter(Boolean).join(', ') || '—'}
                              </TableCell>
                              <TableCell className="text-sm break-all">{p.email}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
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
                      <Button
                        variant="outline" size="sm"
                        disabled={people.length < PER_PAGE || preview.isPending}
                        onClick={() => void load(page + 1)}
                      >
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
                disabled={!destinationSet || people.length === 0 || allowance === 0 || runAudience.isPending}
                onClick={() => setConfirm('next')}
                title="Exactly what the scheduled run does: the first matches in list order"
              >
                Push next {nextN}
              </Button>
              <Button
                disabled={!destinationSet || selected.size === 0 || runAudience.isPending}
                onClick={() => setConfirm('selected')}
              >
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
              Enrol {confirm === 'selected' ? selected.size : nextN} contact{(confirm === 'selected' ? selected.size : nextN) === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {confirm === 'next'
                    ? 'Takes the first matches in list order — exactly what the scheduled run does — and enrols them into '
                    : 'Enrols the people you ticked into '}
                  <span className="font-medium">{campaignName ?? 'the selected campaign'}</span>
                  {platform ? ` on ${platform}` : ''}. No credits are spent.
                </p>
                <p>
                  This cannot be undone. Dedup is client-wide, so a pushed prospect is never offered to another
                  audience, whether or not they are ever contacted.
                </p>
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
