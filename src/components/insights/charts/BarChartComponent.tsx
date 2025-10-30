import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, TooltipProps } from 'recharts';

interface BarChartComponentProps {
  title: string;
  data: Record<string, number>;
  xAxisLabel?: string;
  yAxisLabel?: string;
  othersBreakdown?: Array<{ name: string; count: number; percentage: number }>;
}

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
];

export function BarChartComponent({ title, data, xAxisLabel, yAxisLabel, othersBreakdown }: BarChartComponentProps) {
  const chartData = Object.entries(data).map(([name, value], index) => ({ 
    name, 
    value,
    fill: COLORS[index % COLORS.length]
  }));

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
    
    return (
      <div className="bg-popover border rounded-md p-2 shadow-md">
        <p className="text-sm">{`${name}: ${item.value}`}</p>
      </div>
    );
  };

  const content = (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis 
          dataKey="name" 
          angle={-45}
          textAnchor="end"
          height={80}
          interval={0}
          tick={{ fontSize: 11 }}
        />
        <YAxis label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="value" />
      </BarChart>
    </ResponsiveContainer>
  );

  if (!title) return content;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
}
