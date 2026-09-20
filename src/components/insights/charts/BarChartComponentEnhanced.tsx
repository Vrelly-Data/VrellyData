import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
  LabelList,
} from 'recharts';

type Metrics = { denom?: number; interested?: number; rate?: number };

interface BarChartComponentProps {
  title: string;
  data: Record<string, number>;
  xAxisLabel?: string;
  yAxisLabel?: string;
  othersBreakdown?: Array<{ name: string; count: number; percentage: number }>;
  /** Names that should appear visually de-emphasized due to low sample size */
  weakNames?: string[];
  /** Per-category metrics to enrich tooltip and labels */
  metricsByName?: Record<string, Metrics>;
  /**
   * Chart layout. 'horizontal' (default Recharts) renders vertical bars with X on bottom.
   * 'vertical' renders horizontal bars with categories on Y axis.
   * When 'auto' (default), long labels or many categories force vertical layout (horizontal bars).
   */
  layout?: 'horizontal' | 'vertical' | 'auto';
  /** Show compact "(n=…)" label when metrics are available. Defaults to true. */
  showCountLabel?: boolean;
}

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
];

export function BarChartComponent({
  title,
  data,
  xAxisLabel,
  yAxisLabel,
  othersBreakdown,
  weakNames,
  metricsByName,
  layout = 'auto',
  showCountLabel = true,
}: BarChartComponentProps) {
  const weak = new Set(weakNames ?? []);
  const entries = Object.entries(data);
  const maxNameLen = entries.reduce((m, [n]) => Math.max(m, String(n).length), 0);
  const categoryCount = entries.length;
  const useHorizontalBars =
    layout === 'vertical'
      ? true
      : layout === 'horizontal'
      ? false
      : maxNameLen > 14 || categoryCount > 8; // auto heuristic for readability

  const chartData = entries.map(([name, value], index) => {
    const m = metricsByName?.[name] ?? {};
    const nLabel =
      showCountLabel && (m?.denom ?? 0) > 0
        ? `(n=${m.denom})`
        : undefined;
    return {
      name,
      value,
      fill: weak.has(name) ? 'hsl(var(--muted-foreground))' : COLORS[index % COLORS.length],
      denom: m?.denom ?? null,
      interested: m?.interested ?? null,
      rate: m?.rate ?? null,
      nLabelText: nLabel,
    };
  });

  const CustomTooltip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload || !payload.length) return null;
    const item = payload[0];
    const name = item.payload.name;

    if (name === 'Others' && othersBreakdown && othersBreakdown.length > 0) {
      return (
        <div className="bg-popover border rounded-md p-3 shadow-md">
          <p className="font-semibold mb-2">{name}: {item.value}</p>
          <div className="border-t pt-2 mt-2 max-h-60 overflow-y-auto">
            <p className="text-xs font-semibold mb-1">Breakdown:</p>
            {othersBreakdown.map(({ name, count, percentage }) => (
              <div key={name} className="flex justify-between text-xs gap-4">
                <span>{name}</span>
                <span className="text-muted-foreground">
                  {count} ({percentage.toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    const denom = item.payload?.denom as number | null | undefined;
    const interested = item.payload?.interested as number | null | undefined;
    const rate = (item.value as number) ?? (item.payload?.rate as number | null | undefined);
    const isWeak = weak.has(name);

    return (
      <div className="bg-popover border rounded-md p-2 shadow-md">
        <p className="text-sm font-medium">{name}</p>
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>Rate: {typeof rate === 'number' ? `${rate.toFixed(1)}%` : String(item.value)}</div>
          {typeof interested === 'number' && typeof denom === 'number' && (
            <div>Interested: {interested} • Denominator: {denom}</div>
          )}
          {typeof denom === 'number' && isWeak && <div className="italic">Below threshold (n={denom})</div>}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={chartData}
            layout={useHorizontalBars ? 'vertical' : 'horizontal'}
            margin={{ left: 16, right: 16, bottom: useHorizontalBars ? 16 : 24, top: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            {useHorizontalBars ? (
              <>
                <XAxis type="number" domain={[0, 'auto']} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={Math.min(320, Math.max(100, maxNameLen * 7))}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="name"
                  angle={-40}
                  height={84}
                  interval={0}
                  tickMargin={12}
                />
                <YAxis label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined} />
              </>
            )}
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value">
              {Boolean(showCountLabel && metricsByName) && (
                <LabelList
                  dataKey="nLabelText"
                  position={useHorizontalBars ? 'right' : 'top'}
                  className="text-[10px] fill-muted-foreground"
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

