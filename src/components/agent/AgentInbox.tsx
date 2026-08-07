import { useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, Linkedin, Mail } from 'lucide-react';
import { LinkedInProfileLink } from '@/components/LinkedInProfileLink';
import { cn } from '@/lib/utils';
import {
  useAgentInboxData,
  useClassifyLead,
  INBOX_PAGE_SIZE,
  type AgentLead,
  type InboxStatusGroup,
} from '@/hooks/useAgentInbox';
import { useAgentConfig } from '@/hooks/useAgent';
import {
  LeadDetailPanel,
  IntentBadge,
  ChannelBadge,
  formatRelativeTime,
  getPipelineStageLabel,
} from './LeadDetailPanel';

// Most-recent role:'sender' fromName in the thread — the sender who owns this
// conversation (matches a sender_profiles.sender_name).
function latestSenderName(
  thread?: Array<{ role: string; fromName?: string | null }> | null,
): string | null {
  if (!Array.isArray(thread)) return null;
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    if (m?.role === 'sender' && m.fromName && m.fromName.trim()) return m.fromName.trim();
  }
  return null;
}

// Server-side ceiling in get-agent-inbox. Mirrored here so the UI can say
// "showing the first N of M" instead of just hiding the button and implying
// the list is complete.
const MAX_INBOX_PAGE = 500;

