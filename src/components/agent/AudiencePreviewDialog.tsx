import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertTriangle, ChevronLeft, ChevronRight, Rocket, CheckCircle2, Info,
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  usePreviewAudience, useRunAudience, useAlreadyPushed, useAudienceCampaigns,
  type AgentAudience, type ApolloPreviewPerson, type AudiencePreview,
  type AudienceRunResult,
} from '@/hooks/useAgentAudiences';

const PER_PAGE = 25;

function personName(p: ApolloPreviewPerson) {
  const parts = [p.first_name, p.last_name_obfuscated].filter(Boolean);
  return parts.length ? parts.join(' ') : '(no name)';
}

/**
 * Preview an audience, tick who to enrol, push.
 *
 * WHY A PREVIEW STEP AT ALL. The two costly things this feature does are
 * irreversible in different ways: enrichment spends real Apollo credits, and a
 * push burns the prospect permanently because dedup is client-wide — pushed
 * once, never offered to any future audience, contacted or not. Search is free
 * and reveals nothing, so it is the only safe place to decide.
 *
 * WHAT THE SERVER STILL OWNS. Everything that matters is re-checked in
 * run-agent-audience: the live campaign preflight, the already-pushed dedup,
 * and the caps. Nothing here is a security boundary — the disabled checkboxes
 * and the cap counter exist to stop the operator spending credits on a
 * selection the server would only discard.
 */
