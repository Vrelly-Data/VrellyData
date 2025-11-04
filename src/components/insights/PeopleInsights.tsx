import { useState, useEffect } from 'react';
import { ChartWithToggle } from './charts/ChartWithToggle';
import { AnalyticsService, PeopleInsights as Insights } from '@/lib/analytics';
import { PersonEntity } from '@/types/audience';

interface PeopleInsightsProps {
  records: PersonEntity[];
}

export function PeopleInsights({ records }: PeopleInsightsProps) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const calculated = AnalyticsService.calculatePeopleInsights(records);
    setInsights(calculated);
    setLoading(false);
  }, [records]);

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