export function AgentInbox() {
  const [statusGroup, setStatusGroupRaw] = useState<InboxStatusGroup>('pending_approval');
  const [limit, setLimit] = useState(INBOX_PAGE_SIZE);

  // Switching tabs starts a new list — carrying a grown page size across would
  // fetch hundreds of rows for a tab the operator has not scrolled yet.
  const setStatusGroup = useCallback((group: InboxStatusGroup) => {
    setStatusGroupRaw(group);
    setLimit(INBOX_PAGE_SIZE);
  }, []);

  const { leads, counts, hasMore, total, isLoading, isFetching } =
    useAgentInboxData('inbox', statusGroup, limit);

  // Distinguishes "fetching a BIGGER page" from the routine 30s background
  // poll, which also sets isFetching. Keying the button's pending state off
  // isFetching alone would grey it out and flip it to "Loading…" twice a
  // minute. While a larger page is in flight the placeholder still holds the
  // previous, smaller row set — so fewer rows than the requested limit means
  // the expansion has not landed yet.
  const isExpanding = isFetching && leads.length < limit;
  const { data: agentConfig } = useAgentConfig();
  const classifyLead = useClassifyLead();
  const [selectedLead, setSelectedLead] = useState<AgentLead | null>(null);
  const [classifyingLeadId, setClassifyingLeadId] = useState<string | null>(null);

  const handleSelectLead = useCallback((lead: AgentLead) => {
    setSelectedLead(lead);

    // Trigger classification if lead has no intent and no draft
    const needsClassification = !lead.intent && !lead.draft_response;
    if (needsClassification && agentConfig && !classifyLead.isPending) {
      setClassifyingLeadId(lead.id);
      classifyLead.mutate(
        { lead, agentConfig },
        {
          onSettled: () => setClassifyingLeadId(null),
        },
      );
    }
  }, [agentConfig, classifyLead]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pendingApprovalCount = counts.by_status_group?.pending_approval ?? 0;
  const totalInboxCount = counts.by_status_group?.total_inbox ?? 0;

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
            onClick={() => setStatusGroup('pending_approval')}
            className={cn(
              'flex-1 px-4 py-3 text-sm font-medium transition-colors',
              statusGroup === 'pending_approval'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Pending Approval
            {pendingApprovalCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {pendingApprovalCount}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setStatusGroup('total_inbox')}
            className={cn(
              'flex-1 px-4 py-3 text-sm font-medium transition-colors',
              statusGroup === 'total_inbox'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Total Inbox
            {totalInboxCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {totalInboxCount}
              </Badge>
            )}
          </button>
        </div>

        {/* Lead cards */}
        <div className="flex-1 overflow-auto">
          {leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
              {statusGroup === 'pending_approval' ? (
                <>
                  <CheckCircle className="h-10 w-10 text-green-500 mb-3" />
                  <p className="font-medium text-foreground">You're all caught up</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Replies awaiting your approval will appear here.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-foreground">No handled leads yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Leads you've sent, replied to, or dismissed will show here.
                  </p>
                </>
              )}
            </div>
          ) : (
            leads.map((lead) => (
              // role="button" rather than <button>: this row now contains the
              // LinkedIn <a>, and an anchor nested in a button is invalid HTML.
              <div
                key={lead.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectLead(lead)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectLead(lead);
                  }
                }}
                className={cn(
                  'w-full text-left px-4 py-3 border-b transition-colors hover:bg-muted/50 cursor-pointer',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  selectedLead?.id === lead.id && 'bg-muted'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate flex items-center gap-1.5">
                      <span className="truncate">
                        {lead.full_name}
                        {lead.company && (
                          <span className="text-muted-foreground font-normal"> · {lead.company}</span>
                        )}
                      </span>
                      {/* Next to the name rather than folded into ChannelBadge:
                          that badge labels the CHANNEL (and can read
                          "multichannel"), so making it the profile link would
                          conflate two different meanings. */}
                      <LinkedInProfileLink url={lead.linkedin_url} />
                    </div>
                    {lead.job_title && (
                      <p className="text-xs text-muted-foreground truncate">{lead.job_title}</p>
                    )}
                    {(() => {
                      const sender = latestSenderName(lead.reply_thread);
                      const campaign = lead.last_campaign_name;
                      if (!campaign && !sender) return null;
                      return (
                        <p className="text-xs text-muted-foreground truncate">
                          {campaign && <span>{campaign}</span>}
                          {campaign && sender && <span> · </span>}
                          {sender && <span>Sender: {sender}</span>}
                        </p>
                      );
                    })()}
                  </div>
                  {/* Show the timestamp the list is SORTED by. This row used to
                      render last_reply_at while Total Inbox ordered by
                      updated_at, so the visible times read as shuffled even
                      where the order was defensible. Falls back to
                      last_reply_at for any row the backfill hasn't reached. */}
                  {(lead.last_message_at ?? lead.last_reply_at) && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatRelativeTime(lead.last_message_at ?? lead.last_reply_at)}
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
                  {statusGroup === 'total_inbox' && getPipelineStageLabel(lead.disposition_tag ?? lead.pipeline_stage) && (
                    <Badge variant="secondary" className="text-xs">
                      {getPipelineStageLabel(lead.disposition_tag ?? lead.pipeline_stage)}
                    </Badge>
                  )}
                </div>
                {lead.last_reply_text && (
                  <p className="text-xs text-muted-foreground mt-1.5 truncate">
                    {lead.last_reply_text}
                  </p>
                )}
              </div>
            ))
          )}

          {/* Paging footer. Three states, and none of them silently imply the
              list is complete when it isn't:
                more available        → clickable "Load more"
                more, but at the cap  → static count, no false affordance
                nothing more          → nothing rendered */}
          {hasMore && limit < MAX_INBOX_PAGE && (
            <button
              onClick={() => setLimit((n) => Math.min(n + INBOX_PAGE_SIZE, MAX_INBOX_PAGE))}
              disabled={isExpanding}
              className={cn(
                'w-full px-4 py-3 text-sm text-muted-foreground border-b transition-colors',
                'hover:text-foreground hover:bg-muted/50 disabled:opacity-60',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              )}
            >
              {isExpanding ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </span>
              ) : (
                <>Load more · showing {leads.length} of {total}</>
              )}
            </button>
          )}
          {hasMore && limit >= MAX_INBOX_PAGE && (
            <p className="px-4 py-3 text-xs text-muted-foreground border-b">
              Showing the first {leads.length} of {total}.
            </p>
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
            classifying={classifyingLeadId === selectedLead.id}
          />
        </div>
      )}
    </div>
  );
}
