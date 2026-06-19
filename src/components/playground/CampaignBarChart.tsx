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

// Platform-specific dataKeys so a single Recharts BarChart can render
// different metric sets per row. LinkedIn rows populate the linkedin_*
// fields and leave email_* undefined; Smartlead rows do the opposite.
// Recharts skips a Bar for any row whose value for that dataKey is
// undefined — no zero-height bar, no broken layout — which is how the
// 4-bars-for-LinkedIn / 2-bars-for-email shape lands cleanly.
export interface ChartDatum {
  name: string;
  source: string;
  // LinkedIn (heyreach) — present only on source === 'heyreach' rows.
  linkedin_sent?: number;
  linkedin_replies?: number;
  linkedin_connections_sent?: number;
  linkedin_connections_accepted?: number;
  // Email (smartlead) — present only on source === 'smartlead' rows.
  // No connection concept on email; only sent + replies.
  email_sent?: number;
  email_replies?: number;
}

// Single source of truth for the zero-activity filter, exported so both
// callers (DataAnalysisTab + PublicClientReport) share the same predicate.
// LinkedIn requires the broader OR — a campaign that only sent connection
// requests is still active and should NOT be filtered out.
//
// Source values:
//   'heyreach'            → LinkedIn rows from HeyReach sync
//   'reply_io_linkedin'   → LinkedIn rows from Reply.io reporting (Step 3b)
//   'smartlead'           → email rows from Smartlead sync
//   'reply_io_email'      → email rows from Reply.io reporting (Step 3b)
// HR and Reply.io LinkedIn rows populate the same linkedin_* dataKeys
// (so they render in the same blue family); Smartlead and Reply.io email
// rows populate the same email_* dataKeys (green + amber). The source
// discriminator just routes which "is active?" predicate applies.
export function isActiveCampaign(c: ChartDatum): boolean {
  if (c.source === 'heyreach' || c.source === 'reply_io_linkedin') {
    return (
      (c.linkedin_sent ?? 0) > 0 ||
      (c.linkedin_replies ?? 0) > 0 ||
      (c.linkedin_connections_sent ?? 0) > 0 ||
      (c.linkedin_connections_accepted ?? 0) > 0
    );
  }
  return (c.email_sent ?? 0) > 0 || (c.email_replies ?? 0) > 0;
}

export interface CampaignBarChartProps {
  data: ChartDatum[];
  // The SNAPSHOT's range label — shown in the header parenthetical
  // ("Per-campaign performance (last_week)"). Optional so a caller that's
  // mid-load can omit it.
  range?: string;
  // The currently-SELECTED preview range from the range tabs. Only the
  // admin tab has a range switcher; the public report omits this. When
  // present AND different from `range`, the chart shows a small caption
  // making the mismatch visible to the operator: cards live-refresh on
  // tab click but the chart reads from the saved snapshot.
  selectedRange?: string;
  // True when at least one HR per-campaign upstream call failed. Drives a
  // small muted note below the chart so the client knows the picture is
  // partial without us silently lying.
  partial?: boolean;
}

function truncateName(name: string, max = 18): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

// Platform color-coded palette. LinkedIn = blue family (four distinct
// shades, monotonic from "connection request" to "accepted"); Email =
// green + amber. Distinct enough that "blue area = LinkedIn,
// green/amber area = email" reads at a glance on the grouped bars.
const COLORS = {
  linkedin_sent:                 '#3b82f6', // blue-500
  linkedin_replies:              '#1d4ed8', // blue-700 (darker — replies are heavier outcome)
  linkedin_connections_sent:     '#93c5fd', // blue-300 (lighter — request is the lightest outcome)
  linkedin_connections_accepted: '#1e40af', // blue-800 (darkest — best LinkedIn outcome)
  email_sent:                    '#10b981', // emerald-500
  email_replies:                 '#f59e0b', // amber-500
};

// Human-readable legend / tooltip labels keyed by the chart dataKey.
const LABELS: Record<string, string> = {
  linkedin_sent:                 'Messages sent (LinkedIn)',
  linkedin_replies:              'Replies (LinkedIn)',
  linkedin_connections_sent:     'Connection requests sent',
  linkedin_connections_accepted: 'Connection requests accepted',
  email_sent:                    'Emails sent',
  email_replies:                 'Replies (Email)',
};

export function CampaignBarChart({
  data,
  range,
  selectedRange,
  partial,
}: CampaignBarChartProps) {
  // Stable order: largest "sent" first so the eye lands on the biggest
  // bar. Different platforms have different "sent" fields — LinkedIn uses
  // linkedin_sent, Smartlead uses email_sent; either may be undefined on
  // the row, so we coalesce to 0 for the sort. Falls back to name on tie.
  const chartData = useMemo<ChartDatum[]>(
    () =>
      data.slice().sort((a, b) => {
        const av = a.linkedin_sent ?? a.email_sent ?? 0;
        const bv = b.linkedin_sent ?? b.email_sent ?? 0;
        return bv - av || a.name.localeCompare(b.name);
      }),
    [data],
  );

  // Mismatch caption — only shows when both ranges are present and differ.
  // Admin previews a different range than the snapshot was generated for:
  // cards live-refresh, chart can't. The caption is honest about that.
  const rangeMismatch = !!(
    range && selectedRange && selectedRange !== range
  );

  // Empty state — either the client has no in-scope campaigns yet, or
  // everything was filtered out as zero-activity by the caller. Same
  // friendly message either way; the mismatch caption (if active) still
  // shows so a curious operator knows what's going on.
  if (chartData.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-muted-foreground text-sm space-y-2">
          <p>No campaign activity in this range.</p>
          {rangeMismatch && (
            <p className="text-xs italic">
              Chart reflects the saved {range} snapshot — Generate to update to {selectedRange}.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            Per-campaign performance{range ? ` (${range})` : ''}
          </h3>
          <p className="text-xs text-muted-foreground">
            LinkedIn campaigns (blue): messages sent, replies, connection
            requests sent + accepted. Email campaigns (green / amber):
            emails sent + replies. Snapshot's date range.
          </p>
          {rangeMismatch && (
            <p className="text-xs text-muted-foreground italic mt-1">
              Chart reflects the saved {range} snapshot — Generate to update to {selectedRange}.
            </p>
          )}
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
                  LABELS[name] ?? name,
                ]}
                labelFormatter={(label: string) => label}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value: string) => LABELS[value] ?? value}
              />
              {/* Six Bars (one per dataKey). A row whose source doesn't
                  populate a given dataKey has `undefined` for that key;
                  Recharts skips the bar entirely — no zero-height stub,
                  no broken axis. Net effect: LinkedIn rows get 4 bars,
                  Smartlead rows get 2 bars, all sharing the same x-axis. */}
              <Bar
                dataKey="linkedin_connections_sent"
                fill={COLORS.linkedin_connections_sent}
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="linkedin_connections_accepted"
                fill={COLORS.linkedin_connections_accepted}
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="linkedin_sent"
                fill={COLORS.linkedin_sent}
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="linkedin_replies"
                fill={COLORS.linkedin_replies}
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="email_sent"
                fill={COLORS.email_sent}
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="email_replies"
                fill={COLORS.email_replies}
                radius={[3, 3, 0, 0]}
              />
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
