import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface PieChartComponentProps {
  title: string;
  data: Record<string, number>;
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export function PieChartComponent({ title, data }: PieChartComponentProps) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));

  const content = (
    <ResponsiveContainer width="100%" height={350}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
          outerRadius={100}
          fill="#8884d8"
          dataKey="value"
        >
          {chartData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
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
