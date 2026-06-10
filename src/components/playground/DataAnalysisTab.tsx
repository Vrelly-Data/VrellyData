import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Sparkles,
  Send,
  MessageSquare,
  Linkedin,
  Mail,
  AlertTriangle,
  Percent,
  Pencil,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  NewClientAnalysisDialog,
  type ClientAnalysisEditingState,
} from './NewClientAnalysisDialog';
import { CampaignBarChart } from './CampaignBarChart';
import { RespondersList } from './RespondersList';

type Range = '7d' | '30d' | 'mtd';

interface ClientListRow {
  id: string;
  display_name: string;
  last_generated_at: string | null;
  last_range: Range | null;
  slug: string;
}

interface ClientFullRow {
  id: string;
  user_id: string;
  display_name: string;
  slug: string;
  heyreach_account_ids: number[];
  smartlead_campaign_ids: string[];
  analysis_text: string | null;
  stats_snapshot: StatsSnapshot | null;
  last_generated_at: string | null;
  last_range: Range | null;
}

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  done_at: string | null;
  source: 'generated' | 'manual';
  sort_order: number;
}

interface StatsSnapshot {
  range: Range;
  start_date: string;
  end_date: string;
  totals: {
    sent: number;
    replies: number;
    reply_rate_pct: number | null;
    connections_sent: number;
    connections_accepted: number;
    connection_accept_rate_pct: number | null;
    opens: number;
    open_rate_pct: number | null;
    clicks: number;
    click_rate_pct: number | null;
    bounces: number;
    bounce_rate_pct: number | null;
  };
}

// ============================================================================
// LIST VIEW
// ============================================================================

