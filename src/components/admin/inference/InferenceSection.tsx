import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dimension,
  SegmentFilter,
  SourceFilter,
  biasFromCounts,
  describeSegment,
  pct,
  toSegmentRow,
  toStats,
} from '@/lib/inferenceAnalytics';
import { useInsightsSuggestions, useInsightsSummary } from '@/hooks/useInferenceInsights';
import { SourceSplit } from '@/components/admin/inference/SourceSplit';
import { SegmentExplorer } from '@/components/admin/inference/SegmentExplorer';
import { CopyLeaderboard } from '@/components/admin/inference/CopyLeaderboard';
import { TimingHeatmap } from '@/components/admin/inference/TimingHeatmap';
import { DeductionsPanel } from '@/components/admin/inference/DeductionsPanel';

function DatePicker({ label, value, onChange }: { label: string; value?: Date; onChange: (d?: Date) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-40 justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, 'MMM d, yyyy') : <span className="text-muted-foreground">Any</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={onChange} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function InferenceSection() {
  const [source, setSource] = useState<SourceFilter>('all');
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();
  const [segment, setSegment] = useState<SegmentFilter | null>(null);
  const [dims, setDims] = useState<Dimension[]>(['industry']);
  const [includeUnknown, setIncludeUnknown] = useState(false);

  // "To" is inclusive of the whole day
  const toEnd = useMemo(() => (to ? new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999) : undefined), [to]);
  const filters = useMemo(() => ({ source, from, to: toEnd }), [source, from, toEnd]);

  // All aggregation happens in Postgres (admin_inference_insights).
  const summary = useInsightsSummary(filters, { dims, includeUnknown, segment });
  const suggestions = useInsightsSuggestions(filters);
  const data = summary.data;
  const { isLoading, error } = summary;

  const baseline = useMemo(() => toStats(data?.baseline), [data]);
  const bias = useMemo(() => biasFromCounts(data?.bias), [data]);
  const segmentStats = useMemo(() => toStats(data?.segment_stats), [data]);
  const segments = useMemo(
    () => (data?.segments ?? []).map((r) => toSegmentRow(r, baseline.interestedRate)),
    [data, baseline.interestedRate],
  );
  const segmentLabel = segment ? describeSegment(segment) : 'All replies in view';
  const global = filters;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All (live + backfill)</SelectItem>
                <SelectItem value="live">Live capture</SelectItem>
                <SelectItem value="backfill">Backfill</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DatePicker label="From" value={from} onChange={setFrom} />
          <DatePicker label="To" value={to} onChange={setTo} />
          {(from || to) && (
            <Button variant="ghost" size="sm" onClick={() => { setFrom(undefined); setTo(undefined); }}>
              Clear dates
            </Button>
          )}
          <div className="ml-auto text-right">
            <p className="text-sm tabular-nums">
              {baseline.replies.toLocaleString()} replies · {baseline.interested.toLocaleString()} interested · baseline interested share of
              replies {pct(baseline.interestedRate)}
            </p>
            <SourceSplit live={baseline.live} backfill={baseline.backfill} />
            {data?.facts_as_of && (
              <p className="text-[11px] text-muted-foreground">
                Reply data as of {format(new Date(data.facts_as_of), 'MMM d, HH:mm')} · refreshed every 15 minutes
              </p>
            )}
          </div>
          <p className="basis-full text-[11px] text-muted-foreground">
            Rates here are the interested share of replies. There are no non-responder sends for the backfill, so they
            are not reply or conversion rates.
          </p>
        </CardContent>
        {segment && (
          <CardContent className="pt-0">
            <Button variant="secondary" size="sm" className="gap-1" onClick={() => setSegment(null)}>
              Focused on: {segmentLabel} ({segmentStats.replies.toLocaleString()} replies)
              <X className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        )}
      </Card>

      {error ? (
        <p className="text-sm text-destructive">Failed to load reply data: {(error as Error).message}</p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Aggregating every reply (live + backfill)…
        </div>
      ) : (
        <>
          <SegmentExplorer
            segments={segments}
            totalReplies={baseline.replies}
            covered={Number(data?.covered ?? 0)}
            dims={dims}
            onDimsChange={setDims}
            includeUnknown={includeUnknown}
            onIncludeUnknownChange={setIncludeUnknown}
            bias={bias}
            selected={segment}
            onSelect={setSegment}
            refreshing={summary.isFetching}
          />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <CopyLeaderboard copy={data?.copy} segmentLabel={segmentLabel} />
            <TimingHeatmap heatmap={data?.heatmap} segmentLabel={segmentLabel} />
          </div>
          <DeductionsPanel
            candidates={suggestions.data?.suggestions}
            candidatesLoading={suggestions.isLoading}
            baselineRate={baseline.interestedRate}
            bias={bias}
            segment={segment}
            segmentStats={segmentStats}
            global={global}
          />
        </>
      )}
    </div>
  );
}
