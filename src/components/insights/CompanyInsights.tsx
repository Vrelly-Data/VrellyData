import { useState, useEffect } from 'react';
import { ChartWithToggle } from './charts/ChartWithToggle';
import { AnalyticsService, CompanyInsights as Insights } from '@/lib/analytics';
import { CompanyEntity } from '@/types/audience';
import { generateMockCompanies } from '@/lib/mockData';

export function CompanyInsights() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mock data for now
    const mockCompanies: CompanyEntity[] = generateMockCompanies(300);
    const calculated = AnalyticsService.calculateCompanyInsights(mockCompanies);
    setInsights(calculated);
    setLoading(false);
  }, []);

  if (loading || !insights) {
    return <div className="p-6">Loading insights...</div>;
  }

  const topIndustries = AnalyticsService.getTopN(insights.industryDistribution, 5);
  const topLocations = AnalyticsService.getTopN(insights.locationDistribution, 5);

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="grid gap-6 md:grid-cols-2">
        <ChartWithToggle
          title="Industry Breakdown"
          data={topIndustries}
          defaultType="pie"
        />
        <ChartWithToggle
          title="Geography Breakdown"
          data={topLocations}
          defaultType="bar"
        />
      </div>
    </div>
  );
}
