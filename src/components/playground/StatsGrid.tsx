// Stat-cards grid for the Data Analysis report (admin + public).
//
// Extracted from DataAnalysisTab so the public PublicClientReport page can
// re-render the same UI without touching any admin state. Both consumers
// pass a StatsSnapshot in the exact shape generate-client-analysis returns
// — admin pulls it from client_analysis_snapshots, public pulls it from
// the get-client-report payload.

import { Card, CardContent } from '@/components/ui/card';
import {
  Send,
  MessageSquare,
  Linkedin,
  Mail,
  AlertTriangle,
  Percent,
} from 'lucide-react';

export interface StatsSnapshot {
  range: string;
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

export function fmtNum(n: number): string {
  return n.toLocaleString();
}

export function fmtPct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}

export function StatsGrid({
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
