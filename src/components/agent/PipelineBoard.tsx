// Shared pipeline board — the SINGLE source of the per-stage column layout used
// by BOTH the internal agent Pipeline (AgentPipeline) and the public client
// report (/r/:token). Rendering here guarantees the two look identical: same
// columns, order, colors, and card design. The only difference is behavioral —
// the report passes readOnly + a status-only click handler.
//
// Self-contained (its own channel icon + relative-time) so the public report
// bundle doesn't pull in LeadDetailPanel's agent-only logic.

import { useMemo, useState } from 'react';
import { Linkedin, Mail, Users, Tag as TagIcon, Plus, Check } from 'lucide-react';
import { LinkedInProfileLink } from '@/components/LinkedInProfileLink';
import { normalizeLinkedInUrl } from '@/lib/linkedin';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const ALL_SENDERS = '__all__';

export interface BoardTag {
  id: string;
  name: string;
  color: string;
}

// Derive a lead's LinkedIn sender from its reply_thread — the fromName on the
// most recent role:'sender' (our outbound) message. Shared by the agent view
// (reads AgentLead.reply_thread) and mirrored server-side in get-client-report.
export function deriveSenderFromThread(
  thread: ReadonlyArray<{ role?: string; fromName?: string | null }> | null | undefined,
): string | null {
  if (!Array.isArray(thread)) return null;
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    if (m?.role === 'sender' && m.fromName && String(m.fromName).trim()) {
      return String(m.fromName).trim();
    }
  }
  return null;
}

// Minimal lead shape both AgentLead and the report's ResponderRow satisfy.
export interface BoardLead {
  id: string;
  full_name: string | null;
  company: string | null;
  channel: string | null;
  // Contact's LinkedIn profile. Optional so callers that never had it still
  // satisfy the constraint; the card renders no icon when it is absent.
  linkedin_url?: string | null;
  pipeline_stage?: string | null;
  last_reply_at: string | null;
}

// The ONE deal-stage taxonomy — 8 stages, funnel order. Tags == stages: the
// operator dropdown and these columns are the same 8 in the same order. A lead
// keys off pipeline_stage 1:1. Kept in sync with PIPELINE_STAGES in
// LeadDetailPanel. (opted_out is NOT a stage — it's a compliance suppression
// flag; such leads carry pipeline_stage='closed_lost'.)
export const DEAL_STAGES = [
  { key: 'replied', label: 'Replied', dot: 'bg-sky-500' },
  { key: 'in_progress', label: 'In Progress', dot: 'bg-blue-500' },
  { key: 'sent_proposal', label: 'Sent Proposal', dot: 'bg-violet-500' },
  { key: 'call_scheduled', label: 'Call Scheduled', dot: 'bg-teal-500' },
  { key: 'no_show', label: 'No Show', dot: 'bg-orange-500' },
  { key: 'closed_won', label: 'Closed Won', dot: 'bg-emerald-500' },
  { key: 'closed_lost', label: 'Closed Lost', dot: 'bg-rose-500' },
] as const;

type Column = { key: string; label: string; dot: string };
const COLUMNS: Column[] = DEAL_STAGES.map((s) => ({ ...s }));

const CARDS_PER_COLUMN = 8;

function columnFor(stage: string): Column | null {
  return COLUMNS.find((c) => c.key === stage) ?? null;
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

// True when `a` is a first-name-style prefix of `b` (or they're equal),
// case-insensitive: "Carey" ⊑ "Carey Rome", but "Car" is NOT ⊑ "Carey" (the
// match must land on a word boundary). Used to fold inconsistently-signed
// variants of one rep into a single sender option.
function isNamePrefix(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return y === x || y.startsWith(x + ' ');
}

// Group raw sender strings so variants of one person collapse to one option.
// Any two values where one is a name-prefix of the other are unioned
// (transitively), and each group's canonical label is its longest (fullest)
// member — ties broken alphabetically for determinism. Returns the sorted
// canonical options + a raw→canonical map for filtering.
function groupSenders(raw: string[]): { options: string[]; canonicalOf: Map<string, string> } {
  const values = [...new Set(raw)];
  const parent = new Map<string, string>(values.map((v) => [v, v]));
  const find = (v: string): string => {
    let r = v;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = v;
    while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (isNamePrefix(values[i], values[j]) || isNamePrefix(values[j], values[i])) {
        union(values[i], values[j]);
      }
    }
  }
  // Canonical (fullest form) per group root.
  const better = (a: string, b: string) =>
    b.length > a.length || (b.length === a.length && b.localeCompare(a) < 0) ? b : a;
  const canonByRoot = new Map<string, string>();
  for (const v of values) {
    const r = find(v);
    canonByRoot.set(r, canonByRoot.has(r) ? better(canonByRoot.get(r)!, v) : v);
  }
  const canonicalOf = new Map<string, string>();
  for (const v of values) canonicalOf.set(v, canonByRoot.get(find(v))!);
  const options = [...new Set(canonicalOf.values())].sort((a, b) => a.localeCompare(b));
  return { options, canonicalOf };
}

