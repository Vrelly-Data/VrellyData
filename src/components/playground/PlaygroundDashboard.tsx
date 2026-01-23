import { IntegrationSetupCard } from './IntegrationSetupCard';
import { PlaygroundStatsGrid } from './PlaygroundStatsGrid';

export function PlaygroundDashboard() {
  return (
    <div className="space-y-6">
      <IntegrationSetupCard />
      <div>
        <h3 className="text-lg font-semibold mb-4">Overview</h3>
        <PlaygroundStatsGrid />
      </div>
    </div>
  );
}
