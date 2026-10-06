import { Loader2, Radio } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { FeedMode, useLiveFeed } from '@/hooks/useInferenceInsights';
import { LiveEventCard } from '@/components/admin/inference/LiveEventCard';
import { CaptureHealthPanel } from '@/components/admin/inference/CaptureHealthPanel';

const MODE_LABEL: Record<FeedMode, string> = {
  connecting: 'Connecting… (polling every 15s)',
  realtime: 'Live — Realtime',
  polling: 'Realtime unavailable — polling every 15s',
};

function Counter({ title, value, footnote }: { title: string; value: React.ReactNode; footnote: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{footnote}</p>
      </CardContent>
    </Card>
  );
}

export function LiveFeedSection() {
  const { mode, feed, counters } = useLiveFeed();
  const c = counters.data;
  const cards = feed.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex flex-wrap items-center gap-2">
            <Radio className="h-4 w-4" /> Live Feed
            <span className="text-xs font-normal text-muted-foreground">what we learn from every reply, as it happens</span>
            <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span
                className={cn('h-2 w-2 rounded-full', mode === 'realtime' ? 'bg-primary' : 'bg-muted-foreground/50')}
                aria-hidden
              />
              {MODE_LABEL[mode]}
            </span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Live capture only — reply2_backfill and older mirrored backfill rows are excluded everywhere in this tab.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Counter title="Replies today" value={c ? c.today.toLocaleString() : '…'} footnote="Since local midnight" />
            <Counter title="Replies this week" value={c ? c.week.toLocaleString() : '…'} footnote="Since Monday, local time" />
            <Counter
              title="Fully enriched"
              value={c ? (c.fullyEnrichedPct === null ? '—' : `${c.fullyEnrichedPct.toFixed(0)}%`) : '…'}
              footnote={
                c
                  ? `${c.fullyEnriched.toLocaleString()} of ${c.week.toLocaleString()} replies this week carry title, industry, size, city, step and variant`
                  : 'Replies this week with all six segment fields'
              }
            />
          </div>
        </CardContent>
      </Card>

      {feed.error ? (
        <p className="text-sm text-destructive">Failed to load the live feed: {(feed.error as Error).message}</p>
      ) : feed.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No live replies captured yet.</p>
      ) : (
        <div className="space-y-3">
          {cards.map((card) => (
            <LiveEventCard key={card.id} card={card} />
          ))}
        </div>
      )}

      <CaptureHealthPanel />
    </div>
  );
}
