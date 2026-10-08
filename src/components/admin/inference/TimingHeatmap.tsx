import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RpcHeatmap, WEEKDAYS, heatmapGrid } from '@/lib/inferenceAnalytics';
import { SourceSplit } from '@/components/admin/inference/SourceSplit';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Sequential single hue: intensity = count / max, empty cells stay neutral.
function cellColor(v: number, max: number): string | undefined {
  if (v === 0 || max === 0) return undefined;
  return `hsl(var(--primary) / ${(0.12 + 0.88 * (v / max)).toFixed(3)})`;
}

export function TimingHeatmap({ heatmap, segmentLabel }: { heatmap: RpcHeatmap | undefined; segmentLabel: string }) {
  const { cells, max } = useMemo(() => heatmapGrid(heatmap), [heatmap]);
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const counted = heatmap?.counted ?? 0;
  const interestedAll = heatmap?.interested ?? 0;
  const missingTime = interestedAll - counted;
  const interestedLive = heatmap?.interested_live ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Clock className="h-4 w-4" /> Timing — interested replies by hour × weekday (ET)
          <span className="text-xs font-normal text-muted-foreground">{segmentLabel}</span>
          <SourceSplit live={interestedLive} backfill={interestedAll - interestedLive} className="ml-auto" />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Time of the reply in Eastern Time (America/New_York). {counted.toLocaleString()} interested replies plotted;{' '}
          {missingTime.toLocaleString()} have no reply time (live capture does not record it yet).
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-xs h-4 mb-2 tabular-nums" aria-live="polite">
          {hover
            ? `${WEEKDAYS[hover.d]} ${hourLabel(hover.h)}–${hourLabel((hover.h + 1) % 24)}: ${cells[hover.d][hover.h].toLocaleString()} interested replies`
            : 'Hover a cell for its count'}
        </p>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `2.5rem repeat(24, minmax(1.25rem, 1fr))` }}>
            <div />
            {HOURS.map((h) => (
              <div key={h} className="text-[9px] text-muted-foreground text-center">
                {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
              </div>
            ))}
            {WEEKDAYS.map((day, d) => (
              <div key={day} className="contents">
                <div className="text-[10px] text-muted-foreground pr-1 self-center">{day}</div>
                {HOURS.map((h) => {
                  const v = cells[d][h];
                  return (
                    <div
                      key={h}
                      role="img"
                      aria-label={`${day} ${hourLabel(h)}: ${v} interested replies`}
                      className="h-6 rounded-sm bg-muted outline-offset-1 hover:outline hover:outline-1 hover:outline-foreground"
                      style={{ backgroundColor: cellColor(v, max) }}
                      onMouseEnter={() => setHover({ d, h })}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
          <span>0</span>
          <div
            className="h-2 w-32 rounded-sm"
            style={{ background: 'linear-gradient(to right, hsl(var(--primary) / 0.12), hsl(var(--primary) / 1))' }}
          />
          <span>{max.toLocaleString()} interested replies</span>
        </div>
      </CardContent>
    </Card>
  );
}
