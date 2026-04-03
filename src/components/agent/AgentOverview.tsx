import { useAgentConfig, useUpsertAgentConfig } from '@/hooks/useAgent';
import { useAgentInboxData, type AgentCounts } from '@/hooks/useAgentInbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Users, AlertTriangle, CalendarCheck, Zap, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

const STAGE_COLORS: Record<string, string> = {
  contacted: 'bg-gray-400',
  replied: 'bg-blue-500',
  engaged: 'bg-amber-500',
  meeting_booked: 'bg-green-500',
  closed: 'bg-emerald-500',
  dead: 'bg-red-500',
};

const STAGE_LABELS: Record<string, string> = {
  contacted: 'Contacted',
  replied: 'Replied',
  engaged: 'Engaged',
  meeting_booked: 'Meeting Booked',
  closed: 'Closed',
  dead: 'Dead',
};

export function AgentOverview() {
  const { data: config, isLoading: configLoading } = useAgentConfig();
  const upsertConfig = useUpsertAgentConfig();
  const { counts, isLoading: inboxLoading } = useAgentInboxData('inbox');

  const isLoading = configLoading || inboxLoading;

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const toggleActive = () => {
    upsertConfig.mutate({
      company_name: config.company_name,
      sender_name: config.sender_name,
      offer_description: config.offer_description,
      is_active: !config.is_active,
    });
  };

  const statCards = [
    {
      label: 'Leads in Pipeline',
      value: counts.total,
      icon: Users,
      color: '',
    },
    {
      label: 'Needs Attention',
      value: counts.needs_attention,
      icon: AlertTriangle,
      color: counts.needs_attention > 0 ? 'text-amber-600' : '',
    },
    {
      label: 'Meetings Booked',
      value: counts.by_stage.meeting_booked || 0,
      icon: CalendarCheck,
      color: '',
    },
    {
      label: 'Auto-handled',
      value: counts.auto_handled,
      icon: Zap,
      color: '',
    },
  ];

  // Pipeline bar data
  const stages = ['contacted', 'replied', 'engaged', 'meeting_booked', 'closed', 'dead'];
  const totalForBar = stages.reduce((sum, s) => sum + (counts.by_stage[s] || 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h2 className="text-2xl font-semibold">Overview</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <stat.icon className={cn('h-4 w-4 text-muted-foreground', stat.color)} />
                <span className="text-xs text-muted-foreground">{stat.label}</span>
              </div>
              <div className={cn('text-3xl font-bold mt-2', stat.color)}>
                {stat.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Agent status card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-lg">{config.sender_name}'s Agent</h3>
              <p className="text-sm text-muted-foreground">{config.company_name}</p>
              <div className="flex items-center gap-2 mt-3">
                <Badge variant={config.mode === 'auto' ? 'default' : 'secondary'} className="text-xs">
                  {config.mode === 'auto' ? 'Auto' : 'Co-pilot'}
                </Badge>
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    'h-2 w-2 rounded-full',
                    config.is_active ? 'bg-green-500' : 'bg-gray-400'
                  )} />
                  <span className="text-sm text-muted-foreground">
                    {config.is_active ? 'Active' : 'Paused'}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Next run: Monday at 6:00 AM</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleActive}
              disabled={upsertConfig.isPending}
              className="gap-2"
            >
              {config.is_active ? (
                <><Pause className="h-3.5 w-3.5" /> Pause</>
              ) : (
                <><Play className="h-3.5 w-3.5" /> Resume</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline snapshot */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Pipeline Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          {totalForBar === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leads in the pipeline yet. Leads will appear here as campaigns run.
            </p>
          ) : (
            <>
              <div className="flex rounded-full overflow-hidden h-6">
                {stages.map((stage) => {
                  const count = counts.by_stage[stage] || 0;
                  if (count === 0) return null;
                  const pct = (count / totalForBar) * 100;
                  return (
                    <div
                      key={stage}
                      className={cn('flex items-center justify-center text-[10px] font-medium text-white', STAGE_COLORS[stage])}
                      style={{ width: `${pct}%`, minWidth: count > 0 ? '24px' : 0 }}
                      title={`${STAGE_LABELS[stage]}: ${count}`}
                    >
                      {pct > 8 ? count : ''}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-3 flex-wrap">
                {stages.map((stage) => {
                  const count = counts.by_stage[stage] || 0;
                  if (count === 0) return null;
                  return (
                    <div key={stage} className="flex items-center gap-1.5">
                      <div className={cn('h-2.5 w-2.5 rounded-sm', STAGE_COLORS[stage])} />
                      <span className="text-xs text-muted-foreground">
                        {STAGE_LABELS[stage]} ({count})
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
