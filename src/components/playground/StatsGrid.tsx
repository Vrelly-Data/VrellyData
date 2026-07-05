// Stat-cards grid for the Data Analysis report (admin + public).
//
// Extracted from DataAnalysisTab so the public PublicClientReport page can
// re-render the same UI without touching any admin state. Both consumers
// pass a StatsSnapshot in the exact shape generate-client-analysis returns
// — admin pulls it from client_analysis_snapshots, public pulls it from
// the get-client-report payload.
//
// Card set (fixed order — admin and public render identically). All six
// cards read from stats.totals — source-agnostic by construction so any
// new LinkedIn / email provider (HR, Reply.io LinkedIn channel, future)
// folds in via the totals merge in generate-client-analysis, not via a
// per-platform field read.
//   1. Connection Requests Sent  ← totals.connections_sent          (HR + RI.linkedin)
//   2. Connections Accepted      ← totals.connections_accepted      (HR + RI.linkedin)
//                                  + connection_accept_rate_pct subtitle
//   3. LinkedIn Messages Sent    ← totals.linkedin_messages_sent    (HR + RI.linkedin)
//   4. Emails Sent               ← totals.email_sent                (SL + RI.email)
//   5. Replies                   ← totals.replies                   (HR + SL + RI.linkedin + RI.email)
//                                  + reply_rate_pct subtitle
//   6. Bounces                   ← totals.bounces                   (SL + RI.email)
//                                  + bounce_rate_pct subtitle
//
// Cards 3 + 4 retain a fallback chain to the legacy per-platform fields
// (heyreach.sent / smartlead.totals.sent) so snapshots created before the
// channel-split totals existed continue to render HR/SL numbers
// correctly. They'll under-report Reply.io contribution until re-Generate,
// which is the honest behavior (the old snapshot didn't see Reply.io).
//
// A Smartlead-only client sees 0 on the three LinkedIn cards (and vice versa)
// rather than the old "show/hide by integration" behaviour — keeping the
// grid layout stable across clients reads more cleanly on the public report.

import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  MessageSquare,
  Linkedin,
  Mail,
  AlertTriangle,
  UserPlus,
  UserCheck,
} from 'lucide-react';

// All numeric fields are marked optional so a missing key on an older
// snapshot renders as 0 / "—" rather than NaN / "undefined". The shape
// generate-client-analysis writes today populates every key as a number
// (or null for rates); this only matters at the edges (snapshots created
// before a given field was added, or upstream API failures that left a
// field unwritten).
export interface StatsSnapshot {
  range: string;
  start_date: string;
  end_date: string;
  totals: {
    sent?: number;
    replies?: number;
    reply_rate_pct?: number | null;
    connections_sent?: number;
    connections_accepted?: number;
    connection_accept_rate_pct?: number | null;
    // Channel-split totals — populated by generate-client-analysis with
    // HR.sent + RI.linkedin.sent and SL.sent + RI.email.totals.sent
    // respectively. Optional because older snapshots predate them; cards
    // 3 + 4 fall back to the per-platform fields when these are missing.
    linkedin_messages_sent?: number;
    email_sent?: number;
    opens?: number;
    open_rate_pct?: number | null;
    clicks?: number;
    click_rate_pct?: number | null;
    bounces?: number;
    bounce_rate_pct?: number | null;
  };
  // Per-platform breakdowns at the top level, used for the channel-split
  // cards (LinkedIn Messages Sent / Emails Sent) AND the per-campaign bar
  // chart. Optional — older snapshots predating the snapshot-history
  // rewrite may not have them; older snapshots predating the per-campaign
  // HR addition may have heyreach without per_campaign[].
  heyreach?: {
    sent?: number;
    replies?: number;
    connections_sent?: number;
    connections_accepted?: number;
    // Range-scoped per-campaign breakdown (added by the per-campaign
    // GetOverallStats loop). Empty array means either (a) the client has
    // no HR campaigns in scope, or (b) every per-campaign call failed
    // (partial flag below disambiguates).
    per_campaign?: Array<{
      campaign_id: string;
      name: string;
      sent: number;
      replies: number;
      connections_sent: number;
      connections_accepted: number;
    }>;
    // True when at least one per-campaign call failed. Aggregate fields
    // above stay correct regardless because they come from the
    // unaffected account-level call.
    per_campaign_partial?: boolean;
  };
  smartlead?: {
    totals?: {
      sent?: number;
      replies?: number;
      opens?: number;
      clicks?: number;
      bounces?: number;
    };
    per_campaign?: Array<{
      campaign_id: string;
      // Display name resolved server-side from synced_campaigns. Falls
      // back to campaign_id when the campaign hasn't been synced yet.
      name?: string;
      sent?: number;
      replies?: number;
      opens?: number;
      clicks?: number;
      bounces?: number;
    }>;
  };
  // Step 3b: Reply.io contribution, split by channel because a single
  // Reply.io workspace can contain LinkedIn-only, email-only, AND
  // multichannel sequences. linkedin.per_campaign[] + email.per_campaign[]
  // each have their own partial flags so a transient failure on one
  // channel doesn't poison the other. Optional — older snapshots predating
  // Step 3b won't have this key, and snapshots for clients with no
  // reply_io_integration_id set in the picker also won't.
  reply_io?: {
    linkedin?: {
      sent?: number;
      replies?: number;
      connections_sent?: number;
      connections_accepted?: number;
      per_campaign?: Array<{
        campaign_id: string;
        name?: string;
        sent?: number;
        replies?: number;
        connections_sent?: number;
        connections_accepted?: number;
      }>;
      per_campaign_partial?: boolean;
    };
    email?: {
      totals?: {
        sent?: number;
        replies?: number;
        opens?: number;
        clicks?: number;
        bounces?: number;
      };
      per_campaign?: Array<{
        campaign_id: string;
        name?: string;
        sent?: number;
        replies?: number;
        opens?: number;
        clicks?: number;
        bounces?: number;
      }>;
      per_campaign_partial?: boolean;
    };
  };
}

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
  // Optional hover/click breakdown (e.g. Replies → LinkedIn vs Email). When
  // present the card becomes a Popover trigger, matching PlaygroundStatsGrid.
  popoverContent?: React.ReactNode;
}

