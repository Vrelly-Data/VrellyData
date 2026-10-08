import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Lightbulb, Loader2, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DIMENSION_LABELS,
  Dimension,
  DimensionBias,
  RpcStats,
  biasedDims,
  SegmentFilter,
  SourceFilter,
  Stats,
  Suggestion,
  describeSegment,
  fmtHours,
  fmtLift,
  pct,
  toSegmentRow,
} from '@/lib/inferenceAnalytics';
import { Deduction, DeductionInput, useDeductions, useSaveDeduction } from '@/hooks/useInferenceInsights';
import { SourceSplit } from '@/components/admin/inference/SourceSplit';

export type GlobalFilter = { source: SourceFilter; from?: Date; to?: Date };

type Draft = DeductionInput & { id?: string };

function evidenceFor(stats: Stats, baselineRate: number, biased: Dimension[] = []) {
  return {
    enrichment_biased_dims: biased,
    replies: stats.replies,
    interested: stats.interested,
    not_interested: stats.notInterested,
    interested_share_of_replies: stats.interestedRate,
    baseline_interested_share_of_replies: baselineRate,
    lift: baselineRate > 0 ? stats.interestedRate / baselineRate : null,
    median_hours_to_reply: stats.medianHoursToReply,
    hours_sample: stats.hoursSample,
    live_n: stats.live,
    backfill_n: stats.backfill,
    computed_at: new Date().toISOString(),
  };
}

function filterFor(segment: SegmentFilter, global: GlobalFilter): Deduction['segment_filter'] {
  return {
    segment,
    source: global.source,
    dateFrom: global.from ? global.from.toISOString() : null,
    dateTo: global.to ? global.to.toISOString() : null,
  };
}

function draftFromSuggestion(s: Suggestion, baselineRate: number, global: GlobalFilter, bias: Record<Dimension, DimensionBias>): Draft {
  return {
    title: `${describeSegment(s.values)}: ${fmtLift(s.lift)} interested share of replies`,
    body: `${pct(s.interestedRate)} of ${s.replies.toLocaleString()} replies were interested (interested share of replies), vs ${pct(baselineRate)} across all replies in view (live ${s.live.toLocaleString()} · backfill ${s.backfill.toLocaleString()}).`,
    segment_filter: filterFor(s.values, global),
    evidence: evidenceFor(s, baselineRate, biasedDims(s.values, bias)),
    status: 'accepted',
    suggestion_key: s.suggestionKey,
  };
}

function EvidenceLine({ evidence }: { evidence: Record<string, unknown> | null }) {
  if (!evidence) return null;
  const n = (k: string) => (typeof evidence[k] === 'number' ? (evidence[k] as number) : null);
  return (
    <p className="text-[11px] text-muted-foreground tabular-nums">
      n = {(n('replies') ?? 0).toLocaleString()} · interested share of replies {pct(n('interested_share_of_replies'))} ·{' '}
      {fmtLift(n('lift'))} ·
      median reply {fmtHours(n('median_hours_to_reply'))} · live {(n('live_n') ?? 0).toLocaleString()} · backfill{' '}
      {(n('backfill_n') ?? 0).toLocaleString()}
    </p>
  );
}

// Suggestion candidates come ranked from the server (admin_inference_insights,
// section 'suggestions'); this panel only drops the ones already accepted or
// rejected and shows the top SUGGESTIONS_SHOWN.
const SUGGESTIONS_SHOWN = 8;

