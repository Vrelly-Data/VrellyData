// Responders list for the Data Analysis report.
//
// Scope: SHOW-ALL for the current user's agent_leads — NOT filtered by the
// selected client's campaigns. agent_leads has no reliable campaign_id
// (per the build spec; campaign_external_id only lives on webhook_events),
// so a per-client filter would be misleading.
//
// Sort: intent priority (interested → unknown → not_interested), then
// last_reply_at desc within each group.
//
// Each row collapses by default; the full reply_thread expands on demand
// as alternating prospect / sender chat bubbles.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Linkedin,
  Mail,
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';

interface ReplyThreadItem {
  role?: string;
  channel?: string;
  content?: string;
  timestamp?: string;
}

interface ResponderRow {
  id: string;
  full_name: string | null;
  company: string | null;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  channel: string | null;
  intent: string | null;
  inbox_status: string | null;
  // Pipeline fields — populated on the public report via get-client-report so
  // the report's Pipeline section can group by stage. Optional: the admin-side
  // RespondersList query (this file) doesn't select them.
  pipeline_stage?: string | null;
  disposition_tag?: string | null;
  last_reply_text: string | null;
  last_reply_at: string | null;
  reply_thread: ReplyThreadItem[] | null;
}

// ---------------------------------------------------------------------------
// Sort + display helpers
// ---------------------------------------------------------------------------

// Parse a timestamp string to ms-since-epoch, returning null for missing or
// unparseable input. Used by the sort comparator below to push null /
// invalid rows to the bottom of the list.
function parseReplyTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

// Absolute response-date formatter ("Jun 3, 2026"). Replaces the previous
// "Xd ago" relative formatter — clients reading the public report want an
// anchored point in time, not a moving target. Returns "" for null /
// invalid input so the calling span renders nothing rather than
// "Invalid Date".
function formatResponseDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// LinkedIn leads often have null company/title. Build the "role · company"
// line gracefully so we never render "null", a leading dot, or a trailing
// separator.
function buildRoleLine(jobTitle: string | null, company: string | null): string {
  const parts: string[] = [];
  if (jobTitle && jobTitle.trim()) parts.push(jobTitle.trim());
  if (company && company.trim()) parts.push(company.trim());
  return parts.join(' · ');
}

