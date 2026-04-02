import { useState } from 'react';
import { LayoutDashboard, Inbox, Kanban, Rocket, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AgentOverview } from './AgentOverview';
import { AgentSettings } from './AgentSettings';
import { cn } from '@/lib/utils';

type View = 'overview' | 'inbox' | 'pipeline' | 'campaigns' | 'settings';

const navItems: { key: View; label: string; icon: typeof LayoutDashboard; badge?: boolean }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'inbox', label: 'Inbox', icon: Inbox, badge: true },
  { key: 'pipeline', label: 'Pipeline', icon: Kanban },
  { key: 'campaigns', label: 'Campaigns', icon: Rocket },
  { key: 'settings', label: 'Settings', icon: Settings },
];

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon — this feature will be available in Phase 2.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function AgentWorkspace() {
  const [activeView, setActiveView] = useState<View>('overview');

  return (
    <div className="flex h-full min-h-[calc(100vh-3rem)]">
      {/* Left sidebar nav */}
      <div className="w-56 border-r bg-muted/30 flex flex-col py-4 px-2 shrink-0">
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setActiveView(item.key)}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors w-full text-left',
              activeView === item.key
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Right content area */}
      <div className="flex-1 overflow-auto">
        {activeView === 'overview' && <AgentOverview />}
        {activeView === 'inbox' && <ComingSoon title="Inbox" />}
        {activeView === 'pipeline' && <ComingSoon title="Pipeline" />}
        {activeView === 'campaigns' && <ComingSoon title="Campaigns" />}
        {activeView === 'settings' && <AgentSettings />}
      </div>
    </div>
  );
}
