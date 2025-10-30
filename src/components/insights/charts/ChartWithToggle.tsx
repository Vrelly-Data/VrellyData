import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PieChart as PieChartIcon, BarChart3 } from 'lucide-react';
import { PieChartComponent } from './PieChartComponent';
import { BarChartComponent } from './BarChartComponent';

interface ChartWithToggleProps {
  title: string;
  data: Record<string, number>;
  defaultType?: 'pie' | 'bar';
}

export function ChartWithToggle({ title, data, defaultType = 'pie' }: ChartWithToggleProps) {
  const [chartType, setChartType] = useState<'pie' | 'bar'>(defaultType);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <ToggleGroup 
            type="single" 
            value={chartType} 
            onValueChange={(value) => value && setChartType(value as 'pie' | 'bar')}
          >
            <ToggleGroupItem value="pie" aria-label="Pie chart">
              <PieChartIcon className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="bar" aria-label="Bar chart">
              <BarChart3 className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        {chartType === 'pie' ? (
          <PieChartComponent title="" data={data} />
        ) : (
          <BarChartComponent title="" data={data} />
        )}
      </CardContent>
    </Card>
  );
}