// Most-recent prospect content from the thread; falls back to the cached
// last_reply_text field. Returns null if neither has anything to show.
function latestProspectReply(lead: ResponderRow): string | null {
  const thread = lead.reply_thread;
  if (Array.isArray(thread)) {
    for (let i = thread.length - 1; i >= 0; i--) {
      const item = thread[i];
      if (item?.role === 'prospect' && typeof item.content === 'string' && item.content.trim()) {
        return item.content.trim();
      }
    }
  }
  return lead.last_reply_text && lead.last_reply_text.trim()
    ? lead.last_reply_text.trim()
    : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RespondersListProps {
  // When provided, the component skips its internal supabase fetch and
  // renders this list directly. The public report page passes the
  // server-pre-filtered responders array; the admin view leaves it
  // undefined and the component fetches the show-all agent_leads list.
  data?: ResponderRow[];
}

export { type ResponderRow };

// Default-collapsed row count. Picked to surface the most-relevant few
// responders (the existing sort puts interested + recent at the top)
// without overwhelming a client opening their report on mobile.
const COLLAPSED_ROW_COUNT = 4;

export function RespondersList({ data }: RespondersListProps = {}) {
  const { user } = useAuthStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Independent from per-row thread expansion. Same component instance
  // serves both admin tab and public report — each mount gets its own
  // collapsed default; not persisted across navigations.
  const [showAll, setShowAll] = useState(false);
  const isDataMode = data !== undefined;

  const query = useQuery({
    queryKey: ['client_analysis_responders', user?.id],
    queryFn: async (): Promise<ResponderRow[]> => {
      if (!user) return [];
      // (inbox_status='replied') OR (last_reply_at IS NOT NULL).
      // Two .or() conditions on the same query — PostgREST .or syntax.
      const { data, error } = await supabase
        .from('agent_leads')
        .select(
          'id, full_name, company, job_title, email, linkedin_url, channel, intent, inbox_status, last_reply_text, last_reply_at, reply_thread',
        )
        .eq('user_id', user.id)
        .or('inbox_status.eq.replied,last_reply_at.not.is.null');
      if (error) throw error;
      return (data ?? []) as unknown as ResponderRow[];
    },
    enabled: !!user && !isDataMode,
    // Fresh on every detail-view mount per the spec — Replies arrive
    // out-of-band via the inbox webhooks, so even a 30s cache window can
    // miss the brand-new "Replies" row that just landed.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const sorted = useMemo(() => {
    const source = isDataMode ? data ?? [] : query.data ?? [];
    return source.slice().sort((a, b) => {
      // Pure recency desc. Intent no longer affects ordering (the badges
      // still render per-row exactly as before). Rows with a null or
      // unparseable last_reply_at fall to the bottom — after every dated
      // row — and keep stable order among themselves.
      const at = parseReplyTime(a.last_reply_at);
      const bt = parseReplyTime(b.last_reply_at);
      if (at === null && bt === null) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return bt - at;
    });
  }, [query.data, isDataMode, data]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Responses
            {(isDataMode || !query.isLoading) && (
              <span className="text-xs font-normal text-muted-foreground">
                ({sorted.length})
              </span>
            )}
          </h3>
        </div>

        {/* Loading + error states only fire in fetch mode. Data mode skips
            them — the parent owns its own loading/error UX. */}
        {!isDataMode && query.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !isDataMode && query.error ? (
          <p className="text-xs text-destructive">
            Failed to load responses: {(query.error as Error).message}
          </p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No responses yet.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {(showAll
                ? sorted
                : sorted.slice(0, COLLAPSED_ROW_COUNT)
              ).map((r) => (
                <ResponderRowView
                  key={r.id}
                  lead={r}
                  expanded={expanded.has(r.id)}
                  onToggle={() => toggle(r.id)}
                />
              ))}
            </ul>
            {/* Show-more/less only renders when there are enough rows to
                hide. Same control for admin and public — the state is
                local to each component instance. */}
            {sorted.length > COLLAPSED_ROW_COUNT && (
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:underline"
                >
                  {showAll
                    ? 'Show less'
                    : `Show all ${sorted.length} responses`}
                </button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Row + thread view
// ---------------------------------------------------------------------------

function ResponderRowView({
  lead,
  expanded,
  onToggle,
}: {
  lead: ResponderRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const name = (lead.full_name && lead.full_name.trim()) || 'Unknown contact';
  const roleLine = buildRoleLine(lead.job_title, lead.company);
  const latestReply = latestProspectReply(lead);
  const contactHref =
    lead.email
      ? `mailto:${lead.email}`
      : lead.linkedin_url
      ? lead.linkedin_url
      : null;
  const contactLabel = lead.email ?? lead.linkedin_url ?? null;

  return (
    <li className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{name}</span>
            <ChannelPill channel={lead.channel} />
            <IntentBadge intent={lead.intent} />
          </div>
          {roleLine && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {roleLine}
            </p>
          )}
          {contactHref && contactLabel && (
            <a
              href={contactHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline truncate inline-block max-w-full"
            >
              {contactLabel}
            </a>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {formatResponseDate(lead.last_reply_at)}
        </span>
      </div>

      {latestReply && !expanded && (
        <p className="text-sm text-foreground/90 line-clamp-2 leading-snug">
          {latestReply}
        </p>
      )}

      {expanded && <ReplyThreadView thread={lead.reply_thread} fallback={latestReply} />}

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onToggle}
        >
          {expanded ? (
            <>
              <ChevronUp className="mr-1 h-3 w-3" /> Hide thread
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3 w-3" /> Show full thread
            </>
          )}
        </Button>
      </div>
    </li>
  );
}

function ChannelPill({ channel }: { channel: string | null }) {
  if (channel === 'linkedin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
        <Linkedin className="h-3 w-3" /> LinkedIn
      </span>
    );
  }
  if (channel === 'email') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
        <Mail className="h-3 w-3" /> Email
      </span>
    );
  }
  return null;
}

function IntentBadge({ intent }: { intent: string | null }) {
  const v = intent ?? 'unknown';
  if (v === 'interested') {
    return (
      <span className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
        Interested
      </span>
    );
  }
  if (v === 'not_interested') {
    return (
      <span className="text-xs px-2 py-0.5 rounded font-medium bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">
        Not interested
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded font-medium bg-muted text-muted-foreground border border-border">
      Unknown
    </span>
  );
}

function ReplyThreadView({
  thread,
  fallback,
}: {
  thread: ReplyThreadItem[] | null;
  fallback: string | null;
}) {
  const items = Array.isArray(thread) ? thread : [];
  if (items.length === 0) {
    return fallback ? (
      <div className="bg-muted/40 rounded p-2 text-sm">{fallback}</div>
    ) : (
      <p className="text-xs text-muted-foreground italic">No thread data.</p>
    );
  }
  return (
    <div className="space-y-2 pt-1">
      {items.map((m, idx) => {
        const isProspect = m.role === 'prospect';
        return (
          <div
            key={idx}
            className={
              isProspect ? 'flex justify-start' : 'flex justify-end'
            }
          >
            <div
              className={
                isProspect
                  ? 'max-w-[80%] rounded-lg rounded-tl-sm px-3 py-2 bg-muted text-sm'
                  : 'max-w-[80%] rounded-lg rounded-tr-sm px-3 py-2 bg-primary text-primary-foreground text-sm'
              }
            >
              {m.content && (
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              )}
              {m.timestamp && (
                <div
                  className={
                    isProspect
                      ? 'text-[10px] text-muted-foreground mt-1'
                      : 'text-[10px] text-primary-foreground/70 mt-1'
                  }
                >
                  {new Date(m.timestamp).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
