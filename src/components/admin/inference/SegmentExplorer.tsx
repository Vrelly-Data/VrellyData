import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, Layers, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  Dimension,
  DimensionBias,
  describeBias,
  MIN_SAMPLE,
  SegmentFilter,
  SegmentRow,
  fmtHours,
  fmtLift,
  pct,
  suggestionKey,
} from '@/lib/inferenceAnalytics';
import { SourceSplit } from '@/components/admin/inference/SourceSplit';

type SortKey = 'replies' | 'interested' | 'notInterested' | 'interestedRate' | 'lift' | 'medianHoursToReply';
const MAX_DIMS = 3;
const PAGE_ROWS = 100;

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'replies', label: 'Replies (n)' },
  { key: 'interested', label: 'Interested' },
  { key: 'notInterested', label: 'Not interested' },
  { key: 'interestedRate', label: 'Interested share of replies' },
  { key: 'lift', label: 'vs baseline' },
  { key: 'medianHoursToReply', label: 'Median time to reply' },
];

// Rows come grouped from the server (admin_inference_insights); this component
// only sorts and renders them. Dimensions and the unknowns toggle live in the
// parent because they are part of the server query.
export function SegmentExplorer({
  segments,
  totalReplies,
  covered,
  dims,
  onDimsChange,
  includeUnknown,
  onIncludeUnknownChange,
  bias,
  selected,
  onSelect,
  refreshing,
}: {
  segments: SegmentRow[];
  totalReplies: number;
  covered: number;
  dims: Dimension[];
  onDimsChange: (dims: Dimension[]) => void;
  includeUnknown: boolean;
  onIncludeUnknownChange: (v: boolean) => void;
  bias: Record<Dimension, DimensionBias>;
  selected: SegmentFilter | null;
  onSelect: (segment: SegmentFilter | null) => void;
  refreshing: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('replies');
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const val = (s: SegmentRow) => (s[sortKey] ?? -Infinity) as number;
    return [...segments].sort((a, b) => val(b) - val(a) || b.replies - a.replies);
  }, [segments, sortKey]);
  const visible = showAll ? sorted : sorted.slice(0, PAGE_ROWS);
  const selectedKey = selected ? suggestionKey(selected) : null;
  const biased = dims.filter((d) => bias[d]?.biased);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4" /> Segment explorer
          {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Updating" />}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Pick up to {MAX_DIMS} dimensions. Rows with n &lt; {MIN_SAMPLE} are greyed out. Click a row to focus the copy
          leaderboard, timing and deductions on that segment.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToggleGroup
          type="multiple"
          value={dims}
          onValueChange={(v) => {
            if (v.length === 0 || v.length > MAX_DIMS) return;
            onDimsChange(v as Dimension[]);
            onSelect(null);
          }}
          className="flex flex-wrap justify-start"
        >
          {DIMENSIONS.map((d) => (
            <ToggleGroupItem key={d} value={d} size="sm" aria-label={DIMENSION_LABELS[d]}>
              {DIMENSION_LABELS[d]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Checkbox id="include-unknown" checked={includeUnknown} onCheckedChange={(v) => onIncludeUnknownChange(v === true)} />
            <Label htmlFor="include-unknown" className="text-xs font-normal">Include "(unknown)" values</Label>
          </div>
          <span>
            {covered.toLocaleString()} of {totalReplies.toLocaleString()} replies have{' '}
            {dims.length === 1 ? 'this dimension' : 'all selected dimensions'}
            {includeUnknown ? ' (unknowns included)' : ''} · {segments.length.toLocaleString()} segments
          </span>
        </div>

        {biased.length > 0 && (
          <div className="flex gap-2 rounded-md border border-dashed p-3 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Enrichment bias — interested share of replies on {biased.map((d) => DIMENSION_LABELS[d]).join(', ')} is inflated</p>
              {biased.map((d) => (
                <p key={d} className="text-muted-foreground">{describeBias(d, bias[d])}.</p>
              ))}
              <p className="text-muted-foreground">Known values here mostly mean "this lead was enriched", which happened mainly for interested leads. Compare segments on unbiased dimensions or with live data.</p>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {dims.map((d) => (
                  <TableHead key={d}>{DIMENSION_LABELS[d]}</TableHead>
                ))}
                {COLUMNS.map((col) => (
                  <TableHead key={col.key} className="text-right whitespace-nowrap">
                    <button
                      type="button"
                      className={cn('inline-flex items-center gap-1', sortKey === col.key && 'text-foreground font-medium')}
                      onClick={() => setSortKey(col.key)}
                    >
                      {col.label}
                      {sortKey === col.key && <ArrowDown className="h-3 w-3" />}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s) => {
                const key = suggestionKey(s.values);
                const small = s.replies < MIN_SAMPLE;
                return (
                  <TableRow
                    key={s.key}
                    onClick={() => onSelect(selectedKey === key ? null : s.values)}
                    className={cn('cursor-pointer', small && 'opacity-50', selectedKey === key && 'bg-muted')}
                    title={small ? `Small sample (n = ${s.replies}); treat with caution` : undefined}
                  >
                    {dims.map((d) => (
                      <TableCell key={d} className="max-w-[16rem] truncate">{s.values[d]}</TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">
                      <div>{s.replies.toLocaleString()}</div>
                      <SourceSplit live={s.live} backfill={s.backfill} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.interested.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.notInterested.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(s.interestedRate)}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtLift(s.lift)}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {fmtHours(s.medianHoursToReply)}
                      {s.hoursSample > 0 && s.hoursSample < s.replies && (
                        <div className="text-[10px] text-muted-foreground">of {s.hoursSample.toLocaleString()}</div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {sorted.length > PAGE_ROWS && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show top ${PAGE_ROWS}` : `Show all ${sorted.length.toLocaleString()} segments`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
