import { IntegrationSetupCard } from './IntegrationSetupCard';
import { PlaygroundStatsGrid } from './PlaygroundStatsGrid';
import { CampaignsTable } from './CampaignsTable';

export function PlaygroundDashboard() {
  return (
    <div className="space-y-6">
      <IntegrationSetupCard />
      <div>
        <h3 className="text-lg font-semibold mb-4">Overview</h3>
        <PlaygroundStatsGrid />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-4">Synced Campaigns</h3>
        <CampaignsTable />
      </div>
    </div>
  );
}
