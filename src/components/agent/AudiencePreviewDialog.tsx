import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertTriangle, ChevronLeft, ChevronRight, Rocket, CheckCircle2, Info,
  Eye, Mail, MapPin, Building2, Users, ExternalLink,
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
import { cn } from '@/lib/utils';
import {
  usePreviewAudience, useRunAudience, useAlreadyPushed, useAudienceCampaigns,
  useRevealPeople,
  type AgentAudience, type ApolloPreviewPerson, type AudiencePreview,
  type AudienceRunResult, type RevealedPerson,
} from '@/hooks/useAgentAudiences';

const PER_PAGE = 25;

/**
 * Apollo masks the surname on the free search ("Lo***n") and returns it in full
 * only with enrichment, so a revealed record supersedes the preview one here.
 */
function personName(p: ApolloPreviewPerson, rev?: RevealedPerson) {
  if (rev) {
    const full = rev.name ?? [rev.first_name, rev.last_name].filter(Boolean).join(' ');
    if (full.trim()) return full;
  }
  const parts = [p.first_name, p.last_name_obfuscated].filter(Boolean);
  return parts.length ? parts.join(' ') : '(no name)';
}

/**
 * What enrichment will yield for this person, as availability flags.
 *
 * WHY FLAGS AND NOT VALUES. api_search returns no organisation data beyond the
 * company name, and no linkedin_url / domain / keywords at all — verified live
 * on 2026-08-30 against three unrelated filter shapes, identical key set every
 * time. So there is nothing here to print as a value. What Apollo does give is
 * a has_* flag per field, which answers the only question that matters before
 * paying: is this record worth enriching?
 *
 * Rendered dimmed-vs-solid rather than present-vs-absent on purpose. A row that
 * simply omitted its missing fields would be read as "not applicable"; showing
 * every field every time, with the absent ones greyed, makes the gap legible.
 *
 * DIRECT PHONE IS DELIBERATELY NOT IN THIS LIST, though Apollo gives us the
 * flag for it. apollo-enrich hardcodes reveal_phone_number:false — phones cost
 * up to 8 credits each and need a webhook, and no sequence we push to dials
 * anyone. A "Direct phone" pill here would promise something the Reveal button
 * directly beside it can never produce, which is worse than showing nothing:
 * the operator would read a blank reveal as a broken feature rather than as a
 * deliberate purchasing decision. If phone reveal is ever bought, add it back
 * here and to the mapper together.
 */
const ENRICH_FIELDS = [
  { key: 'location', label: 'Location' },
  { key: 'industry', label: 'Industry' },
  { key: 'headcount', label: 'Headcount' },
  { key: 'revenue', label: 'Revenue' },
] as const;

function enrichAvailability(p: ApolloPreviewPerson): Record<string, boolean> | null {
  // An older apollo-search deploy omits the org flags entirely. Undefined is
  // "unknown", NOT "absent" — render nothing rather than a row of grey pills
  // implying every record is barren.
  if (p.org_has_industry === undefined) return null;
  return {
    location: !!(p.has_city || p.has_state || p.has_country),
    industry: !!p.org_has_industry,
    headcount: !!p.org_has_employee_count,
    revenue: !!p.org_has_revenue,
  };
}

