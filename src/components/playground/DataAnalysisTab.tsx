import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { NewClientAnalysisDialog } from './NewClientAnalysisDialog';

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
  const [showNewDialog, setShowNewDialog] = useState(false);

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

  if (selectedId) {
    return (
      <DataAnalysisDetail
        clientId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-semibold">Client analyses</h2>
          <p className="text-sm text-muted-foreground">
            Generate per-client performance reports and to-do lists from HeyReach and Smartlead data.
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)}>
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

      <NewClientAnalysisDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onCreated={(id) => {
          queryClient.invalidateQueries({ queryKey: ['client_analysis', 'list'] });
          setSelectedId(id);
        }}
      />
    </div>
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
}: {
  clientId: string;
  onBack: () => void;
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

      {/* Stats */}
      {!stats ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            No stats yet. Pick a range and click {row.last_generated_at ? 'Regenerate' : 'Generate'}.
          </CardContent>
        </Card>
      ) : (
        <StatsGrid stats={stats} showLinkedIn={showLinkedIn} showEmail={showEmail} />
      )}

      {/* Analysis */}
      {row.analysis_text && (
        <Card>
          <CardContent className="pt-6 prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{row.analysis_text}</ReactMarkdown>
          </CardContent>
        </Card>
      )}

      {/* Checklist */}
      <ChecklistSection
        items={checklist}
        onToggle={(id, done) => toggleMutation.mutate({ id, done })}
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

function ChecklistSection({
  items,
  onToggle,
}: {
  items: ChecklistItem[];
  onToggle: (id: string, done: boolean) => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          No to-dos yet. Generate an analysis to populate priorities.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-sm font-semibold mb-3">Priorities</h3>
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-3">
              <Checkbox
                id={`checklist-${it.id}`}
                checked={it.done}
                onCheckedChange={(checked) => onToggle(it.id, !!checked)}
                className="mt-0.5"
              />
              <label
                htmlFor={`checklist-${it.id}`}
                className={`text-sm flex-1 cursor-pointer ${
                  it.done ? 'line-through text-muted-foreground' : ''
                }`}
              >
                {it.text}
              </label>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
