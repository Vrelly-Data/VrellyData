import { useEffect } from 'react';
import { useAgentConfig, useUpsertAgentConfig } from '@/hooks/useAgent';
import { useAgentInboxData } from '@/hooks/useAgentInbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Users,
  Clock,
  CalendarCheck,
  Activity,
  Pause,
  Play,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';

// Bar-chart column colors — mirror the semantic mapping used in AgentPipeline.
const PIPELINE_CHART_CONFIG = [
  { key: 'pending_action' as const,  label: 'Pending Action',  color: '#f59e0b' },
  { key: 'in_progress' as const,     label: 'In Progress',     color: '#3b82f6' },
  { key: 'meeting_booked' as const,  label: 'Meeting Booked',  color: '#22c55e' },
  { key: 'closed' as const,          label: 'Closed',          color: '#10b981' },
  { key: 'dead' as const,            label: 'Dead',            color: '#ef4444' },
];

export function AgentOverview() {
  const { data: config, isLoading: configLoading } = useAgentConfig();
  const upsertConfig = useUpsertAgentConfig();
  const { counts, isLoading: inboxLoading, refetch } = useAgentInboxData('inbox');

  // Always fetch fresh data when Overview mounts
  useEffect(() => {
    refetch();
  }, [refetch]);

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

  const pendingApprovalCount = counts.by_status_group?.pending_approval ?? 0;
  const leadActivityCount = counts.by_status_group?.total_inbox ?? 0;

  const statCards = [
    {
      label: 'Leads in Pipeline',
      value: counts.total,
      icon: Users,
      color: '',
    },
    {
      label: 'Pending Approval',
      value: pendingApprovalCount,
      icon: Clock,
      color: pendingApprovalCount > 0 ? 'text-amber-600' : '',
    },
    {
      label: 'Meetings Booked',
      value: counts.by_stage.meeting_booked || 0,
      icon: CalendarCheck,
      color: '',
    },
    {
      label: 'Lead Activity',
      value: leadActivityCount,
      icon: Activity,
      color: '',
    },
  ];

  // Pipeline bar-chart data — driven by counts.by_pipeline_category
  const chartData = PIPELINE_CHART_CONFIG.map((c) => ({
    name: c.label,
    count: counts.by_pipeline_category?.[c.key] ?? 0,
    color: c.color,
  }));

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
              <p className="text-xs text-muted-foreground mt-2">Next run: {(() => {
                const now = new Date();
                const day = now.getUTCDay();
                const daysUntilMon = day === 0 ? 1 : day === 1 && now.getUTCHours() < 7 ? 0 : 8 - day;
                const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMon, 7, 0, 0));
                return `Mon ${next.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} at 7:00 AM UTC`;
              })()}</p>
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

      {/* Pipeline snapshot — bar chart by pipeline category */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Pipeline Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
              <XAxis
                dataKey="name"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                fontSize={12}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                stroke="hsl(var(--muted-foreground))"
              />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