export function DeductionsPanel({
  candidates,
  candidatesLoading,
  baselineRate,
  bias,
  segment,
  segmentStats,
  global,
}: {
  candidates: { all: Array<RpcStats & { values: SegmentFilter }>; unbiased: Array<RpcStats & { values: SegmentFilter }> } | undefined;
  candidatesLoading: boolean;
  baselineRate: number;
  bias: Record<Dimension, DimensionBias>;
  segment: SegmentFilter | null;
  // Stats of the focused segment (or of every reply in view when none is focused).
  segmentStats: Stats;
  global: GlobalFilter;
}) {
  const { data: deductions = [], isLoading, error } = useDeductions();
  const save = useSaveDeduction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [includeBiased, setIncludeBiased] = useState(false);
  const flagged = useMemo(() => (Object.keys(bias) as Dimension[]).filter((d) => bias[d].biased), [bias]);

  const decided = useMemo(
    () => new Set(deductions.filter((d) => d.suggestion_key && d.status !== 'suggested').map((d) => d.suggestion_key as string)),
    [deductions],
  );
  const suggestions: Suggestion[] = useMemo(
    () =>
      ((includeBiased ? candidates?.all : candidates?.unbiased) ?? [])
        .map((c) => toSegmentRow(c, baselineRate))
        .map((s) => ({ ...s, suggestionKey: s.key }))
        .filter((s) => !decided.has(s.suggestionKey))
        .slice(0, SUGGESTIONS_SHOWN),
    [candidates, includeBiased, baselineRate, decided],
  );
  const accepted = deductions.filter((d) => d.status === 'accepted');
  const rejected = deductions.filter((d) => d.status === 'rejected');

  const persist = (d: Draft, message: string) =>
    save.mutate(d, {
      onSuccess: () => {
        toast.success(message);
        setDraft(null);
      },
      onError: (e) => toast.error(`Could not save deduction: ${(e as Error).message}`),
    });

  const writeForSegment = () => {
    const values = segment ?? {};
    const stats = segmentStats;
    setDraft({
      title: '',
      body: '',
      segment_filter: filterFor(values, global),
      evidence: evidenceFor(stats, baselineRate, biasedDims(values, bias)),
      status: 'accepted',
      suggestion_key: null,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Lightbulb className="h-4 w-4" /> Deductions
          <Button size="sm" variant="outline" className="ml-auto gap-1" onClick={writeForSegment}>
            <PenLine className="h-3.5 w-3.5" />
            {segment ? 'Write a deduction for this segment' : 'Write a deduction'}
          </Button>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Suggestions rank segments by lift over the baseline interested share of replies ({pct(baselineRate)} across the
          replies in view), n ≥ 30, single dimensions and pairs that beat both parents.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium">Suggested</p>
            <div className="flex items-center gap-2">
              <Checkbox id="include-biased" checked={includeBiased} onCheckedChange={(v) => setIncludeBiased(v === true)} />
              <Label htmlFor="include-biased" className="text-xs font-normal">Include biased dimensions</Label>
            </div>
            {flagged.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {includeBiased ? 'Including' : 'Excluding'} {flagged.map((d) => DIMENSION_LABELS[d]).join(', ')}
              </span>
            )}
          </div>
          {candidatesLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Ranking segments…
            </p>
          ) : suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No segment beats the baseline with n ≥ 30 in this selection.</p>
          ) : (
            suggestions.map((s) => (
              <div key={s.suggestionKey} className="rounded-lg border p-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{describeSegment(s.values)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    <span className="font-semibold text-foreground">{fmtLift(s.lift)}</span> · {pct(s.interestedRate)} interested share
                    of replies ·
                    n = {s.replies.toLocaleString()} · median reply {fmtHours(s.medianHoursToReply)}
                  </p>
                  <SourceSplit live={s.live} backfill={s.backfill} />
                  {biasedDims(s.values, bias).length > 0 && (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <AlertTriangle className="h-3 w-3" /> Enrichment-biased:{' '}
                      {biasedDims(s.values, bias).map((d) => DIMENSION_LABELS[d]).join(', ')} known mostly for interested
                      leads; this lift is likely inflated
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={save.isPending}
                    onClick={() => persist(draftFromSuggestion(s, baselineRate, global, bias), 'Deduction accepted')}
                  >
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDraft(draftFromSuggestion(s, baselineRate, global, bias))}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={save.isPending}
                    onClick={() => persist({ ...draftFromSuggestion(s, baselineRate, global, bias), status: 'rejected' }, 'Suggestion rejected')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Saved</p>
          {error ? (
            <p className="text-sm text-destructive">Failed to load deductions: {(error as Error).message}</p>
          ) : isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : accepted.length === 0 ? (
            <p className="text-xs text-muted-foreground">No deductions saved yet.</p>
          ) : (
            accepted.map((d) => (
              <div key={d.id} className="rounded-lg border p-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{d.title}</p>
                  <Badge variant="outline">{d.suggestion_key ? 'from suggestion' : 'written'}</Badge>
                  <span className="text-[11px] text-muted-foreground">{format(new Date(d.created_at), 'MMM d, yyyy')}</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ ...d })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => persist({ ...d, status: 'rejected' }, 'Deduction rejected')}>
                      Reject
                    </Button>
                  </div>
                </div>
                {d.body && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{d.body}</p>}
                <p className="text-[11px] text-muted-foreground">
                  {describeSegment(d.segment_filter?.segment ?? {})} · source {d.segment_filter?.source ?? 'all'}
                </p>
                <EvidenceLine evidence={d.evidence} />
              </div>
            ))
          )}
          {rejected.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">{rejected.length} rejected</Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1">
                {rejected.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{d.title}</span>
                    <Button size="sm" variant="ghost" onClick={() => persist({ ...d, status: 'accepted' }, 'Deduction restored')}>
                      Restore
                    </Button>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit deduction' : 'New deduction'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="deduction-title">Deduction</Label>
                <Input
                  id="deduction-title"
                  placeholder="e.g. Construction owners 1–10 employees reply best to step 1 on Tue 9–10am"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="deduction-body">Notes</Label>
                <Textarea
                  id="deduction-body"
                  rows={4}
                  value={draft.body ?? ''}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </div>
              <div className="rounded-md bg-muted p-3 space-y-1">
                <p className="text-xs font-medium">Segment</p>
                <p className="text-xs text-muted-foreground">
                  {describeSegment(draft.segment_filter?.segment ?? {})} · source {draft.segment_filter?.source ?? 'all'}
                </p>
                <p className="text-xs font-medium pt-1">Evidence (snapshot at save)</p>
                <EvidenceLine evidence={draft.evidence} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={!draft?.title.trim() || save.isPending}
              onClick={() => draft && persist({ ...draft, title: draft.title.trim(), status: 'accepted' }, 'Deduction saved')}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
