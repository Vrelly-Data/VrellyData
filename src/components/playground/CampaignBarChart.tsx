// Per-campaign sent / opens / replies for the Data Analysis report.
//
// Data source: synced_campaigns.stats (per-campaign totals populated by
// sync-{heyreach,smartlead}-campaigns). NOT the same time scope as the
// range-filtered stat cards above — these are platform-side cumulative
// totals (Smartlead: all-time; HeyReach: 30-day trailing window from the
// last sync). Labelled honestly in the subtitle to avoid confusing a
// client comparing them against the range-filtered cards.
//
// In-scope filter happens client-side after one fetch so we can compare
// the (text[]) Smartlead campaign IDs and the (int[]) HeyReach LI account
// IDs against the raw_data shape without inventing a JSONB query.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CampaignBarChartProps {
  heyreachAccountIds: number[];
  smartleadCampaignIds: string[];
}

interface CampaignRow {
  id: string;
  name: string;
  external_campaign_id: string;
  source: string;
  stats: Record<string, unknown> | null;
  raw_data: Record<string, unknown> | null;
}

interface ChartDatum {
  name: string;
  source: string;
  sent: number;
  opens: number;
  replies: number;
}

function pickNumber(obj: Record<string, unknown> | null, keys: string[]): number {
  if (!obj) return 0;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return 0;
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

export function CampaignBarChart({
  heyreachAccountIds,
  smartleadCampaignIds,
}: CampaignBarChartProps) {
  const hasScope = heyreachAccountIds.length > 0 || smartleadCampaignIds.length > 0;

  // One fetch; client-side filter. The set sizes are small (Phase 1 picker
  // limits a client to its admin's accounts and campaigns), so doing this
  // in JS is cheaper than crafting a JSONB query for the HeyReach side.
  // Query key intentionally stringifies the input arrays so react-query
  // doesn't re-fetch when the parent re-renders with new (but equal) array
  // refs.
  const query = useQuery({
    queryKey: [
      'client_analysis_in_scope_campaigns',
      JSON.stringify({ heyreachAccountIds, smartleadCampaignIds }),
    ],
    queryFn: async (): Promise<CampaignRow[]> => {
      const { data, error } = await supabase
        .from('synced_campaigns')
        .select('id, name, external_campaign_id, source, stats, raw_data')
        .eq('is_linked', true);
      if (error) throw error;
      const all = (data ?? []) as unknown as CampaignRow[];

      const smartleadSet = new Set(smartleadCampaignIds);
      const heyreachAccountSet = new Set(heyreachAccountIds.map(Number));

      return all.filter((c) => {
        if (c.source === 'smartlead') {
          return smartleadSet.has(c.external_campaign_id);
        }
        if (c.source === 'heyreach') {
          const linked = (c.raw_data?.linkedInAccountIds ?? c.raw_data?.accountIds);
          if (!Array.isArray(linked)) return false;
          return linked.some((id) => heyreachAccountSet.has(Number(id)));
        }
        return false;
      });
    },
    enabled: hasScope,
    staleTime: 60_000,
  });

  const chartData = useMemo<ChartDatum[]>(() => {
    const rows = query.data ?? [];
    return rows
      .map((c) => ({
        name: c.name || 'Unnamed',
        source: c.source,
        sent: pickNumber(c.stats, ['sent', 'delivered']),
        opens: pickNumber(c.stats, ['opens', 'opened']),
        replies: pickNumber(c.stats, ['replies', 'replied']),
      }))
      // Stable order: largest "sent" first so the eye lands on the biggest
      // bar. Falls back to name when sent ties (cheap deterministic sort).
      .sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
  }, [query.data]);

  if (!hasScope) {
    return null;
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Per-campaign performance</h3>
          <p className="text-xs text-muted-foreground">
            Sent, opens, and replies per campaign (cumulative from platform sync;
            separate from the range filter above).
          </p>
        </div>

        {query.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : query.error ? (
          <p className="text-xs text-destructive">
            Failed to load campaign stats: {(query.error as Error).message}
          </p>
        ) : chartData.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No campaign-level data available yet. Sync your integrations to populate.
          </p>
        ) : (
          // Height scales with row count so a 1-2-campaign client doesn't
          // get a huge empty plot. Capped so 10+ campaigns still fit.
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
        )}
      </CardContent>
    </Card>
  );
}
