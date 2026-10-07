import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlatformTotalsCard } from '@/components/admin/PlatformTotalsCard';
import { LiveFeedSection } from '@/components/admin/inference/LiveFeedSection';
import { InferenceSection } from '@/components/admin/inference/InferenceSection';

// Admin → Inference Insights. Inactive tabs unmount, so the Live Feed's Realtime subscription
// and the Inference dataset only load while their tab is open.
export function InferenceTab() {
  return (
    <Tabs defaultValue="totals" className="space-y-4">
      <TabsList>
        <TabsTrigger value="totals">Platform Totals</TabsTrigger>
        <TabsTrigger value="live">Live Feed</TabsTrigger>
        <TabsTrigger value="inference">Inference</TabsTrigger>
      </TabsList>
      <TabsContent value="totals">
        <PlatformTotalsCard />
      </TabsContent>
      <TabsContent value="live">
        <LiveFeedSection />
      </TabsContent>
      <TabsContent value="inference">
        <InferenceSection />
      </TabsContent>
    </Tabs>
  );
}
