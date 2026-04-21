import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentInboxData, type AgentLead } from '@/hooks/useAgentInbox';
import { LeadDetailPanel, IntentBadge, ChannelBadge, formatRelativeTime } from './LeadDetailPanel';

type PipelineCategoryKey =
  | 'pending_action'
  | 'in_progress'
  | 'meeting_booked'
  | 'closed'
  | 'dead';

type StageDef = {
  key: PipelineCategoryKey;
  label: string;
  color: string;
  matches: (lead: AgentLead) => boolean;
};

const STAGES: StageDef[] = [
  {
    key: 'pending_action',
    label: 'Pending Action',
    color: 'bg-amber-500',
    matches: (l) => l.inbox_status === 'pending' || l.inbox_status === 'draft_ready',
  },
  {
    key: 'in_progress',
    label: 'In Progress',
    color: 'bg-blue-500',
    matches: (l) => l.pipeline_stage === 'in_progress',
  },
  {
    key: 'meeting_booked',
    label: 'Meeting Booked',
    color: 'bg-green-500',
    matches: (l) => l.pipeline_stage === 'meeting_booked',
  },
  {
    key: 'closed',
    label: 'Closed',
    color: 'bg-emerald-500',
    matches: (l) => l.pipeline_stage === 'closed',
  },
  {
    key: 'dead',
    label: 'Dead',
    color: 'bg-red-500',
    matches: (l) =>
      l.pipeline_stage === 'bad_lead' ||
      l.pipeline_stage === 'ooo' ||
      l.pipeline_stage === 'not_interested',
  },
];

const INTENTS = [
  'interested', 'not_interested', 'needs_more_info', 'out_of_office', 'unknown',
] as const;

export function AgentPipeline() {
  const { leads, counts, isLoading } = useAgentInboxData('pipeline');
  const [selectedLead, setSelectedLead] = useState<AgentLead | null>(null);
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());
  const [intentFilter, setIntentFilter] = useState<Set<string>>(new Set());
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'linkedin'>('all');
  const [search, setSearch] = useState('');

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (stageFilter.size > 0) {
        // OR across selected stages: lead must match at least one.
        const matchesAny = STAGES
          .filter((s) => stageFilter.has(s.key))
          .some((s) => s.matches(lead));
        if (!matchesAny) return false;
      }
      if (intentFilter.size > 0 && !intentFilter.has(lead.intent || 'unknown')) return false;
      if (channelFilter !== 'all' && lead.channel !== channelFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !lead.full_name?.toLowerCase().includes(q) &&
          !lead.company?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [leads, stageFilter, intentFilter, channelFilter, search]);

  const toggleFilter = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Stage count cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {STAGES.map((stage) => {
          const count = counts.by_pipeline_category?.[stage.key] ?? 0;
          const active = stageFilter.has(stage.key);
          return (
            <button
              key={stage.key}
              onClick={() => toggleFilter(stageFilter, stage.key, setStageFilter)}
              className="text-left"
            >
              <Card className={cn(
                'transition-colors cursor-pointer',
                active && 'ring-2 ring-primary'
              )}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className={cn('h-2 w-2 rounded-full', stage.color)} />
                    <span className="text-xs text-muted-foreground">{stage.label}</span>
                  </div>
                  <div className="text-2xl font-bold mt-1">{count}</div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* Intent chips */}
        <div className="flex items-center gap-1.5">
          {INTENTS.map((intent) => (
            <button
              key={intent}
              onClick={() => toggleFilter(intentFilter, intent, setIntentFilter)}
              className={cn(
                'px-2 py-1 rounded-full text-xs border transition-colors',
                intentFilter.has(intent)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-foreground'
              )}
            >
              {intent.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Channel filter */}
        <div className="flex items-center gap-1.5">
          {(['all', 'email', 'linkedin'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannelFilter(ch)}
              className={cn(
                'px-2 py-1 rounded-full text-xs border transition-colors',
                channelFilter === ch
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-foreground'
              )}
            >
              {ch === 'all' ? 'All' : ch === 'email' ? 'Email' : 'LinkedIn'}
            </button>
          ))}
        </div>
      </div>

      {/* Leads table */}
      {filteredLeads.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">
            {leads.length === 0
              ? "No leads yet. Your agent will populate this as campaigns run and replies come in."
              : "No leads match your filters."}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name & Company</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Job Title</th>
                <th className="text-left px-4 py-2 font-medium">Channel</th>
                <th className="text-left px-4 py-2 font-medium">Intent</th>
                <th className="text-left px-4 py-2 font-medium">Stage</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Last Reply</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{lead.full_name}</div>
                    {lead.company && (
                      <div className="text-xs text-muted-foreground">{lead.company}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                    {lead.job_title || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <ChannelBadge channel={lead.channel} />
                  </td>
                  <td className="px-4 py-2.5">
                    {lead.intent ? <IntentBadge intent={lead.intent} /> : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="secondary" className="text-xs">
                      {lead.pipeline_stage?.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden lg:table-cell">
                    {lead.last_reply_at ? formatRelativeTime(lead.last_reply_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide-over panel */}
      <Sheet open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <SheetContent className="w-[420px] sm:w-[480px] p-0">
          {selectedLead && (
            <LeadDetailPanel
              key={selectedLead.id}
              lead={selectedLead}
              onClose={() => setSelectedLead(null)}
              showDraft
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
