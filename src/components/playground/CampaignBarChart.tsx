// Per-campaign sent / opens / replies for the Data Analysis report.
//
// Source: stats_snapshot.heyreach.per_campaign[] +
//         stats_snapshot.smartlead.per_campaign[]
// of the SELECTED snapshot. Both surfaces (admin DataAnalysisTab and public
// PublicClientReport) compute the merged ChartDatum[] from the snapshot
// they're displaying and pass it as `data`. Range-scoped end-to-end —
// the previous "Lifetime totals" caveat is gone.
//
// Failure surfacing: when HR per-campaign is partial (some campaigns'
// upstream calls failed), the parent passes `partial={true}` and we show
// a small "Some campaigns' data was unavailable" note. The aggregate stat
// cards stay correct regardless because they read from the account-level
// HR call that's unaffected.

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';

export interface ChartDatum {
  name: string;
  source: string;
  sent: number;
  opens: number;
  replies: number;
}

export interface CampaignBarChartProps {
  data: ChartDatum[];
  // Range label for the header (e.g. "last_week", "7d"). Optional so a
  // caller that's mid-load can omit it; absent → no parenthetical.
  range?: string;
  // True when at least one HR per-campaign upstream call failed. Drives a
  // small muted note below the chart so the client knows the picture is
  // partial without us silently lying.
  partial?: boolean;
}

function truncateName(name: string, max = 18): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

// Match the existing stat-card iconography colours roughly: blue for sent
// volume, amber for opens, emerald for replies. These also read well in
// both light and dark mode on the existing card backgrounds.
const COLORS = {
  sent: '#3b82f6',
  opens: '#f59e0b',
  replies: '#10b981',
};

export function CampaignBarChart({ data, range, partial }: CampaignBarChartProps) {
  // Stable order: largest "sent" first so the eye lands on the biggest
  // bar. Falls back to name when sent ties (cheap deterministic sort).
  const chartData = useMemo<ChartDatum[]>(
    () =>
      data.slice().sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name)),
    [data],
  );

  if (chartData.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            Per-campaign performance{range ? ` (${range})` : ''}
          </h3>
          <p className="text-xs text-muted-foreground">
            Sent, opens (email), and replies per campaign for the selected
            snapshot's date range.
          </p>
        </div>

        {/* Height scales with row count so a 1-2-campaign client doesn't
            get a huge empty plot. Capped so 10+ campaigns still fit. */}
        <div style={{ height: Math.min(420, 220 + chartData.length * 12) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 16, left: 0, bottom: 36 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tickFormatter={(v: string) => truncateName(v)}
                angle={-20}
                textAnchor="end"
                interval={0}
                height={56}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                width={48}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                cursor={{ fill: 'hsl(var(--accent) / 0.3)' }}
                formatter={(value: number, name: string) => [
                  value.toLocaleString(),
                  name.charAt(0).toUpperCase() + name.slice(1),
                ]}
                labelFormatter={(label: string) => label}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value: string) =>
                  value.charAt(0).toUpperCase() + value.slice(1)
                }
              />
              <Bar dataKey="sent" fill={COLORS.sent} radius={[3, 3, 0, 0]} />
              <Bar dataKey="opens" fill={COLORS.opens} radius={[3, 3, 0, 0]} />
              <Bar dataKey="replies" fill={COLORS.replies} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {partial && (
          <p className="text-[11px] text-muted-foreground italic leading-snug">
            Some campaigns' data was unavailable for this snapshot.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
