import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2, Plus, Sparkles, Send, MessageSquare, Linkedin, Mail, AlertTriangle, Percent, Pencil, Trash2, History, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  NewClientAnalysisDialog,
  type ClientAnalysisEditingState,
} from './NewClientAnalysisDialog';
import { CampaignBarChart, isActiveCampaign } from './CampaignBarChart';
import { RespondersList } from './RespondersList';
import { StatsGrid, type StatsSnapshot } from './StatsGrid';
import { ShareReportDialog } from './ShareReportDialog';

type Range = '7d' | '30d' | 'mtd' | 'last_week';

interface ClientListRow {
  id: string;
  display_name: string;
  last_generated_at: string | null;
  last_range: string | null;
  slug: string;
}

// Per-client metadata. The legacy analysis_text / stats_snapshot /
// last_generated_at / last_range columns on client_analysis are still
// present in the schema (kept around for potential later deprecation) but
// the snapshot-based UI no longer reads them — selected snapshot drives
// stats + summary display.
interface ClientFullRow {
  id: string;
  user_id: string;
  display_name: string;
  slug: string;
  heyreach_account_ids: number[];
  smartlead_campaign_ids: string[];
  // Step 3b: single FK to a Reply.io outbound_integrations row. Null when
  // the client has no Reply.io workspace.
  reply_io_integration_id: string | null;
  // Per-client EXCLUDE list (external_campaign_id[]) of Reply.io campaigns
  // hidden from this client's report. Campaigns not listed are shown, so
  // campaigns synced later default to visible.
  excluded_reply_io_campaign_ids: string[] | null;
}

interface SnapshotRow {
  id: string;
  analysis_text: string | null;
  stats_snapshot: StatsSnapshot | null;
  range: Range;
  period_start: string;
  period_end: string;
  created_at: string;
}

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  done_at: string | null;
  source: 'generated' | 'manual';
  sort_order: number;
  created_at: string | null;
}

