import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface PieChartComponentProps {
  title: string;
  data: Record<string, number>;
  othersBreakdown?: Array<{ name: string; count: number; percentage: number }>;
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--chart-6))'];

export function PieChartComponent({ title, data, othersBreakdown }: PieChartComponentProps) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));

  const content = (
    <ResponsiveContainer width="100%" height={450}>
      <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="45%"
            labelLine={true}
            label={({ name, percent, cx, cy, midAngle, outerRadius }) => {
              if (percent < 0.05) return null;
              
              const RADIAN = Math.PI / 180;
              const radius = outerRadius + 25;
              const x = cx + radius * Math.cos(-midAngle * RADIAN);
              const y = cy + radius * Math.sin(-midAngle * RADIAN);
              
              const labelText = `${name}: ${(percent * 100).toFixed(0)}%`;
              
              if (name === 'Others' && othersBreakdown && othersBreakdown.length > 0) {
                return (
                  <foreignObject x={x > cx ? x : x - 100} y={y - 12} width={100} height={24}>
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <text
                          x={x > cx ? 0 : 100}
                          y={12}
                          fill="hsl(var(--foreground))"
                          textAnchor={x > cx ? 'start' : 'end'}
                          dominantBaseline="central"
                          className="text-xs font-medium cursor-pointer underline decoration-dotted"
                          style={{ cursor: 'pointer' }}
                        >
                          {labelText}
                        </text>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-80 max-h-96 overflow-y-auto">
                        <h4 className="font-semibold mb-2">Others Breakdown</h4>
                        <div className="space-y-1 text-sm">
                          {othersBreakdown.map(({ name, count, percentage }) => (
                            <div key={name} className="flex justify-between">
                              <span>{name}</span>
                              <span className="text-muted-foreground">
                                {count} ({percentage.toFixed(1)}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  </foreignObject>
                );
              }
              
              return (
                <text 
                  x={x} 
                  y={y} 
                  fill="hsl(var(--foreground))"
                  textAnchor={x > cx ? 'start' : 'end'} 
                  dominantBaseline="central"
                  className="text-xs font-medium"
                >
                  {labelText}
                </text>
              );
            }}
            outerRadius={85}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
        <Tooltip 
          formatter={(value: number) => [
            `${value} (${((value / chartData.reduce((sum, item) => sum + item.value, 0)) * 100).toFixed(1)}%)`,
          ]}
        />
        <Legend 
          verticalAlign="bottom" 
          height={60}
          align="center"
          layout="horizontal"
          iconSize={10}
          wrapperStyle={{ paddingTop: '20px', display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '8px 16px', maxWidth: '100%' }}
          formatter={(value) => <span className="text-xs whitespace-nowrap">{value}</span>}
        />
      </PieChart>
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
