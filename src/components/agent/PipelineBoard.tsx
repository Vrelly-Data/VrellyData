// Shared pipeline board — the SINGLE source of the per-stage column layout used
// by BOTH the internal agent Pipeline (AgentPipeline) and the public client
// report (/r/:token). Rendering here guarantees the two look identical: same
// columns, order, colors, and card design. The only difference is behavioral —
// the report passes readOnly + a status-only click handler.
//
// Self-contained (its own channel icon + relative-time) so the public report
// bundle doesn't pull in LeadDetailPanel's agent-only logic.

import { useMemo, useState } from 'react';
import { Linkedin, Mail } from 'lucide-react';

// Minimal lead shape both AgentLead and the report's ResponderRow satisfy.
export interface BoardLead {
  id: string;
  full_name: string | null;
  company: string | null;
  channel: string | null;
  pipeline_stage?: string | null;
  last_reply_at: string | null;
}

// Per-stage display columns. Order = funnel order. 'dead' aggregates the three
// negative disposition stages (mirrors the agent view's existing rollup); every
// other column keys off pipeline_stage 1:1. A lead lands in the FIRST column it
// matches, so each appears exactly once.
type Column = { key: string; label: string; dot: string; matches: (s: string) => boolean };
const COLUMNS: Column[] = [
  { key: 'contacted', label: 'Contacted', dot: 'bg-slate-400', matches: (s) => s === 'contacted' },
  { key: 'replied', label: 'Replied', dot: 'bg-sky-500', matches: (s) => s === 'replied' },
  { key: 'engaged', label: 'Engaged', dot: 'bg-cyan-500', matches: (s) => s === 'engaged' },
  { key: 'in_progress', label: 'In Progress', dot: 'bg-blue-500', matches: (s) => s === 'in_progress' },
  { key: 'sent_proposal', label: 'Sent Proposal', dot: 'bg-violet-500', matches: (s) => s === 'sent_proposal' },
  { key: 'meeting_booked', label: 'Meeting Booked', dot: 'bg-green-500', matches: (s) => s === 'meeting_booked' },
  { key: 'no_show', label: 'No Show', dot: 'bg-orange-500', matches: (s) => s === 'no_show' },
  { key: 'closed_won', label: 'Closed Won', dot: 'bg-emerald-500', matches: (s) => s === 'closed_won' },
  { key: 'closed_lost', label: 'Closed Lost', dot: 'bg-rose-500', matches: (s) => s === 'closed_lost' },
  { key: 'dead', label: 'Dead', dot: 'bg-red-500', matches: (s) => ['bad_lead', 'ooo', 'not_interested', 'dead'].includes(s) },
];

const CARDS_PER_COLUMN = 8;

function columnFor(stage: string): Column | null {
  return COLUMNS.find((c) => c.matches(stage)) ?? null;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return '1d';
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo` : `${Math.floor(mo / 12)}y`;
}

function ChannelIcon({ channel }: { channel: string | null }) {
  if (channel === 'linkedin') return <Linkedin className="h-3 w-3 text-blue-600" />;
  if (channel === 'email') return <Mail className="h-3 w-3 text-muted-foreground" />;
  return null;
}

export function PipelineBoard<T extends BoardLead>({
  leads,
  readOnly = false,
  onCardClick,
  emptyLabel = 'No leads yet.',
}: {
  leads: T[];
  readOnly?: boolean;
  onCardClick?: (lead: T) => void;
  emptyLabel?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const byColumn = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const c of COLUMNS) map.set(c.key, []);
    for (const l of leads) {
      const col = columnFor(l.pipeline_stage ?? '');
      if (col) map.get(col.key)!.push(l);
    }
    return map;
  }, [leads]);

  if (leads.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg">
        {emptyLabel}
      </div>
    );
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const colLeads = byColumn.get(col.key) ?? [];
        const isOpen = expanded.has(col.key);
        const shown = isOpen ? colLeads : colLeads.slice(0, CARDS_PER_COLUMN);
        return (
          <div key={col.key} className="w-60 shrink-0 flex flex-col">
            <div className="flex items-center gap-2 px-1 pb-2">
              <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
              <span className="text-sm font-medium">{col.label}</span>
              <span className="text-xs text-muted-foreground">{colLeads.length}</span>
            </div>
            <div className="flex-1 space-y-2 rounded-lg bg-muted/30 p-2 min-h-[4rem] max-h-[60vh] overflow-y-auto">
              {colLeads.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">—</p>
              ) : (
                <>
                  {shown.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => onCardClick?.(l)}
                      title={readOnly ? 'View details' : undefined}
                      className="w-full text-left rounded-md border bg-card p-2 hover:bg-accent/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="text-sm font-medium truncate">
                        {l.full_name || 'Unknown'}
                      </div>
                      {l.company && (
                        <div className="text-xs text-muted-foreground truncate">
                          {l.company}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-1.5">
                        <ChannelIcon channel={l.channel} />
                        <span className="text-[10px] text-muted-foreground">
                          {relativeTime(l.last_reply_at)}
                        </span>
                      </div>
                    </button>
                  ))}
                  {colLeads.length > CARDS_PER_COLUMN && (
                    <button
                      type="button"
                      onClick={() => toggle(col.key)}
                      className="w-full text-xs font-medium text-primary hover:underline py-1"
                    >
                      {isOpen ? 'Show less' : `Show ${colLeads.length - CARDS_PER_COLUMN} more`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