// StatsSnapshot moved to ./StatsGrid (the file that consumes it). Imported
// above so the existing references in this file resolve unchanged.

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
  snapshots: SnapshotRow[];
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
  // Default range for the NEXT Generate. Last week is the weekly-cadence
  // default per the spec. Range no longer controls the displayed snapshot
  // (that's `selectedSnapshotId` below) — it's strictly the parameter that
  // gets passed to the edge function when the operator clicks Generate.
  const [range, setRange] = useState<Range>('last_week');

  // Which historical snapshot the user is viewing. Auto-syncs to the most
  // recent on initial load + when a new one is generated. Null only when
  // the client has zero snapshots (first-run state).
  const [selectedSnapshotId, setSelectedSnapshotId] =
    useState<string | null>(null);

  // Share dialog visibility. Only one client at a time, opens to that
  // client's tokens.
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Transient live-preview stats from a statsOnly call. Returned by the edge
  // function but never persisted to a snapshot. Active only for the 7d/30d/
  // MTD range tabs — Last week is excluded (it would hit the untouched
  // client_analysis.last_range CHECK constraint in statsOnly mode, and the
  // weekly-cadence path is meant to land in a snapshot via full Generate).
  //
  // ---- PRECEDENCE in the stats grid ----------------------------------------
  // displayStats := livePreviewStats ?? selectedSnapshot.stats_snapshot
  //
  // i.e. live preview WINS if set. It gets cleared (snapshot view restored)
  // when any of:
  //   * the user picks "Last week" tab (no statsOnly path for last_week)
  //   * the user picks a different snapshot via the Select
  //   * a full Generate succeeds (the new snapshot is auto-selected; the
  //     transient preview is now stale)
  // Stale preview never persists across reloads — refresh the page and you
  // see the selected snapshot again.
  const [livePreviewStats, setLivePreviewStats] =
    useState<StatsSnapshot | null>(null);

  const detailQuery = useQuery({
    queryKey: ['client_analysis', clientId],
    queryFn: async (): Promise<DetailQueryResult> => {
      const [rowRes, snapsRes, itemsRes] = await Promise.all([
        supabase
          .from('client_analysis')
          .select(
            'id, user_id, display_name, slug, heyreach_account_ids, smartlead_campaign_ids, reply_io_integration_id, excluded_reply_io_campaign_ids',
          )
          .eq('id', clientId)
          .single(),
        supabase
          .from('client_analysis_snapshots')
          .select(
            'id, analysis_text, stats_snapshot, range, period_start, period_end, created_at',
          )
          .eq('client_id', clientId)
          .order('created_at', { ascending: false }),
        supabase
          .from('client_checklist_items')
          .select('id, text, done, done_at, source, sort_order, created_at')
          .eq('client_analysis_id', clientId)
          .order('sort_order', { ascending: true }),
      ]);
      if (rowRes.error) throw rowRes.error;
      if (snapsRes.error) throw snapsRes.error;
      if (itemsRes.error) throw itemsRes.error;
      return {
        row: rowRes.data as ClientFullRow,
        snapshots: (snapsRes.data ?? []) as unknown as SnapshotRow[],
        checklist: (itemsRes.data ?? []) as ChecklistItem[],
      };
    },
  });

  // Auto-select the most recent snapshot once data loads. Doesn't override
  // an existing selection — if the user clicked into an older snapshot and
  // we re-fetch (e.g. after edit), keep them on the one they were reading.
  useEffect(() => {
    const snaps = detailQuery.data?.snapshots;
    if (!snaps || snaps.length === 0) return;
    if (selectedSnapshotId && snaps.some((s) => s.id === selectedSnapshotId)) {
      return;
    }
    setSelectedSnapshotId(snaps[0].id);
  }, [detailQuery.data?.snapshots, selectedSnapshotId]);

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
        snapshot_id: string;
        analysis: string;
        stats: StatsSnapshot;
        checklist: ChecklistItem[];
        inserted_priorities: number;
      };
    },
    onSuccess: (data) => {
      toast.success(
        data.inserted_priorities > 0
          ? `New snapshot saved — ${data.inserted_priorities} new ${
              data.inserted_priorities === 1 ? 'priority' : 'priorities'
            } added`
          : 'New snapshot saved (no new priorities)',
      );
      // Jump to the snapshot we just created so the user sees fresh output,
      // and clear any live preview that was sitting on top — the new
      // snapshot's frozen stats are now the freshest thing we have.
      if (data.snapshot_id) setSelectedSnapshotId(data.snapshot_id);
      setLivePreviewStats(null);
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

  // ---- Live-preview stats (statsOnly) -------------------------------------
  // Invoked ONLY for the 7d / 30d / MTD range tabs — Last week is excluded.
  // The result is stored in livePreviewStats (above) rather than invalidating
  // the detail query, because we explicitly do NOT want this to replace any
  // saved snapshot data; it's an overlay on top of the selected snapshot's
  // frozen view.
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
      return data as { stats: StatsSnapshot; statsOnly: boolean };
    },
    onSuccess: (data) => {
      if (data?.stats) setLivePreviewStats(data.stats);
    },
    onError: (err: Error) =>
      toast.error(`Live preview failed: ${err.message}`),
  });

  // ---- Editable AI summary ------------------------------------------------
  // Edits target the SELECTED snapshot's analysis_text, not client_analysis.
  // Each snapshot is independently editable; navigating to another snapshot
  // shows that snapshot's text. Per spec, this is a per-snapshot edit, not
  // a per-client one.
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [draftAnalysis, setDraftAnalysis] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { isPlatformAdmin } = useIsPlatformAdmin();

  const saveAnalysisMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!selectedSnapshotId) throw new Error('No snapshot selected');
      const { error } = await supabase
        .from('client_analysis_snapshots')
        .update({ analysis_text: text })
        .eq('id', selectedSnapshotId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Summary saved');
      setEditingAnalysis(false);
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  });

  // ---- Delete snapshot (platform admins only) -----------------------------
  // Hard delete: client_analysis_snapshots has no soft-delete column and no
  // backup, so this is unrecoverable — hence the confirm dialog. Gated in the
  // UI by useIsPlatformAdmin and, independently, by the
  // "Platform admins can delete any snapshot" RLS policy (20260808130000).
  const deleteSnapshotMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('client_analysis_snapshots')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, deletedId) => {
      toast.success('Snapshot deleted');
      // The deleted snapshot may be the one on screen — clear the selection so
      // the list falls back to the newest remaining one on refetch.
      if (selectedSnapshotId === deletedId) setSelectedSnapshotId(null);
      setPendingDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['client_analysis', clientId] });
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
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

  const { row, snapshots, checklist } = detailQuery.data;
  const selectedSnapshot: SnapshotRow | null = selectedSnapshotId
    ? snapshots.find((s) => s.id === selectedSnapshotId) ?? null
    : snapshots[0] ?? null;
  // Precedence: live preview wins if set, else the selected snapshot's
  // saved stats. Documented on the livePreviewStats state declaration above.
  const stats = livePreviewStats ?? selectedSnapshot?.stats_snapshot ?? null;
  const isLivePreview = livePreviewStats !== null;
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
            {snapshots.length === 0
              ? 'No analyses yet. Pick a range and Generate to create the first one.'
              : `${snapshots.length} ${snapshots.length === 1 ? 'snapshot' : 'snapshots'} saved`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Tabs
            value={range}
            onValueChange={(v) => {
              const newRange = v as Range;
              setRange(newRange);
              // Last week never fires statsOnly: it would hit the legacy
              // last_range CHECK constraint, and weekly cadence is the
              // snapshot path. Snapshot picker wins; clear any preview.
              if (newRange === 'last_week') {
                setLivePreviewStats(null);
              } else {
                statsRefreshMutation.mutate(newRange);
              }
            }}
          >
            <TabsList>
              <TabsTrigger value="last_week">Last week</TabsTrigger>
              <TabsTrigger value="7d">7d</TabsTrigger>
              <TabsTrigger value="30d">30d</TabsTrigger>
              <TabsTrigger value="mtd">MTD</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            onClick={() => setShowShareDialog(true)}
          >
            <Share2 className="mr-2 h-4 w-4" /> Share with client
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              onEdit({
                clientId: row.id,
                displayName: row.display_name,
                heyreachAccountIds: row.heyreach_account_ids ?? [],
                smartleadCampaignIds: row.smartlead_campaign_ids ?? [],
                replyIoIntegrationId: row.reply_io_integration_id,
                excludedReplyIoCampaignIds:
                  row.excluded_reply_io_campaign_ids ?? [],
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
            {snapshots.length === 0 ? 'Generate' : 'Generate new snapshot'}
          </Button>
        </div>
      </div>

      {/* Snapshot picker — drives the stats + summary display below.
          Hidden until the client has at least one snapshot. */}
      <AlertDialog open={!!pendingDeleteId} onOpenChange={(o) => !o && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const s2 = snapshots.find((x) => x.id === pendingDeleteId);
                return s2
                  ? `This permanently deletes the ${s2.range} snapshot for ${formatSnapshotLabel(s2.period_start, s2.period_end)}, including its saved summary and stats. This cannot be undone.`
                  : 'This cannot be undone.';
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSnapshotMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingDeleteId) deleteSnapshotMutation.mutate(pendingDeleteId);
              }}
              disabled={deleteSnapshotMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSnapshotMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {snapshots.length > 0 && (
        <Card>
          <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Showing snapshot:</span>
              <Select
                value={selectedSnapshotId ?? snapshots[0].id}
                onValueChange={(v) => {
                  // Picking a snapshot is an explicit "show me the frozen
                  // view" — drop any live preview so the saved stats win.
                  setSelectedSnapshotId(v);
                  setLivePreviewStats(null);
                }}
              >
                <SelectTrigger className="w-auto min-w-[14rem] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {snapshots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {formatSnapshotLabel(s.period_start, s.period_end)} ({s.range})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              {selectedSnapshot && (
                <span className="text-xs text-muted-foreground">
                  Generated {new Date(selectedSnapshot.created_at).toLocaleString()}
                </span>
              )}
              {/* Admin-only. Snapshots are append-only by design, so repeated
                  Generate clicks leave exact-duplicate periods behind; this is
                  the only way to remove one without hand-run SQL. */}
              {isPlatformAdmin && selectedSnapshot && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  title="Delete this snapshot"
                  onClick={() => setPendingDeleteId(selectedSnapshot.id)}
                  disabled={deleteSnapshotMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats — drives off the precedence rule documented on
          livePreviewStats: live preview (7d/30d/MTD tab click) wins if set,
          otherwise the selected snapshot's frozen stats. "Refreshing…" chip
          + dim only appears while the statsOnly call is in flight; cleared
          state shows snapshot view immediately. */}
      {!stats ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            {statsRefreshMutation.isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading stats for {range}…
              </span>
            ) : snapshots.length === 0 ? (
              'No stats yet. Pick a range and click Generate.'
            ) : (
              'Selected snapshot has no stats data.'
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {isLivePreview && (
            <p className="text-xs text-muted-foreground italic">
              Live preview · {range} · not saved to a snapshot
            </p>
          )}
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
        </div>
      )}

      {/* Per-campaign bar chart — range-scoped to the SELECTED snapshot.
          Both HR and SL per_campaign data come from the snapshot's
          stats_snapshot; no separate synced_campaigns fetch. The chart is
          purely presentational.

          Zero-activity filter: drop any campaign with sent === 0 AND
          replies === 0 AND opens === 0 in the snapshot's range. Dead /
          test / dormant campaigns drop out cleanly. Applied here so the
          chart receives pre-filtered data; chart's empty-state message
          covers the "everything was inactive" case.

          selectedRange passes the local picker state so the chart can
          show a mismatch caption when the operator previews a different
          range than the snapshot was generated for. */}
      <CampaignBarChart
        data={[
          // LinkedIn rows: 4 metrics. linkedin_* dataKeys populated;
          // email_* left undefined so Recharts renders no email bars
          // for these rows.
          ...(selectedSnapshot?.stats_snapshot?.heyreach?.per_campaign ?? []).map(
            (c) => ({
              name: c.name,
              source: 'heyreach',
              linkedin_sent: c.sent ?? 0,
              linkedin_replies: c.replies ?? 0,
              linkedin_connections_sent: c.connections_sent ?? 0,
              linkedin_connections_accepted: c.connections_accepted ?? 0,
            }),
          ),
          // Reply.io LinkedIn rows — same 4 LI metrics + dataKeys as HR,
          // so they render in the same blue family. source discriminates
          // for isActiveCampaign + any future per-platform legend. Optional
          // chain: older snapshots predating Step 3b have no reply_io key.
          ...(selectedSnapshot?.stats_snapshot?.reply_io?.linkedin?.per_campaign ?? []).map(
            (c) => ({
              name: c.name ?? c.campaign_id,
              source: 'reply_io_linkedin',
              linkedin_sent: c.sent ?? 0,
              linkedin_replies: c.replies ?? 0,
              linkedin_connections_sent: c.connections_sent ?? 0,
              linkedin_connections_accepted: c.connections_accepted ?? 0,
            }),
          ),
          // Email rows: 2 metrics. email_* dataKeys populated; linkedin_*
          // left undefined — email has no connection concept, so those
          // bars are absent (not zero-height) for these rows.
          ...(selectedSnapshot?.stats_snapshot?.smartlead?.per_campaign ?? []).map(
            (c) => ({
              name: c.name ?? c.campaign_id,
              source: 'smartlead',
              email_sent: c.sent ?? 0,
              email_replies: c.replies ?? 0,
            }),
          ),
          // Reply.io email rows — same email_* dataKeys as Smartlead, so
          // they render in the same green/amber palette.
          ...(selectedSnapshot?.stats_snapshot?.reply_io?.email?.per_campaign ?? []).map(
            (c) => ({
              name: c.name ?? c.campaign_id,
              source: 'reply_io_email',
              email_sent: c.sent ?? 0,
              email_replies: c.replies ?? 0,
            }),
          ),
        ].filter(isActiveCampaign)}
        range={selectedSnapshot?.range}
        selectedRange={range}
        partial={
          selectedSnapshot?.stats_snapshot?.heyreach?.per_campaign_partial === true ||
          selectedSnapshot?.stats_snapshot?.reply_io?.linkedin?.per_campaign_partial === true ||
          selectedSnapshot?.stats_snapshot?.reply_io?.email?.per_campaign_partial === true
        }
      />

      {/* Performance Summary — editable, persists to the SELECTED snapshot.
          Each snapshot has its own analysis_text; navigating to another
          snapshot shows that one's text. Empty card still offers Edit so an
          operator can write summaries for snapshots that have none yet. */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Performance Summary</h3>
            {!editingAnalysis && selectedSnapshot && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setDraftAnalysis(selectedSnapshot.analysis_text ?? '');
                  setEditingAnalysis(true);
                }}
              >
                <Pencil className="mr-1 h-3 w-3" /> Edit
              </Button>
            )}
          </div>
          {!selectedSnapshot ? (
            <p className="text-sm text-muted-foreground">
              No snapshots yet. Generate to create the first one.
            </p>
          ) : editingAnalysis ? (
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
          ) : selectedSnapshot.analysis_text ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{selectedSnapshot.analysis_text}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No summary for this snapshot. Click <strong>Edit</strong> to write
              one manually.
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

      <ShareReportDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        clientId={row.id}
        clientDisplayName={row.display_name}
      />
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

// "Jun 2–Jun 8" / "May 26–Jun 1" / "Jun 1" (single-day MTD). Dates stored as
// PG DATE columns (UTC midnight); formatting in UTC keeps Jun-2 from sliding
// to Jun-1 for operators west of London.
function formatSnapshotLabel(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  };
  const startMD = new Date(start).toLocaleDateString('en-US', opts);
  const endMD = new Date(end).toLocaleDateString('en-US', opts);
  if (startMD === endMD) return startMD;
  return `${startMD}–${endMD}`;
}

// Compact "Jun 8" formatter for the per-priority added-date stamp. Falls
// back to empty string for null/invalid input so the JSX can short-circuit.
function formatItemDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
        <div className="flex items-start justify-between mb-3 gap-3">
          <div>
            <h3 className="text-sm font-semibold">Priorities</h3>
            <p className="text-xs text-muted-foreground">
              Running list — shared across all snapshots, not point-in-time.
            </p>
          </div>
          {!showAdd && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs shrink-0"
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
                      {it.created_at && (
                        <span
                          className="text-[10px] text-muted-foreground pt-1 whitespace-nowrap shrink-0"
                          title={new Date(it.created_at).toLocaleString()}
                        >
                          Added {formatItemDate(it.created_at)}
                        </span>
                      )}
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
