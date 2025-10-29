import { useState, useEffect } from 'react';
import { Building2, TrendingUp, Users, DollarSign } from 'lucide-react';
import { SummaryCard } from './charts/SummaryCard';
import { PieChartComponent } from './charts/PieChartComponent';
import { BarChartComponent } from './charts/BarChartComponent';
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

  const topIndustries = AnalyticsService.getTopN(insights.industryDistribution, 10);
  const topLocations = AnalyticsService.getTopN(insights.locationDistribution, 10);

  const mostCommonIndustry = Object.entries(insights.industryDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Total Companies"
          value={insights.total.toLocaleString()}
          icon={Building2}
        />
        <SummaryCard
          title="Top Industry"
          value={mostCommonIndustry}
          icon={DollarSign}
        />
        <SummaryCard
          title="Avg Employee Count"
          value="245"
          icon={Users}
        />
        <SummaryCard
          title="Growth"
          value="+8.2%"
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
          title="Funding Stage Distribution"
          data={insights.fundingStageDistribution}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarChartComponent
          title="Employee Size Distribution"
          data={insights.employeeSizeDistribution}
          xAxisLabel="Employee Range"
          yAxisLabel="Count"
        />
        <BarChartComponent
          title="Geographic Distribution"
          data={topLocations}
          xAxisLabel="Location"
          yAxisLabel="Count"
        />
      </div>
    </div>
  );
}