export function PipelineBoard<T extends BoardLead>({
  leads,
  readOnly = false,
  onCardClick,
  emptyLabel = 'No leads yet.',
  getSender,
  tags,
  getLeadTagIds,
  onCreateTag,
}: {
  leads: T[];
  readOnly?: boolean;
  onCardClick?: (lead: T) => void;
  emptyLabel?: string;
  // Optional per-lead LinkedIn sender accessor. When provided (and any
  // LinkedIn-channel lead has a sender), a "sender" dropdown appears above the
  // board and filters columns + counts to the selected sender.
  getSender?: (lead: T) => string | null;
  // Tags (Feature 1). When `tags` is provided, a Tags multi-select filter
  // appears; selecting tags filters to leads carrying ANY selected tag (OR).
  // `getLeadTagIds` returns a lead's applied tag ids. `onCreateTag` (agent-only,
  // omit on the read-only report) shows a "+ New tag" affordance.
  tags?: BoardTag[];
  getLeadTagIds?: (lead: T) => string[];
  onCreateTag?: (name: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sender, setSender] = useState<string>(ALL_SENDERS);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [newTag, setNewTag] = useState('');

  // LinkedIn senders present in the leads, with inconsistently-signed variants
  // of one rep ("Carey" / "Carey Rome") folded into a single canonical option.
  const { senders, canonicalOf } = useMemo(() => {
    if (!getSender) return { senders: [] as string[], canonicalOf: new Map<string, string>() };
    const raw: string[] = [];
    for (const l of leads) {
      if (l.channel !== 'linkedin') continue;
      const s = getSender(l);
      if (s) raw.push(s);
    }
    const { options, canonicalOf } = groupSenders(raw);
    return { senders: options, canonicalOf };
  }, [leads, getSender]);

  // If the chosen sender is no longer present (e.g. an upstream search narrowed
  // the leads), fall back to All — combines cleanly with the search box.
  const effectiveSender =
    getSender && sender !== ALL_SENDERS && senders.includes(sender) ? sender : ALL_SENDERS;

  const visibleLeads = useMemo(() => {
    let out = leads;
    // Sender filter (canonical group).
    if (getSender && effectiveSender !== ALL_SENDERS) {
      out = out.filter((l) => {
        const s = getSender(l);
        return s != null && canonicalOf.get(s) === effectiveSender;
      });
    }
    // Tag filter — keep leads carrying ANY selected tag (OR). Combines with the
    // sender filter and the upstream search.
    if (getLeadTagIds && selectedTags.size > 0) {
      out = out.filter((l) => getLeadTagIds(l).some((id) => selectedTags.has(id)));
    }
    return out;
  }, [leads, getSender, effectiveSender, canonicalOf, getLeadTagIds, selectedTags]);

  const byColumn = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const c of COLUMNS) map.set(c.key, []);
    for (const l of visibleLeads) {
      const col = columnFor(l.pipeline_stage ?? '');
      if (col) map.get(col.key)!.push(l);
    }
    return map;
  }, [visibleLeads]);

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

  const toggleTag = (id: string) =>
    setSelectedTags((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const showFilters = (getSender && senders.length > 0) || (tags && tags.length > 0) || !!onCreateTag;

  return (
    <div className="space-y-3">
      {showFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          {getSender && senders.length > 0 && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <Select value={effectiveSender} onValueChange={setSender}>
                <SelectTrigger className="w-56 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SENDERS}>All senders</SelectItem>
                  {senders.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {tags && tags.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-8 rounded-md border px-2.5 text-sm hover:bg-accent/40"
                >
                  <TagIcon className="h-4 w-4 text-muted-foreground" />
                  {selectedTags.size > 0 ? `${selectedTags.size} tag${selectedTags.size > 1 ? 's' : ''}` : 'Filter tags'}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2">
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {tags.map((t) => {
                    const on = selectedTags.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.id)}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-accent/50"
                      >
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                        <span className="truncate flex-1">{t.name}</span>
                        {on && <Check className="h-3.5 w-3.5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
                {selectedTags.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedTags(new Set())}
                    className="mt-1 w-full text-xs text-muted-foreground hover:underline py-1"
                  >
                    Clear
                  </button>
                )}
              </PopoverContent>
            </Popover>
          )}

          {/* Agent-only tag creation ("+ New tag"); omitted on the read-only report. */}
          {onCreateTag && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 h-8 rounded-md border border-dashed px-2.5 text-sm text-muted-foreground hover:bg-accent/40"
                >
                  <Plus className="h-3.5 w-3.5" /> New tag
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2">
                <input
                  autoFocus
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Tag name…"
                  className="w-full h-8 rounded-md border px-2 text-sm bg-background"
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newTag.trim()) {
                      await onCreateTag(newTag.trim());
                      setNewTag('');
                    }
                  }}
                />
                <p className="mt-1 text-xs text-muted-foreground">Press Enter to create.</p>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

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
                    // role="button" rather than a real <button>: the card holds
                    // a LinkedIn <a>, and an anchor nested inside a button is
                    // invalid HTML (interactive content inside interactive
                    // content). Keyboard behaviour is preserved below.
                    <div
                      key={l.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onCardClick?.(l)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onCardClick?.(l);
                        }
                      }}
                      title={readOnly ? 'View details' : undefined}
                      className="w-full text-left rounded-md border bg-card p-2 hover:bg-accent/40 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                        <div className="flex items-center gap-1.5">
                          {/* When the lead came in over LinkedIn AND we have a
                              profile URL, the existing channel glyph BECOMES the
                              link — no second "in" icon. Otherwise the channel
                              glyph stays inert and the profile link is added
                              alongside it (e.g. an email lead we still have a
                              LinkedIn URL for). */}
                          {l.channel === 'linkedin' && normalizeLinkedInUrl(l.linkedin_url) ? (
                            <LinkedInProfileLink url={l.linkedin_url} />
                          ) : (
                            <>
                              <ChannelIcon channel={l.channel} />
                              <LinkedInProfileLink url={l.linkedin_url} />
                            </>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {relativeTime(l.last_reply_at)}
                        </span>
                      </div>
                    </div>
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
    </div>
  );
}