/** "5 wks ago" — coarse on purpose; the point is staleness, not precision. */
function refreshedAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 0) return null;
  if (days < 7) return 'this week';
  if (days < 60) return `${Math.floor(days / 7)} wks ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

/**
 * A revealed person's actual data, replacing the availability pills.
 *
 * The email is given the most weight because it is the only field that decides
 * anything: an enriched record without one cannot be enrolled on either v1
 * platform, whatever else Apollo returned.
 */
function RevealedDetails({ r }: { r: RevealedPerson }) {
  const location = [r.city, r.state, r.country].filter(Boolean).join(', ');
  const firmographics = [
    r.organization_industry,
    r.organization_employee_count !== null ? `${r.organization_employee_count.toLocaleString()} staff` : null,
    r.organization_revenue,
  ].filter(Boolean);

  return (
    <div className="space-y-1 text-xs">
      {r.email ? (
        <div className="flex items-start gap-1">
          <Mail className="h-3 w-3 mt-[2px] shrink-0 text-emerald-600" />
          <span className="font-medium break-all">{r.email}</span>
          {/* Apollo grades its own emails. 'guessed' still sends, but the
              operator should know before it goes into a sequence. */}
          {r.email_status && r.email_status !== 'verified' && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{r.email_status}</Badge>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Mail className="h-3 w-3 shrink-0" />
          <span>No work email</span>
        </div>
      )}

      {location && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          <span>{location}</span>
        </div>
      )}

      {firmographics.length > 0 && (
        <div className="flex items-start gap-1 text-muted-foreground">
          <Users className="h-3 w-3 mt-[2px] shrink-0" />
          <span>{firmographics.join(' · ')}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {r.linkedin_url && (
          <a
            href={r.linkedin_url} target="_blank" rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
          >
            LinkedIn <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {r.organization_domain && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Building2 className="h-3 w-3" />{r.organization_domain}
          </span>
        )}
      </div>
    </div>
  );
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
  const reveal = useRevealPeople();

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AudiencePreview | null>(null);
  const [selected, setSelected] = useState<Map<string, ApolloPreviewPerson>>(new Map());
  const [platform, setPlatform] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runResult, setRunResult] = useState<AudienceRunResult | null>(null);

  // Revealed records, keyed by apollo_person_id and kept ACROSS PAGES. Paging
  // back to a person already revealed must not re-ask (and re-charge) for them;
  // the server's cache would make that free, but a round trip that looks like a
  // purchase is still something the operator has to reason about.
  const [revealed, setRevealed] = useState<Map<string, RevealedPerson>>(new Map());
  // Ids Apollo had no record for at all. Distinct from "revealed with no email":
  // this person cannot be bought, that one was bought and had nothing useful.
  const [unmatched, setUnmatched] = useState<Set<string>>(new Set());
  // Ids awaiting confirmation of a reveal. Non-empty means the dialog is open.
  const [revealTargets, setRevealTargets] = useState<string[]>([]);
  // Which ids are in flight right now, so their buttons can spin individually.
  const [revealing, setRevealing] = useState<Set<string>>(new Set());

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
    setRevealed(new Map());
    setUnmatched(new Set());
    setRevealTargets([]);
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

  // A REVEALED record outranks the search flags, in both directions. has_email
  // is Apollo's claim about a record it will not show you; once bought, the
  // record itself is the fact. Search says has_email=true for people whose
  // enrichment returns nothing usable, and those must stop consuming a
  // selection slot the moment we know better.
  const isBlocked = (p: ApolloPreviewPerson) => {
    const id = p.apollo_person_id;
    if (alreadyPushed?.has(id)) return true;
    if (unmatched.has(id)) return true;
    const rev = revealed.get(id);
    if (rev) return !rev.email;
    return !p.has_email;
  };

  const blockedReason = (p: ApolloPreviewPerson) => {
    const id = p.apollo_person_id;
    if (alreadyPushed?.has(id)) return 'Already pushed';
    if (unmatched.has(id)) return 'Not in Apollo';
    const rev = revealed.get(id);
    if (rev) return rev.email ? null : 'No work email';
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

  // Anyone already revealed this session, or already known to be absent from
  // Apollo, is filtered out before we ask — re-revealing them would be a round
  // trip that buys nothing.
  const needsReveal = (ids: string[]) =>
    ids.filter((id) => !revealed.has(id) && !unmatched.has(id));

  const doReveal = async (ids: string[]) => {
    setRevealTargets([]);
    const targets = needsReveal(ids);
    if (targets.length === 0) return;

    setRevealing(new Set(targets));
    try {
      const r = await reveal.mutateAsync({ person_ids: targets });

      setRevealed((prev) => {
        const next = new Map(prev);
        for (const person of r.people) next.set(person.apollo_person_id, person);
        return next;
      });
      if (r.unmatched.length > 0) {
        setUnmatched((prev) => new Set([...prev, ...r.unmatched]));
      }

      // Drop anyone the reveal just disqualified. Leaving them ticked would let
      // the operator push a selection the server can only discard, and the
      // count beside "Enrich & push" would be quietly wrong.
      const useless = new Set([
        ...r.unmatched,
        ...r.people.filter((p) => !p.email).map((p) => p.apollo_person_id),
      ]);
      if (useless.size > 0) {
        setSelected((prev) => {
          const next = new Map(prev);
          let dropped = false;
          for (const id of useless) if (next.delete(id)) dropped = true;
          return dropped ? next : prev;
        });
      }

      const free = r.served_from_cache;
      const retryable = r.failed_chunks.reduce((n, c) => n + c.ids.length, 0);
      toast({
        title: `Revealed ${r.people.length} of ${targets.length}`,
        description: [
          `${r.credits_spent} credit${r.credits_spent === 1 ? '' : 's'} spent`,
          free > 0 ? `${free} already held, no charge` : null,
          r.unmatched.length > 0 ? `${r.unmatched.length} not found in Apollo` : null,
          // Named as retryable rather than folded into a failure count: these
          // people were never asked about successfully, so the Reveal button
          // stays available for them.
          retryable > 0 ? `${retryable} failed — try again` : null,
        ].filter(Boolean).join(' · '),
        variant: retryable > 0 ? 'destructive' : 'default',
      });
    } catch (e) {
      toast({
        title: 'Reveal failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setRevealing(new Set());
    }
  };

  // Reveal is scoped to the SELECTION, not to the page. Revealing 25 rows the
  // operator has not chosen would spend credits on people they were never going
  // to push, which is the exact mistake the preview step exists to prevent.
  const revealableSelected = needsReveal([...selected.keys()]);

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

                  {selected.size > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        {revealableSelected.length > 0 ? (
                          <>
                            Reveal buys the real email, surname and location for the people you
                            have ticked — the same records the push would buy anyway, so pushing
                            them afterwards costs nothing extra.
                          </>
                        ) : (
                          <>All {selected.size} selected {selected.size === 1 ? 'person is' : 'people are'} revealed. Pushing them will not spend again.</>
                        )}
                      </p>
                      <Button
                        variant="outline" size="sm" className="shrink-0"
                        disabled={revealableSelected.length === 0 || reveal.isPending}
                        onClick={() => setRevealTargets(revealableSelected)}
                      >
                        {reveal.isPending
                          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          : <Eye className="h-4 w-4 mr-2" />}
                        Reveal {revealableSelected.length > 0 ? revealableSelected.length : ''}
                      </Button>
                    </div>
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
                          {/* Availability, not values — see enrichAvailability. */}
                          <TableHead className="w-48">After enrichment</TableHead>
                          <TableHead className="w-32">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.people.map((p) => {
                          const blocked = isBlocked(p);
                          const reason = blockedReason(p);
                          const isSel = selected.has(p.apollo_person_id);
                          const rev = revealed.get(p.apollo_person_id);
                          const busy = revealing.has(p.apollo_person_id);
                          return (
                            <TableRow key={p.apollo_person_id} className={blocked ? 'opacity-55' : ''}>
                              <TableCell>
                                <Checkbox
                                  checked={isSel}
                                  disabled={blocked || (!isSel && atCap)}
                                  onCheckedChange={(v) => toggle(p, !!v)}
                                />
                              </TableCell>
                              <TableCell className="font-medium">
                                {personName(p, rev)}
                                {rev && (
                                  <span className="block text-[10px] font-normal text-emerald-700 dark:text-emerald-400">
                                    revealed
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {rev?.title ?? p.title ?? '—'}
                              </TableCell>
                              <TableCell className="text-sm">
                                {rev?.organization_name ?? p.organization_name ?? '—'}
                                {refreshedAgo(p.last_refreshed_at) && (
                                  <span className="block text-xs text-muted-foreground">
                                    refreshed {refreshedAgo(p.last_refreshed_at)}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {/* Once bought, show the data. The availability
                                    pills are a forecast, and a forecast beside
                                    the actual result is just noise. */}
                                {rev ? <RevealedDetails r={rev} /> : (() => {
                                  const avail = enrichAvailability(p);
                                  return (
                                    <div className="space-y-1.5">
                                      {avail ? (
                                        <div className="flex flex-wrap gap-1">
                                          {ENRICH_FIELDS.map((f) => (
                                            <span
                                              key={f.key}
                                              title={avail[f.key]
                                                ? `${f.label} available after enrichment`
                                                : `No ${f.label.toLowerCase()} on this record`}
                                              className={cn(
                                                'text-[10px] leading-none px-1.5 py-1 rounded border',
                                                avail[f.key]
                                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                  : 'border-transparent bg-muted text-muted-foreground/50 line-through',
                                              )}
                                            >
                                              {f.label}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                      )}
                                      {/* Offered for anyone Apollo can still be
                                          asked about, including rows that are
                                          blocked from pushing: "already pushed"
                                          is a dedup rule, not a reason the
                                          operator may not look at the record
                                          they already paid for. */}
                                      {!unmatched.has(p.apollo_person_id) && (
                                        <Button
                                          variant="ghost" size="sm"
                                          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                                          disabled={busy || reveal.isPending}
                                          onClick={() => setRevealTargets([p.apollo_person_id])}
                                        >
                                          {busy
                                            ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                            : <Eye className="h-3 w-3 mr-1" />}
                                          Reveal
                                        </Button>
                                      )}
                                    </div>
                                  );
                                })()}
                              </TableCell>
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
                {/* Only counts reveals made in THIS dialog. The server may hold
                    cached records from an earlier session that will also come
                    back free, so this is a floor on the saving, never a
                    quoted price. */}
                {revealableSelected.length < selected.size && (
                  <p>
                    {selected.size - revealableSelected.length} of these{' '}
                    {selected.size - revealableSelected.length === 1 ? 'is' : 'are'} already revealed
                    and will not be charged again.
                  </p>
                )}
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

      {/* Reveal spends money, so it is confirmed exactly like the push is. The
          two are NOT equally serious, though, and the wording says so: reveal is
          recoverable spend that the push would have incurred anyway, while the
          push burns the prospect permanently. Dressing them up identically
          would train the operator to click through both. */}
      <AlertDialog
        open={revealTargets.length > 0}
        onOpenChange={(v) => { if (!v) setRevealTargets([]); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reveal {revealTargets.length} {revealTargets.length === 1 ? 'person' : 'people'}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This asks Apollo for their real email, surname, LinkedIn and location —
                  up to {revealTargets.length} credit{revealTargets.length === 1 ? '' : 's'}.
                  Apollo charges nothing for a record it cannot match.
                </p>
                <p>
                  Nobody is contacted and nothing is enrolled. The results are kept, so
                  pushing these people later re-uses them instead of buying them again.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doReveal(revealTargets)}>
              Reveal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
