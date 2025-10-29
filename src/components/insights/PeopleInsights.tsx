import { useState, useEffect } from 'react';
import { Users, TrendingUp, Briefcase, MapPin } from 'lucide-react';
import { SummaryCard } from './charts/SummaryCard';
import { PieChartComponent } from './charts/PieChartComponent';
import { BarChartComponent } from './charts/BarChartComponent';
import { AnalyticsService, PeopleInsights as Insights } from '@/lib/analytics';
import { PersonEntity } from '@/types/audience';
import { generateMockPeople } from '@/lib/mockData';

export function PeopleInsights() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mock data for now
    const mockPeople: PersonEntity[] = generateMockPeople(500);
    const calculated = AnalyticsService.calculatePeopleInsights(mockPeople);
    setInsights(calculated);
    setLoading(false);
  }, []);

  if (loading || !insights) {
    return <div className="p-6">Loading insights...</div>;
  }

  const topIndustries = AnalyticsService.getTopN(insights.industryDistribution, 10);
  const topTitles = AnalyticsService.getTopN(insights.titleDistribution, 10);
  const topLocations = AnalyticsService.getTopN(insights.locationDistribution, 10);

  const mostCommonIndustry = Object.entries(insights.industryDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
  const mostCommonLocation = Object.entries(insights.locationDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Total People"
          value={insights.total.toLocaleString()}
          icon={Users}
        />
        <SummaryCard
          title="Top Industry"
          value={mostCommonIndustry}
          icon={Briefcase}
        />
        <SummaryCard
          title="Top Location"
          value={mostCommonLocation}
          icon={MapPin}
        />
        <SummaryCard
          title="Growth"
          value="+12.5%"
          icon={TrendingUp}
          description="vs last month"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PieChartComponent
          title="Industry Distribution"
          data={topIndustries}
        />
        <PieChartComponent
          title="Seniority Breakdown"
          data={insights.seniorityDistribution}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarChartComponent
          title="Top Job Titles"
          data={topTitles}
          xAxisLabel="Job Title"
          yAxisLabel="Count"
        />
        <BarChartComponent
          title="Geographic Distribution"
          data={topLocations}
          xAxisLabel="Location"
          yAxisLabel="Count"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarChartComponent
          title="Department Distribution"
          data={insights.departmentDistribution}
          xAxisLabel="Department"
          yAxisLabel="Count"
        />
        <PieChartComponent
          title="Gender Distribution"
          data={insights.genderDistribution}
        />
      </div>
    </div>
  );
}
