import { useState } from 'react';
import { LayoutDashboard, Inbox, Kanban, ActivitySquare, BookOpen, Settings, Telescope } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { AgentOverview } from './AgentOverview';
import { AgentInbox } from './AgentInbox';
import { AgentPipeline } from './AgentPipeline';
import { AgentAudience } from './AgentAudience';
import { AgentActivity } from './AgentActivity';
import { SalesPlaybook } from './SalesPlaybook';
import { AgentSettings } from './AgentSettings';
import { useAgentInboxData } from '@/hooks/useAgentInbox';
import { cn } from '@/lib/utils';

type View = 'overview' | 'inbox' | 'pipeline' | 'audience' | 'activity' | 'sales_playbook' | 'settings';

const navItems: { key: View; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'pipeline', label: 'Pipeline', icon: Kanban },
  { key: 'audience', label: 'Audience', icon: Telescope },
  { key: 'activity', label: 'Activity', icon: ActivitySquare },
  { key: 'sales_playbook', label: 'Sales Playbook', icon: BookOpen },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export function AgentWorkspace() {
  const [activeView, setActiveView] = useState<View>('overview');
  const { counts } = useAgentInboxData('inbox');

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
            <span className="flex-1">{item.label}</span>
            {item.key === 'inbox' && counts.needs_attention > 0 && (
              <Badge variant="destructive" className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold">
                {counts.needs_attention}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Right content area */}
      <div className="flex-1 overflow-auto">
        {activeView === 'overview' && <AgentOverview />}
        {activeView === 'inbox' && <AgentInbox />}
        {activeView === 'pipeline' && <AgentPipeline />}
        {activeView === 'audience' && <AgentAudience />}
        {activeView === 'activity' && <AgentActivity />}
        {activeView === 'sales_playbook' && <SalesPlaybook />}
        {activeView === 'settings' && <AgentSettings />}
      </div>
    </div>
  );
}
