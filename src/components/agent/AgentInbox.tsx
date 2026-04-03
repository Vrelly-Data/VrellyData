import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, Linkedin, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentInboxData, type AgentLead } from '@/hooks/useAgentInbox';
import { LeadDetailPanel, IntentBadge, ChannelBadge, formatRelativeTime } from './LeadDetailPanel';

export function AgentInbox() {
  const { leads, counts, isLoading } = useAgentInboxData('inbox');
  const [selectedLead, setSelectedLead] = useState<AgentLead | null>(null);
  const [tab, setTab] = useState<'attention' | 'auto'>('attention');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const needsAttention = leads.filter((l) => !l.auto_handled);
  const autoHandled = leads.filter((l) => l.auto_handled);
  const displayLeads = tab === 'attention' ? needsAttention : autoHandled;

  return (
    <div className="flex h-full">
      {/* Left panel — lead list */}
      <div className={cn(
        'border-r flex flex-col shrink-0',
        selectedLead ? 'w-80' : 'flex-1 max-w-2xl'
      )}>
        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setTab('attention')}
            className={cn(
              'flex-1 px-4 py-3 text-sm font-medium transition-colors',
              tab === 'attention'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Needs Attention
            {needsAttention.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {needsAttention.length}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setTab('auto')}
            className={cn(
              'flex-1 px-4 py-3 text-sm font-medium transition-colors',
              tab === 'auto'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Auto-handled
            {autoHandled.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {autoHandled.length}
              </Badge>
            )}
          </button>
        </div>

        {/* Lead cards */}
        <div className="flex-1 overflow-auto">
          {displayLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
              {tab === 'attention' ? (
                <>
                  <CheckCircle className="h-10 w-10 text-green-500 mb-3" />
                  <p className="font-medium text-foreground">You're all caught up</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Replies will appear here as your agent's campaigns get responses.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-foreground">No auto-handled replies yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Auto-handled replies (out of office, bounces) will show here.
                  </p>
                </>
              )}
            </div>
          ) : (
            displayLeads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => setSelectedLead(lead)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b transition-colors hover:bg-muted/50',
                  selectedLead?.id === lead.id && 'bg-muted'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">
                      {lead.full_name}
                      {lead.company && (
                        <span className="text-muted-foreground font-normal"> · {lead.company}</span>
                      )}
                    </div>
                    {lead.job_title && (
                      <p className="text-xs text-muted-foreground truncate">{lead.job_title}</p>
                    )}
                  </div>
                  {lead.last_reply_at && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatRelativeTime(lead.last_reply_at)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <ChannelBadge channel={lead.channel} />
                  {lead.intent && <IntentBadge intent={lead.intent} />}
                  {lead.inbox_status === 'draft_ready' && (
                    <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                      Draft ready
                    </Badge>
                  )}
                  {lead.inbox_status === 'pending' && !lead.auto_handled && (
                    <Badge variant="secondary" className="text-xs">
                      Pending
                    </Badge>
                  )}
                </div>
                {lead.last_reply_text && (
                  <p className="text-xs text-muted-foreground mt-1.5 truncate">
                    {lead.last_reply_text}
                  </p>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel — lead detail */}
      {selectedLead && (
        <div className="flex-1 min-w-0">
          <LeadDetailPanel
            key={selectedLead.id}
            lead={selectedLead}
            onClose={() => setSelectedLead(null)}
            showDraft
          />
        </div>
      )}
    </div>
  );
}