export function AudiencePreviewDialog(
  { audience, open, onOpenChange }:
  { audience: AgentAudience | null; open: boolean; onOpenChange: (v: boolean) => void },
) {
  const { toast } = useToast();
  const preview = usePreviewAudience();
  const runAudience = useRunAudience();

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AudiencePreview | null>(null);
  const [selected, setSelected] = useState<Map<string, ApolloPreviewPerson>>(new Map());
  const [platform, setPlatform] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runResult, setRunResult] = useState<AudienceRunResult | null>(null);

  const { data: campaigns = [] } = useAudienceCampaigns(platform ?? undefined);

  const ids = useMemo(
    () => (result?.people ?? []).map((p) => p.apollo_person_id),
    [result],
  );
  const { data: alreadyPushed } = useAlreadyPushed(ids);

  // A manual push may target anywhere, but defaulting to the audience's own
  // destination is what the operator almost always means.
  useEffect(() => {
    if (!open || !audience) return;
    setPage(1);
    setSelected(new Map());
    setResult(null);
    setRunResult(null);
    setPlatform(audience.default_platform);
    setCampaignId(audience.default_synced_campaign_id);
    // Keyed on identity, not the object: a refetch that returns an equal-but-new
    // `audience` must not wipe the operator's in-progress selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, audience?.id]);

  const load = async (p: number) => {
    if (!audience) return;
    try {
      const r = await preview.mutateAsync({ filters: audience.filters ?? {}, page: p, per_page: PER_PAGE });
      setResult(r);
      setPage(p);
    } catch (e) {
      toast({
        title: 'Preview failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (open && audience && !result && !preview.isPending) void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, audience?.id]);

  // Mirrors the server's own arithmetic (run-agent-audience, "caps").
  const allowance = audience
    ? Math.max(
      0,
      audience.max_total !== null && audience.max_total !== undefined
        ? Math.min(audience.max_per_run, audience.max_total - audience.total_pushed)
        : audience.max_per_run,
    )
    : 0;

  const atCap = selected.size >= allowance;

  const isBlocked = (p: ApolloPreviewPerson) =>
    !p.has_email || (alreadyPushed?.has(p.apollo_person_id) ?? false);

  const blockedReason = (p: ApolloPreviewPerson) => {
    if (alreadyPushed?.has(p.apollo_person_id)) return 'Already pushed';
    if (!p.has_email) return 'No work email';
    return null;
  };

  const toggle = (p: ApolloPreviewPerson, on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) {
        if (next.size >= allowance) return prev;
        next.set(p.apollo_person_id, p);
      } else {
        next.delete(p.apollo_person_id);
      }
      return next;
    });
  };

  const selectablePage = (result?.people ?? []).filter((p) => !isBlocked(p));
  const allPageSelected = selectablePage.length > 0
    && selectablePage.every((p) => selected.has(p.apollo_person_id));

  const toggleAllOnPage = (on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) {
        for (const p of selectablePage) {
          if (next.size >= allowance) break;
          next.set(p.apollo_person_id, p);
        }
      } else {
        for (const p of selectablePage) next.delete(p.apollo_person_id);
      }
      return next;
    });
  };

  const campaignName = campaigns.find((c) => c.id === campaignId)?.name ?? null;
  const canPush = !!audience && selected.size > 0 && !!platform && !!campaignId && !runAudience.isPending;

  const doRun = async () => {
    if (!audience || !platform || !campaignId) return;
    setConfirmOpen(false);
    try {
      const r = await runAudience.mutateAsync({
        audience_id: audience.id,
        person_ids: [...selected.keys()],
        platform,
        synced_campaign_id: campaignId,
      });
      setRunResult(r);
      setSelected(new Map());
      toast({
        title: r.pushed > 0 ? `Pushed ${r.pushed} contact${r.pushed === 1 ? '' : 's'}` : 'Run finished',
        description: r.note ?? `status: ${r.status ?? 'success'}`,
      });
    } catch (e) {
      toast({
        title: 'Run failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const totalEntries = result?.pagination.total_entries ?? null;
  const totalPages = result?.pagination.total_pages ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview &amp; run{audience ? ` — ${audience.name.trim()}` : ''}</DialogTitle>
            <DialogDescription>
              Search is free and reveals nothing. Enrichment spends Apollo credits and the
              push is irreversible — a pushed prospect is never offered to another audience.
            </DialogDescription>
          </DialogHeader>

          {runResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="font-medium">
                  Run {runResult.status ?? 'complete'}
                </span>
                {runResult.run_id && (
                  <span className="text-xs text-muted-foreground">run {runResult.run_id.slice(0, 8)}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {([
                  ['Searched', runResult.searched],
                  ['Enriched', runResult.enriched],
                  ['Credits', runResult.credits_spent],
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
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Info className="h-4 w-4" />{runResult.note}
                </p>
              )}
              {runResult.status === 'success' && (
                <p className="text-sm text-emerald-700">
                  This audience now has a successful run, so it can be armed for scheduled runs.
                </p>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setRunResult(null); void load(1); }}>
                  Preview again
                </Button>
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Push to platform</Label>
                  <Select
                    value={platform ?? ''}
                    onValueChange={(v) => { setPlatform(v); setCampaignId(null); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Choose a platform" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reply.io">Reply.io</SelectItem>
                      <SelectItem value="smartlead">Smartlead</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Campaign</Label>
                  <Select
                    value={campaignId ?? ''}
                    onValueChange={setCampaignId}
                    disabled={!platform}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={platform ? 'Select a campaign' : 'Pick a platform first'} />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {preview.isPending && !result ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !result ? (
                <div className="border rounded-lg py-12 text-center text-muted-foreground text-sm">
                  No preview yet.
                </div>
              ) : result.people.length === 0 ? (
                <div className="border rounded-lg py-12 text-center text-muted-foreground">
                  <p className="font-medium">No matches</p>
                  <p className="text-sm mt-1">Apollo returned nothing for these filters.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {totalEntries !== null ? `${totalEntries.toLocaleString()} matches` : 'Matches'}
                      {' · '}
                      <span className={selected.size >= allowance ? 'text-amber-600 font-medium' : ''}>
                        {selected.size} / {allowance} selected
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      credits charged so far: {result.credits_consumed} · key: {result.key_source}
                    </span>
                  </div>

                  {atCap && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Cap reached. "Max per run" is {audience?.max_per_run}
                      {audience?.max_total ? `, lifetime cap ${audience.max_total} with ${audience.total_pushed} already pushed` : ''}.
                    </p>
                  )}

                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              checked={allPageSelected}
                              onCheckedChange={(v) => toggleAllOnPage(!!v)}
                              disabled={selectablePage.length === 0}
                            />
                          </TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead className="w-32">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.people.map((p) => {
                          const blocked = isBlocked(p);
                          const reason = blockedReason(p);
                          const isSel = selected.has(p.apollo_person_id);
                          return (
                            <TableRow key={p.apollo_person_id} className={blocked ? 'opacity-55' : ''}>
                              <TableCell>
                                <Checkbox
                                  checked={isSel}
                                  disabled={blocked || (!isSel && atCap)}
                                  onCheckedChange={(v) => toggle(p, !!v)}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{personName(p)}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{p.title ?? '—'}</TableCell>
                              <TableCell className="text-sm">{p.organization_name ?? '—'}</TableCell>
                              <TableCell>
                                {reason
                                  ? <Badge variant="outline" className="text-xs">{reason}</Badge>
                                  : <Badge variant="secondary" className="text-xs">Email available</Badge>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <p className="text-xs text-muted-foreground">{result.notice}</p>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Page {page}{totalPages ? ` of ${totalPages}` : ''}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline" size="sm"
                        disabled={page <= 1 || preview.isPending}
                        onClick={() => void load(page - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" /> Prev
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        disabled={(totalPages !== null && page >= totalPages) || preview.isPending}
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
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!canPush} onClick={() => setConfirmOpen(true)}>
                {runAudience.isPending
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Rocket className="h-4 w-4 mr-2" />}
                Enrich &amp; push {selected.size > 0 ? selected.size : ''}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Enrol {selected.size} contact{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This enriches {selected.size} {selected.size === 1 ? 'person' : 'people'} — spending
                  Apollo credits — then enrols them into{' '}
                  <span className="font-medium">{campaignName ?? 'the selected campaign'}</span>
                  {platform ? ` on ${platform}` : ''}.
                </p>
                <p>
                  This cannot be undone. Dedup is client-wide, so a pushed prospect is never
                  offered to another audience, whether or not they are ever contacted.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doRun}>Enrich &amp; push</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