export function DataAnalysisTab() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // One dialog instance serves both create and edit. When `editingClient` is
  // null on open, the dialog is in create mode; when it carries pre-fill data,
  // it's in edit mode. Lifted to this top level so the same instance is
  // reachable from both the list view and the detail view.
  const [showDialog, setShowDialog] = useState(false);
  const [editingClient, setEditingClient] =
    useState<ClientAnalysisEditingState | null>(null);

  const listQuery = useQuery({
    queryKey: ['client_analysis', 'list'],
    queryFn: async (): Promise<ClientListRow[]> => {
      const { data, error } = await supabase
        .from('client_analysis')
        .select('id, display_name, last_generated_at, last_range, slug')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientListRow[];
    },
  });

  // Fires after the dialog succeeds (create or update). Invalidate both the
  // list and the (possibly newly-selected) row's detail; jump to the new row
  // on create, stay put on edit.
  const handleSaved = (clientId: string) => {
    queryClient.invalidateQueries({ queryKey: ['client_analysis', 'list'] });
    queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
    if (!editingClient) {
      setSelectedId(clientId);
    }
  };

  return (
    <>
      {selectedId ? (
        <DataAnalysisDetail
          clientId={selectedId}
          onBack={() => setSelectedId(null)}
          onEdit={(editing) => {
            setEditingClient(editing);
            setShowDialog(true);
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold">Client analyses</h2>
              <p className="text-sm text-muted-foreground">
                Generate per-client performance reports and to-do lists from HeyReach and Smartlead data.
              </p>
            </div>
            <Button
              onClick={() => {
                setEditingClient(null);
                setShowDialog(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> New client analysis
            </Button>
          </div>

          {listQuery.isLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {listQuery.error && (
            <Card className="border-destructive/50">
              <CardContent className="py-6">
                <p className="text-sm text-destructive">
                  Failed to load clients: {(listQuery.error as Error).message}
                </p>
              </CardContent>
            </Card>
          )}

          {listQuery.data && listQuery.data.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground">
                No clients yet. Click "New client analysis" to get started.
              </CardContent>
            </Card>
          )}

          {listQuery.data && listQuery.data.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {listQuery.data.map((c) => (
                <Card
                  key={c.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setSelectedId(c.id)}
                >
                  <CardContent className="pt-6">
                    <h3 className="font-semibold">{c.display_name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {c.last_generated_at
                        ? `Last generated ${new Date(c.last_generated_at).toLocaleString()} (${c.last_range})`
                        : 'Not yet generated'}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <NewClientAnalysisDialog
        open={showDialog}
        onOpenChange={(o) => {
          setShowDialog(o);
          if (!o) setEditingClient(null);
        }}
        editing={editingClient ?? undefined}
        onSaved={handleSaved}
      />
    </>
  );
}

// ============================================================================
// DETAIL VIEW
// ============================================================================

interface DetailQueryResult {
  row: ClientFullRow;
  checklist: ChecklistItem[];
}

function DataAnalysisDetail({
  clientId,
  onBack,
  onEdit,
}: {
  clientId: string;
  onBack: () => void;
  onEdit: (editing: ClientAnalysisEditingState) => void;
}) {
  const queryClient = useQueryClient();
  // Default the range selector to whatever was last generated, or 30d as a
  // conservative default. The selector is independent of stats_snapshot.range
  // until Regenerate is clicked.
  const [range, setRange] = useState<Range>('30d');

  const detailQuery = useQuery({
    queryKey: ['client_analysis', clientId],
    queryFn: async (): Promise<DetailQueryResult> => {
      const [rowRes, itemsRes] = await Promise.all([
        supabase
          .from('client_analysis')
          .select(
            'id, user_id, display_name, slug, heyreach_account_ids, smartlead_campaign_ids, analysis_text, stats_snapshot, last_generated_at, last_range',
          )
          .eq('id', clientId)
          .single(),
        supabase
          .from('client_checklist_items')
          .select('id, text, done, done_at, source, sort_order')
          .eq('client_analysis_id', clientId)
          .order('sort_order', { ascending: true }),
      ]);
      if (rowRes.error) throw rowRes.error;
      if (itemsRes.error) throw itemsRes.error;
      return {
        row: rowRes.data as ClientFullRow,
        checklist: (itemsRes.data ?? []) as ChecklistItem[],
      };
    },
  });

  // Sync the range selector to whatever was last generated, once, on first
  // successful load. After that the user owns the selector.
  // (Cheap effect-substitute: derive default from data, useState seed.)
  // Note: we leave manual selector changes alone — no auto-revert.

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        'generate-client-analysis',
        { body: { clientId, range } },
      );
      if (error) throw new Error(error.message);
      // supabase.functions.invoke surfaces non-2xx as data.error in some
      // cases, not as `error` — defensive check.
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return data as {
        analysis: string;
        stats: StatsSnapshot;
        checklist: ChecklistItem[];
        inserted_priorities: number;
      };
    },
    onSuccess: (data) => {
      toast.success(
        data.inserted_priorities > 0
          ? `Analysis updated — ${data.inserted_priorities} new ${
              data.inserted_priorities === 1 ? 'priority' : 'priorities'
            } added`
          : 'Analysis updated (no new priorities)',
      );
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client_analysis', 'list'] });
    },
    onError: (err: Error) => toast.error(`Generate failed: ${err.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await supabase
        .from('client_checklist_items')
        .update({ done, done_at: done ? new Date().toISOString() : null })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: ['client_analysis', clientId] });
      const prev = queryClient.getQueryData<DetailQueryResult>([
        'client_analysis',
        clientId,
      ]);
      queryClient.setQueryData<DetailQueryResult>(
        ['client_analysis', clientId],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            checklist: old.checklist.map((it) =>
              it.id === id
                ? { ...it, done, done_at: done ? new Date().toISOString() : null }
                : it,
            ),
          };
        },
      );
      return { prev };
    },
    onError: (err: Error, _vars, ctx) => {
      toast.error(`Update failed: ${err.message}`);
      if (ctx?.prev) {
        queryClient.setQueryData(['client_analysis', clientId], ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
    },
  });

  // ---- Stats-only refresh (range tabs + mount auto-fire) ------------------
  // Calls generate-client-analysis with statsOnly:true. The edge function
  // updates stats_snapshot + last_generated_at + last_range; analysis_text
  // and checklist are left untouched (the decoupling the spec calls out).
  const statsRefreshMutation = useMutation({
    mutationFn: async (newRange: Range) => {
      const { data, error } = await supabase.functions.invoke(
        'generate-client-analysis',
        { body: { clientId, range: newRange, statsOnly: true } },
      );
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client_analysis', 'list'] });
    },
    onError: (err: Error) => toast.error(`Stats refresh failed: ${err.message}`),
  });

  // Auto-refresh on mount + on every range change. Fires once per (clientId,
  // range) tuple — landing on the detail view triggers an initial refresh;
  // clicking a range tab triggers another. Never auto-runs Claude.
  useEffect(() => {
    if (!clientId) return;
    statsRefreshMutation.mutate(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, range]);

  // ---- Editable AI summary ------------------------------------------------
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [draftAnalysis, setDraftAnalysis] = useState('');

  const saveAnalysisMutation = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase
        .from('client_analysis')
        .update({ analysis_text: text })
        .eq('id', clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Summary saved');
      setEditingAnalysis(false);
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  });

  // ---- Editable priorities ------------------------------------------------
  // Add a new manual item (source='manual' — never touched by Regenerate's
  // additive merge, same persistence guarantee as a checked-off generated
  // item).
  const addPriorityMutation = useMutation({
    mutationFn: async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('Empty priority');
      const items = detailQuery.data?.checklist ?? [];
      const maxSort = items.reduce(
        (m, it) => Math.max(m, it.sort_order ?? 0),
        0,
      );
      const { error } = await supabase
        .from('client_checklist_items')
        .insert({
          client_analysis_id: clientId,
          text: trimmed,
          source: 'manual',
          done: false,
          sort_order: maxSort + 1,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
    },
    onError: (err: Error) => toast.error(`Add failed: ${err.message}`),
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('Empty priority');
      const { error } = await supabase
        .from('client_checklist_items')
        .update({ text: trimmed })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
    },
    onError: (err: Error) => toast.error(`Edit failed: ${err.message}`),
  });

  const deletePriorityMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('client_checklist_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="py-6">
          <p className="text-sm text-destructive">
            Failed to load client:{' '}
            {(detailQuery.error as Error | undefined)?.message ?? 'unknown error'}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { row, checklist } = detailQuery.data;
  const stats = row.stats_snapshot;
  const showLinkedIn = (row.heyreach_account_ids ?? []).length > 0;
  const showEmail = (row.smartlead_campaign_ids ?? []).length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3 mb-1">
            <ArrowLeft className="mr-2 h-4 w-4" /> All clients
          </Button>
          <h2 className="text-xl font-semibold">{row.display_name}</h2>
          <p className="text-xs text-muted-foreground">
            {row.last_generated_at
              ? `Last generated ${new Date(row.last_generated_at).toLocaleString()} (${row.last_range})`
              : 'Not yet generated'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
            <TabsList>
              <TabsTrigger value="7d">7d</TabsTrigger>
              <TabsTrigger value="30d">30d</TabsTrigger>
              <TabsTrigger value="mtd">MTD</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            onClick={() =>
              onEdit({
                clientId: row.id,
                displayName: row.display_name,
                heyreachAccountIds: row.heyreach_account_ids ?? [],
                smartleadCampaignIds: row.smartlead_campaign_ids ?? [],
              })
            }
          >
            <Pencil className="mr-2 h-4 w-4" /> Edit campaigns
          </Button>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {row.last_generated_at ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
      </div>

      {/* Stats — subtle "Refreshing…" indicator while statsOnly is in
          flight, dim the cards so the user sees something is happening
          without blocking interaction. */}
      {!stats ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            {statsRefreshMutation.isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading stats for {range}…
              </span>
            ) : (
              <>No stats yet. Pick a range and click {row.last_generated_at ? 'Regenerate' : 'Generate'}.</>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          {statsRefreshMutation.isPending && (
            <div className="absolute -top-2 right-0 z-10 flex items-center gap-1 text-xs text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded border">
              <Loader2 className="h-3 w-3 animate-spin" />
              Refreshing {range}…
            </div>
          )}
          <div
            className={
              statsRefreshMutation.isPending
                ? 'opacity-60 transition-opacity'
                : 'transition-opacity'
            }
          >
            <StatsGrid
              stats={stats}
              showLinkedIn={showLinkedIn}
              showEmail={showEmail}
            />
          </div>
        </div>
      )}

      {/* Per-campaign bar chart — between cards and AI summary per spec.
          Pulls its own data from synced_campaigns and self-hides if the
          client has no scope set. Note: not range-scoped (cumulative
          platform totals), so it does NOT react to range tab changes. */}
      <CampaignBarChart
        heyreachAccountIds={row.heyreach_account_ids ?? []}
        smartleadCampaignIds={row.smartlead_campaign_ids ?? []}
      />

      {/* Performance Summary — editable. Pencil flips the card into a
          textarea; Save persists analysis_text; Cancel discards the draft.
          Empty state still offers Edit so an operator can write a summary
          without ever calling AI. */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Performance Summary</h3>
            {!editingAnalysis && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setDraftAnalysis(row.analysis_text ?? '');
                  setEditingAnalysis(true);
                }}
              >
                <Pencil className="mr-1 h-3 w-3" /> Edit
              </Button>
            )}
          </div>
          {editingAnalysis ? (
            <div className="space-y-3">
              <Textarea
                value={draftAnalysis}
                onChange={(e) => setDraftAnalysis(e.target.value)}
                rows={Math.max(
                  10,
                  Math.min(22, draftAnalysis.split('\n').length + 2),
                )}
                className="font-mono text-sm"
                placeholder="Write your performance summary in markdown…"
                disabled={saveAnalysisMutation.isPending}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingAnalysis(false)}
                  disabled={saveAnalysisMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveAnalysisMutation.mutate(draftAnalysis)}
                  disabled={saveAnalysisMutation.isPending}
                >
                  {saveAnalysisMutation.isPending && (
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          ) : row.analysis_text ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{row.analysis_text}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No summary yet. Click <strong>Edit</strong> to write one manually,
              or <strong>Generate</strong> to create one with AI.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Responders — below the AI summary per spec. SHOW-ALL for the user
          (not filtered by campaigns; agent_leads has no reliable campaign id). */}
      <RespondersList />

      {/* Checklist (Priorities) — fully editable: toggle/add/edit/delete.
          AddManual items are source='manual' and never touched by
          Regenerate's additive merge, so they survive AI runs unchanged. */}
      <ChecklistSection
        items={checklist}
        onToggle={(id, done) => toggleMutation.mutate({ id, done })}
        onAdd={(text) => addPriorityMutation.mutate(text)}
        onUpdate={(id, text) => updatePriorityMutation.mutate({ id, text })}
        onDelete={(id) => deletePriorityMutation.mutate(id)}
        isMutating={
          addPriorityMutation.isPending ||
          updatePriorityMutation.isPending ||
          deletePriorityMutation.isPending
        }
      />
    </div>
  );
}

// ============================================================================
// STATS GRID (slim version of PlaygroundStatsGrid's StatCard)
// ============================================================================

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
}

function StatCard({ title, value, icon, subtitle }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className="p-3 rounded-full bg-primary/10">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtPct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}

function StatsGrid({
  stats,
  showLinkedIn,
  showEmail,
}: {
  stats: StatsSnapshot;
  showLinkedIn: boolean;
  showEmail: boolean;
}) {
  const t = stats.totals;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {stats.start_date} → {stats.end_date} ({stats.range})
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Messages sent"
          value={fmtNum(t.sent)}
          icon={<Send className="h-5 w-5 text-primary" />}
          subtitle="Email + LinkedIn DMs"
        />
        <StatCard
          title="Replies"
          value={fmtNum(t.replies)}
          icon={<MessageSquare className="h-5 w-5 text-primary" />}
          subtitle={fmtPct(t.reply_rate_pct) + ' reply rate'}
        />
        {showLinkedIn && (
          <StatCard
            title="Connections accepted"
            value={fmtNum(t.connections_accepted)}
            icon={<Linkedin className="h-5 w-5 text-primary" />}
            subtitle={
              fmtPct(t.connection_accept_rate_pct) +
              ' of ' +
              fmtNum(t.connections_sent) +
              ' sent'
            }
          />
        )}
        {showEmail && (
          <StatCard
            title="Opens"
            value={fmtNum(t.opens)}
            icon={<Mail className="h-5 w-5 text-primary" />}
            subtitle={fmtPct(t.open_rate_pct) + ' open rate'}
          />
        )}
        {showEmail && (
          <StatCard
            title="Clicks"
            value={fmtNum(t.clicks)}
            icon={<Percent className="h-5 w-5 text-primary" />}
            subtitle={fmtPct(t.click_rate_pct) + ' click rate'}
          />
        )}
        {showEmail && (
          <StatCard
            title="Bounces"
            value={fmtNum(t.bounces)}
            icon={<AlertTriangle className="h-5 w-5 text-primary" />}
            subtitle={fmtPct(t.bounce_rate_pct) + ' bounce rate'}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CHECKLIST
// ============================================================================

interface ChecklistSectionProps {
  items: ChecklistItem[];
  onToggle: (id: string, done: boolean) => void;
  onAdd: (text: string) => void;
  onUpdate: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  isMutating: boolean;
}

function ChecklistSection({
  items,
  onToggle,
  onAdd,
  onUpdate,
  onDelete,
  isMutating,
}: ChecklistSectionProps) {
  // All editing state is local to the component — only the resolved
  // operations bubble up to the parent's mutations.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState('');

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const saveEdit = () => {
    const t = editText.trim();
    if (t && editingId) {
      onUpdate(editingId, t);
    }
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const commitAdd = () => {
    const t = newText.trim();
    if (t) onAdd(t);
    setNewText('');
    setShowAdd(false);
  };

  const cancelAdd = () => {
    setNewText('');
    setShowAdd(false);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Priorities</h3>
          {!showAdd && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowAdd(true)}
              disabled={isMutating}
            >
              <Plus className="mr-1 h-3 w-3" /> Add priority
            </Button>
          )}
        </div>

        {items.length === 0 && !showAdd ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No priorities yet. Generate to populate, or use{' '}
            <strong>Add priority</strong>.
          </p>
        ) : (
          <ul className="space-y-1">
            {items.map((it) => {
              const isEditing = editingId === it.id;
              return (
                <li
                  key={it.id}
                  className="group flex items-start gap-2 rounded px-1 py-1 hover:bg-accent/30 transition-colors"
                >
                  <Checkbox
                    id={`checklist-${it.id}`}
                    checked={it.done}
                    onCheckedChange={(checked) => onToggle(it.id, !!checked)}
                    className="mt-1"
                    disabled={isEditing}
                  />

                  {isEditing ? (
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                        className="h-7 text-sm"
                      />
                      <Button size="sm" className="h-7 text-xs" onClick={saveEdit}>
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <label
                        htmlFor={`checklist-${it.id}`}
                        className={`text-sm flex-1 cursor-pointer pt-0.5 ${
                          it.done ? 'line-through text-muted-foreground' : ''
                        }`}
                      >
                        {it.text}
                      </label>
                      <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => startEdit(it.id, it.text)}
                          aria-label="Edit priority"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => onDelete(it.id)}
                          aria-label="Delete priority"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}

            {showAdd && (
              <li className="flex items-center gap-2 pt-2 mt-1 border-t">
                <Input
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitAdd();
                    if (e.key === 'Escape') cancelAdd();
                  }}
                  placeholder="New priority…"
                  autoFocus
                  className="h-7 text-sm"
                />
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={commitAdd}
                  disabled={!newText.trim()}
                >
                  Add
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={cancelAdd}
                >
                  Cancel
                </Button>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
