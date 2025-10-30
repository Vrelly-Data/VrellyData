import { useState, useEffect } from 'react';
import { ChartWithToggle } from './charts/ChartWithToggle';
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

  const { data: topIndustries, othersBreakdown: industryOthers } = AnalyticsService.getTopN(insights.industryDistribution, 5);
  const { data: topSeniority, othersBreakdown: seniorityOthers } = AnalyticsService.getTopN(insights.seniorityDistribution, 5);
  const { data: topTitles, othersBreakdown: titlesOthers } = AnalyticsService.getTopN(insights.titleDistribution, 5);
  const { data: topLocations, othersBreakdown: locationsOthers } = AnalyticsService.getTopN(insights.locationDistribution, 5);

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="grid gap-6 md:grid-cols-2">
        <ChartWithToggle
          title="Industry Breakdown"
          data={topIndustries}
          defaultType="pie"
          othersBreakdown={industryOthers}
        />
        <ChartWithToggle
          title="Seniority Breakdown"
          data={topSeniority}
          defaultType="pie"
          othersBreakdown={seniorityOthers}
        />
      </div>
      
      <div className="grid gap-6 md:grid-cols-2">
        <ChartWithToggle
          title="Job Title Breakdown"
          data={topTitles}
          defaultType="bar"
          othersBreakdown={titlesOthers}
        />
        <ChartWithToggle
          title="Geography Breakdown"
          data={topLocations}
          defaultType="bar"
          othersBreakdown={locationsOthers}
        />
      </div>
    </div>
  );
}
