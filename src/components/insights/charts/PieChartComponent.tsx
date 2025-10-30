import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface PieChartComponentProps {
  title: string;
  data: Record<string, number>;
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--chart-6))'];

export function PieChartComponent({ title, data }: PieChartComponentProps) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));

  const content = (
    <ResponsiveContainer width="100%" height={450}>
      <PieChart margin={{ top: 20, right: 80, bottom: 20, left: 80 }}>
        <Pie
          data={chartData}
          cx="50%"
          cy="45%"
          labelLine={true}
          label={({ name, percent, cx, cy, midAngle, outerRadius }) => {
            const RADIAN = Math.PI / 180;
            const radius = outerRadius + 25;
            const x = cx + radius * Math.cos(-midAngle * RADIAN);
            const y = cy + radius * Math.sin(-midAngle * RADIAN);
            
            if (percent < 0.05) return null;
            
            return (
              <text 
                x={x} 
                y={y} 
                fill="hsl(var(--foreground))"
                textAnchor={x > cx ? 'start' : 'end'} 
                dominantBaseline="central"
                className="text-xs font-medium"
              >
                {`${name}: ${(percent * 100).toFixed(0)}%`}
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
          height={50}
          align="left"
          layout="horizontal"
          iconSize={12}
          wrapperStyle={{ paddingTop: '20px', display: 'flex', justifyContent: 'space-evenly', gap: '16px' }}
          formatter={(value) => <span className="text-sm">{value}</span>}
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
