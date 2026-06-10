// PublicClientReport — read-only, no-auth client report.
//
// Route: /r/:token
//
// Calls the public get-client-report edge function with the token from the
// URL. No JWT, no admin shell, no sidebar. The page never directly queries
// any Supabase table — all data isolation happens server-side, derived
// exclusively from the token's row in report_tokens.
//
// Components reused from the admin path:
//   * StatsGrid (presentational)
//   * CampaignBarChart (in data-prop mode, no internal fetch)
//   * RespondersList   (in data-prop mode, no internal fetch)
//
// Priorities are rendered inline (read-only, no checkbox mutation, with
// the "Added" timestamp). The performance summary is rendered via
// ReactMarkdown.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { StatsGrid, type StatsSnapshot } from '@/components/playground/StatsGrid';
import { CampaignBarChart, type ChartDatum } from '@/components/playground/CampaignBarChart';
import {
  RespondersList,
  type ResponderRow,
} from '@/components/playground/RespondersList';

// ----------------------------------------------------------------------------
// Payload shape (matches get-client-report's response exactly)
// ----------------------------------------------------------------------------

interface PublicReportSnapshot {
  id: string;
  analysis_text: string | null;
  stats_snapshot: StatsSnapshot | null;
  range: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

interface PublicReportPriority {
  id: string;
  text: string;
  done: boolean;
  done_at: string | null;
  source: string;
  sort_order: number;
  created_at: string | null;
}

interface PublicReport {
  client: { display_name: string };
  snapshots: PublicReportSnapshot[];
  priorities: PublicReportPriority[];
  responders: ResponderRow[];
  campaigns: ChartDatum[];
}

// ----------------------------------------------------------------------------
// Helpers — duplicate-but-tiny so the page never reaches into admin code
// ----------------------------------------------------------------------------

function formatSnapshotLabel(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  };
  const a = new Date(start).toLocaleDateString('en-US', opts);
  const b = new Date(end).toLocaleDateString('en-US', opts);
  if (a === b) return a;
  return `${a}–${b}`;
}

function formatItemDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function PublicClientReport() {
  const { token } = useParams<{ token: string }>();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null,
  );

  const reportQuery = useQuery({
    queryKey: ['public-client-report', token],
    queryFn: async (): Promise<PublicReport> => {
      if (!token) throw new Error('Missing token');
      const { data, error } = await supabase.functions.invoke(
        'get-client-report',
        { body: { token } },
      );
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return data as PublicReport;
    },
    enabled: !!token,
    // Public reports are read-only; a 60s cache is fine and reduces edge
    // function invocations on repeat opens of the same link.
    staleTime: 60_000,
  });

  // Auto-select the most recent snapshot once data lands. Doesn't override
  // a manual selection if the user has already picked an older one.
  useEffect(() => {
    const snaps = reportQuery.data?.snapshots;
    if (!snaps || snaps.length === 0) return;
    if (selectedSnapshotId && snaps.some((s) => s.id === selectedSnapshotId)) {
      return;
    }
    setSelectedSnapshotId(snaps[0].id);
  }, [reportQuery.data?.snapshots, selectedSnapshotId]);

  // ---- LOADING ------------------------------------------------------------
  if (reportQuery.isLoading) {
    return <ChromeWrapper><LoadingState /></ChromeWrapper>;
  }

  // ---- ERROR --------------------------------------------------------------
  if (reportQuery.error || !reportQuery.data) {
    return (
      <ChromeWrapper>
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-lg font-semibold">
              This report link is no longer active
            </p>
            <p className="text-sm text-muted-foreground">
              The link may have been revoked, expired, or never existed. Please
              contact the person who shared it with you for a new link.
            </p>
          </CardContent>
        </Card>
      </ChromeWrapper>
    );
  }

  // ---- LOADED -------------------------------------------------------------
  const { client, snapshots, priorities, responders, campaigns } =
    reportQuery.data;
  const selectedSnapshot =
    snapshots.find((s) => s.id === selectedSnapshotId) ?? snapshots[0] ?? null;

  return (
    <ChromeWrapper>
      <ReportHeader displayName={client.display_name} />

      {snapshots.length > 0 && (
        <Card>
          <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Showing snapshot:</span>
              <Select
                value={selectedSnapshotId ?? snapshots[0].id}
                onValueChange={(v) => setSelectedSnapshotId(v)}
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
            {selectedSnapshot && (
              <span className="text-xs text-muted-foreground">
                Generated {new Date(selectedSnapshot.created_at).toLocaleString()}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats grid */}
      <StatsBlock snapshot={selectedSnapshot} />

      {/* Bar chart — data prop mode, no internal fetch. */}
      {campaigns.length > 0 && <CampaignBarChart data={campaigns} />}

      {/* Performance Summary (read-only markdown) */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-sm font-semibold">Performance Summary</h3>
          {!selectedSnapshot ? (
            <p className="text-sm text-muted-foreground">
              No analyses available yet.
            </p>
          ) : selectedSnapshot.analysis_text ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{selectedSnapshot.analysis_text}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No summary for this snapshot.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Responders — data prop mode, no internal fetch. */}
      <RespondersList data={responders} />

      {/* Priorities — read-only inline list. No checkboxes that mutate. */}
      <PrioritiesReadonly items={priorities} />

      <ReportFooter />
    </ChromeWrapper>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function ChromeWrapper({ children }: { children: React.ReactNode }) {
  // Standalone shell — no admin sidebar, no app header. Mobile-friendly
  // padding + max-width container.
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-6">
        {children}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-3">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading report…</p>
    </div>
  );
}

function ReportHeader({ displayName }: { displayName: string }) {
  return (
    <header className="flex items-start justify-between gap-4 flex-wrap pb-2 border-b">
      <div>
        <h1 className="text-2xl font-bold">{displayName}</h1>
        <p className="text-sm text-muted-foreground mt-1">Performance Report</p>
      </div>
      <img
        src={vrellyLogo}
        alt="Vrelly"
        className="h-10 sm:h-12 shrink-0 opacity-80"
      />
    </header>
  );
}

function ReportFooter() {
  return (
    <footer className="text-center text-xs text-muted-foreground pt-4 border-t">
      Powered by Vrelly
    </footer>
  );
}

function StatsBlock({ snapshot }: { snapshot: PublicReportSnapshot | null }) {
  const stats = snapshot?.stats_snapshot ?? null;
  if (!stats) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-muted-foreground">
          No stats available yet.
        </CardContent>
      </Card>
    );
  }
  // showLinkedIn / showEmail derive from the snapshot's totals — if both
  // sides have zero LinkedIn / zero email activity, we still show the cards
  // (a value of 0 is meaningful information for a read-only report).
  return <StatsGrid stats={stats} showLinkedIn={true} showEmail={true} />;
}

function PrioritiesReadonly({
  items,
}: {
  items: PublicReportPriority[];
}) {
  // Sort: not-done first, then by sort_order. Done items collapse to the
  // bottom so the live work is up top. Hook called unconditionally to
  // respect the rules of hooks; empty-state still returns early below.
  const sorted = useMemo(
    () =>
      items
        .slice()
        .sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1;
          return a.sort_order - b.sort_order;
        }),
    [items],
  );

  if (items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          No priorities recorded.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">Priorities</h3>
          <p className="text-xs text-muted-foreground">
            Running list — shared across all snapshots, not point-in-time.
          </p>
        </div>
        <ul className="space-y-1">
          {sorted.map((it) => (
            <li
              key={it.id}
              className="flex items-start gap-3 rounded px-1 py-1.5"
            >
              {/* Visual-only checkbox — not interactive. The HTML `disabled`
                  attribute prevents focus/clicking; the `aria-disabled` echo
                  is for screen readers. */}
              <input
                type="checkbox"
                checked={it.done}
                disabled
                aria-disabled
                className="mt-1 h-4 w-4 rounded border-input"
              />
              <span
                className={`text-sm flex-1 ${
                  it.done ? 'line-through text-muted-foreground' : ''
                }`}
              >
                {it.text}
              </span>
              {it.created_at && (
                <span
                  className="text-[10px] text-muted-foreground pt-1 whitespace-nowrap shrink-0"
                  title={new Date(it.created_at).toLocaleString()}
                >
                  Added {formatItemDate(it.created_at)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
