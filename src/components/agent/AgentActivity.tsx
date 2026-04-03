import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  Loader2, MessageSquare, PenSquare, CheckCircle,
  ArrowRight, Rocket, Zap, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentActivity, useAgentInboxData, type AgentActivityItem, type AgentLead } from '@/hooks/useAgentInbox';
import { LeadDetailPanel, formatRelativeTime } from './LeadDetailPanel';

const ACTIVITY_ICONS: Record<string, { icon: typeof MessageSquare; color: string }> = {
  reply_received: { icon: MessageSquare, color: 'text-blue-500' },
  draft_created: { icon: PenSquare, color: 'text-amber-500' },
  message_approved: { icon: CheckCircle, color: 'text-green-500' },
  message_sent: { icon: CheckCircle, color: 'text-green-600' },
  lead_stage_changed: { icon: ArrowRight, color: 'text-gray-500' },
  campaign_routed: { icon: Rocket, color: 'text-purple-500' },
  agent_run_completed: { icon: Zap, color: 'text-emerald-500' },
  contact_added: { icon: MessageSquare, color: 'text-blue-400' },
  agent_paused: { icon: Zap, color: 'text-gray-500' },
  agent_resumed: { icon: Zap, color: 'text-green-500' },
};

const TYPE_OPTIONS = [
  { value: '', label: 'All Activity' },
  { value: 'reply_received', label: 'Replies Received' },
  { value: 'draft_created', label: 'Drafts Created' },
  { value: 'message_approved', label: 'Messages Approved' },
  { value: 'lead_stage_changed', label: 'Stage Changes' },
  { value: 'campaign_routed', label: 'Campaign Routed' },
];

function getDefaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

export function AgentActivity() {
  const defaults = getDefaultDateRange();
  const [typeFilter, setTypeFilter] = useState('');
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(100);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const { data, isLoading } = useAgentActivity({
    type: typeFilter || undefined,
    from: fromDate ? new Date(fromDate).toISOString() : undefined,
    to: toDate ? new Date(toDate + 'T23:59:59').toISOString() : undefined,
    search: search || undefined,
    limit,
  });

  // Get pipeline data to resolve lead details for slide-over
  const { leads: allLeads } = useAgentInboxData('pipeline');

  const activities = (data?.leads || []) as AgentActivityItem[];
  const counts = data?.counts;

  // Stats
  const statCards = [
    { label: 'Total Activities', value: activities.length },
    { label: 'Replies Received', value: activities.filter((a) => a.activity_type === 'reply_received').length },
    { label: 'Drafts Created', value: activities.filter((a) => a.activity_type === 'draft_created').length },
    { label: 'Messages Approved', value: activities.filter((a) => a.activity_type === 'message_approved').length },
  ];

  const selectedLead = selectedLeadId
    ? allLeads.find((l) => l.id === selectedLeadId) || null
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-2xl font-bold mt-1">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="w-[150px] h-9"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="w-[150px] h-9"
        />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="All Activity" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Activity feed */}
      {activities.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">
            No activity yet. Activity will appear here as your agent works.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {activities.map((activity) => {
            const iconDef = ACTIVITY_ICONS[activity.activity_type] || ACTIVITY_ICONS.reply_received;
            const Icon = iconDef.icon;
            return (
              <button
                key={activity.id}
                onClick={() => {
                  if (activity.lead_id) setSelectedLeadId(activity.lead_id);
                }}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3 rounded-lg text-left transition-colors',
                  activity.lead_id ? 'hover:bg-muted/50 cursor-pointer' : 'cursor-default'
                )}
              >
                <div className={cn('mt-0.5 shrink-0', iconDef.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    {formatDescription(activity.description, activity.lead_name)}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatRelativeTime(activity.created_at)}
                </span>
              </button>
            );
          })}

          {activities.length >= limit && (
            <div className="text-center py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((l) => l + 100)}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Lead detail slide-over */}
      <Sheet open={!!selectedLead} onOpenChange={() => setSelectedLeadId(null)}>
        <SheetContent className="w-[420px] sm:w-[480px] p-0">
          {selectedLead && (
            <LeadDetailPanel
              key={selectedLead.id}
              lead={selectedLead}
              onClose={() => setSelectedLeadId(null)}
              showDraft
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Bold the lead name in the description
function formatDescription(description: string, leadName: string | null) {
  if (!leadName || !description.includes(leadName)) {
    return description;
  }
  const parts = description.split(leadName);
  return (
    <>
      {parts[0]}
      <span className="font-semibold">{leadName}</span>
      {parts.slice(1).join(leadName)}
    </>
  );
}
