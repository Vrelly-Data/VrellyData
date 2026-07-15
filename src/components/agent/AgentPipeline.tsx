import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentInboxData, type AgentLead } from '@/hooks/useAgentInbox';
import { LeadDetailPanel, PIPELINE_STAGES } from './LeadDetailPanel';
import { PipelineBoard, DEAL_STAGES } from './PipelineBoard';

// The stage filter cards mirror the board's 8 columns exactly (tags == stages).
const STAGES = DEAL_STAGES.map((s) => ({
  key: s.key,
  label: s.label,
  color: s.dot,
  matches: (l: AgentLead) => l.pipeline_stage === s.key,
}));

export function AgentPipeline() {
  const { leads, counts, isLoading } = useAgentInboxData('pipeline');
  const [selectedLead, setSelectedLead] = useState<AgentLead | null>(null);
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'linkedin'>('all');
  const [search, setSearch] = useState('');

  // Everything EXCEPT the stage filter — search + channel + tag. The stage
  // count cards count off THIS, so their per-stage numbers reflect the search
  // as you type (without the active stage chip filtering them circularly).
  const baseFilteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (tagFilter.size > 0 && !tagFilter.has(lead.pipeline_stage)) return false;
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
  }, [leads, tagFilter, channelFilter, search]);

  // The table additionally applies the active stage chip(s).
  const filteredLeads = useMemo(() => {
    if (stageFilter.size === 0) return baseFilteredLeads;
    return baseFilteredLeads.filter((lead) =>
      STAGES.filter((s) => stageFilter.has(s.key)).some((s) => s.matches(lead)),
    );
  }, [baseFilteredLeads, stageFilter]);

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
          // Count off the search/channel/tag-filtered set so each column's
          // number updates live as you type. Falls back to the server total
          // only when no filters are active (identical result, cheaper).
          const anyFilter =
            !!search || channelFilter !== 'all' || tagFilter.size > 0;
          const count = anyFilter
            ? baseFilteredLeads.filter((l) => stage.matches(l)).length
            : counts.by_pipeline_category?.[stage.key] ?? 0;
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

        {/* Tag chips — filter by pipeline_stage */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PIPELINE_STAGES.map((stage) => (
            <button
              key={stage.value}
              onClick={() => toggleFilter(tagFilter, stage.value, setTagFilter)}
              className={cn(
                'px-2 py-1 rounded-full text-xs border transition-colors',
                tagFilter.has(stage.value)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-foreground'
              )}
            >
              {stage.label}
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

      {/* Board — the SAME shared component the /r/:token client report renders,
          so the two are visually identical. Read-only on the report; here each
          card opens the editable LeadDetailPanel. */}
      <PipelineBoard
        leads={filteredLeads}
        onCardClick={setSelectedLead}
        emptyLabel={
          leads.length === 0
            ? 'No leads yet. Your agent will populate this as campaigns run and replies come in.'
            : 'No leads match your filters.'
        }
      />

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