function StatCard({ title, value, icon, subtitle, popoverContent }: StatCardProps) {
  const cardContent = (
    <Card className={popoverContent ? 'cursor-pointer hover:bg-accent/50 transition-colors' : ''}>
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

  if (popoverContent) {
    return (
      <Popover>
        <PopoverTrigger asChild>{cardContent}</PopoverTrigger>
        <PopoverContent side="bottom" className="w-72">{popoverContent}</PopoverContent>
      </Popover>
    );
  }
  return cardContent;
}

export function fmtNum(n: number): string {
  return n.toLocaleString();
}

// Accepts undefined as well as null so a missing rate field renders "—".
// `n == null` is truthy for both via loose equality.
export function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}

export function StatsGrid({
  stats,
}: {
  stats: StatsSnapshot;
  // Legacy props — retained as optional no-ops so the existing call sites
  // in DataAnalysisTab and PublicClientReport don't need to change.
  // The new card set always renders all 6 cards in a fixed order; a client
  // missing one channel just sees 0s on that channel's cards.
  showLinkedIn?: boolean;
  showEmail?: boolean;
}) {
  const t = stats.totals;

  // Replies KPI breakdown — LinkedIn vs Email, from the nested per-channel
  // reply counts (matches the Playground's Replies tooltip). Source-split:
  //   LinkedIn = heyreach + reply_io.linkedin
  //   Email    = smartlead + reply_io.email
  const linkedinReplies =
    (stats.heyreach?.replies ?? 0) + (stats.reply_io?.linkedin?.replies ?? 0);
  const emailReplies =
    (stats.smartlead?.totals?.replies ?? 0) + (stats.reply_io?.email?.totals?.replies ?? 0);
  const repliesTooltipContent = (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-foreground border-b pb-1">Replies Breakdown</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            Email Replies:
          </span>
          <span className="font-medium">{emailReplies.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Linkedin className="h-3.5 w-3.5" />
            LinkedIn Replies:
          </span>
          <span className="font-medium">{linkedinReplies.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {stats.start_date} → {stats.end_date} ({stats.range})
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* 1. Connection Requests Sent (LinkedIn outbound invitations) */}
        <StatCard
          title="Connection Requests Sent"
          value={fmtNum(t?.connections_sent ?? 0)}
          icon={<UserPlus className="h-5 w-5 text-primary" />}
        />

        {/* 2. Connections Accepted (LinkedIn invitations accepted) */}
        <StatCard
          title="Connections Accepted"
          value={fmtNum(t?.connections_accepted ?? 0)}
          icon={<UserCheck className="h-5 w-5 text-primary" />}
          subtitle={`${fmtPct(t?.connection_accept_rate_pct)} accepted`}
        />

        {/* 3. LinkedIn Messages Sent — source-agnostic via totals.
            Fallback to heyreach.sent for snapshots created before
            linkedin_messages_sent existed (those will under-report any
            Reply.io contribution until re-Generate). */}
        <StatCard
          title="LinkedIn Messages Sent"
          value={fmtNum(t?.linkedin_messages_sent ?? stats.heyreach?.sent ?? 0)}
          icon={<Linkedin className="h-5 w-5 text-primary" />}
        />

        {/* 4. Emails Sent — same pattern. Fallback to smartlead.totals.sent
            for older snapshots. */}
        <StatCard
          title="Emails Sent"
          value={fmtNum(t?.email_sent ?? stats.smartlead?.totals?.sent ?? 0)}
          icon={<Mail className="h-5 w-5 text-primary" />}
        />

        {/* 5. Replies (combined, with reply-rate subtitle + LinkedIn/Email
            breakdown on click — reuses the Playground's Replies tooltip). */}
        <StatCard
          title="Replies"
          value={fmtNum(t?.replies ?? 0)}
          icon={<MessageSquare className="h-5 w-5 text-primary" />}
          subtitle={`${fmtPct(t?.reply_rate_pct)} reply rate`}
          popoverContent={repliesTooltipContent}
        />

        {/* 6. Bounces (email deliverability, with bounce-rate subtitle) */}
        <StatCard
          title="Bounces"
          value={fmtNum(t?.bounces ?? 0)}
          icon={<AlertTriangle className="h-5 w-5 text-primary" />}
          subtitle={`${fmtPct(t?.bounce_rate_pct)} bounce rate`}
        />
      </div>
    </div>
  );
}
