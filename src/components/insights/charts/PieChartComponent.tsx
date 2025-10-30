import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface PieChartComponentProps {
  title: string;
  data: Record<string, number>;
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--chart-6))'];
const MARGIN = { top: 20, right: 80, bottom: 20, left: 80 };
const SAFE_PAD = 8;

export function PieChartComponent({ title, data }: PieChartComponentProps) {
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setDims({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));

  const content = (
    <div ref={containerRef} style={{ width: "100%", height: 450 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={MARGIN}>
          <Pie
            data={chartData}
            cx="50%"
            cy="45%"
            labelLine={true}
            label={({ name, percent, cx, cy, midAngle, outerRadius }) => {
              if (percent < 0.05) return null;
              
              const RADIAN = Math.PI / 180;
              const radius = outerRadius + 25;
              let x = cx + radius * Math.cos(-midAngle * RADIAN);
              let y = cy + radius * Math.sin(-midAngle * RADIAN);
              
              // Clamp coordinates to prevent cutoff
              const minX = MARGIN.left + SAFE_PAD;
              const maxX = Math.max(minX, dims.width - MARGIN.right - SAFE_PAD);
              const minY = MARGIN.top + SAFE_PAD;
              const maxY = Math.max(minY, dims.height - MARGIN.bottom - SAFE_PAD);
              x = Math.min(maxX, Math.max(minX, x));
              y = Math.min(maxY, Math.max(minY, y));
              
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
          height={60}
          align="center"
          layout="horizontal"
          iconSize={10}
          wrapperStyle={{ paddingTop: '20px', display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '8px 16px', maxWidth: '100%' }}
          formatter={(value) => <span className="text-xs whitespace-nowrap">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
    </div>
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
