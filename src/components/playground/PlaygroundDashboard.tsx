import { useState } from 'react';
import { IntegrationSetupCard } from './IntegrationSetupCard';
import { PlaygroundStatsGrid } from './PlaygroundStatsGrid';
import { CampaignsTable } from './CampaignsTable';
import { BuildAudienceDialog } from './BuildAudienceDialog';
import { CreateCopyDialog } from './CreateCopyDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, Target } from 'lucide-react';

export function PlaygroundDashboard() {
  const [buildAudienceOpen, setBuildAudienceOpen] = useState(false);
  const [createCopyOpen, setCreateCopyOpen] = useState(false);

  return (
    <div className="space-y-6">
      <IntegrationSetupCard />

      {/* AI Tools */}
      <div>
        <h3 className="text-lg font-semibold mb-4">AI Tools</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Generate Copy
              </CardTitle>
              <CardDescription>
                AI-powered email copy generation trained on your best-performing sequences and sales knowledge base.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button size="sm" onClick={() => setCreateCopyOpen(true)}>
                <Sparkles className="h-4 w-4 mr-2" />
                Create New Copy
              </Button>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Build Audience
              </CardTitle>
              <CardDescription>
                Define your ideal customer profile and instantly find matching prospects from our database with AI insights.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button size="sm" onClick={() => setBuildAudienceOpen(true)}>
                <Target className="h-4 w-4 mr-2" />
                Build Audience
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Overview</h3>
        <PlaygroundStatsGrid />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-4">Synced Campaigns</h3>
        <CampaignsTable />
      </div>

      <BuildAudienceDialog open={buildAudienceOpen} onOpenChange={setBuildAudienceOpen} />
      <CreateCopyDialog open={createCopyOpen} onOpenChange={setCreateCopyOpen} />
    </div>
  );
}
