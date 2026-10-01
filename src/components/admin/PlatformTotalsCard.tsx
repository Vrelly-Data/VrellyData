import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { Globe } from 'lucide-react';
import { PLATFORM_STAT_METRICS, PlatformStatMetric, usePlatformTotals } from '@/hooks/useInferenceData';

const METRIC_LABELS: Record<PlatformStatMetric, string> = {
  contacts_reached: 'Contacts Reached',
  emails_sent: 'Emails Sent',
  li_messages_sent: 'LI Messages Sent',
  li_connections_sent: 'LI Connections Sent',
  li_connections_accepted: 'LI Connections Accepted',
  replies: 'Replies',
  interested: 'Interested',
  not_interested: 'Not Interested',
  ooo: 'Out of Office',
};

const PLATFORM_LABELS: Record<string, string> = {
  smartlead: 'Smartlead',
  'reply.io': 'Reply.io',
  heyreach: 'HeyReach',
  other: 'Other',
};

function NotTracked() {
  return <span className="text-xs font-normal text-muted-foreground">not tracked</span>;
}

// Provider-reported all-time totals from platform_stats_snapshots (latest snapshot per account).
// Null means the platform does not track the metric — never render it as 0.
export function PlatformTotalsCard() {
  const { data, isLoading, error } = usePlatformTotals();
  const accounts = data?.accounts ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" /> Platform Totals (All Time)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Reported by each outbound platform, latest snapshot per account. Summed across accounts (not de-duplicated)
          and not affected by the filters below.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">Failed to load platform totals: {(error as Error).message}</p>
        ) : !isLoading && accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No platform snapshots yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {PLATFORM_STAT_METRICS.map((metric) => {
                const total = data?.totals[metric];
                return (
                  <Card key={metric}>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">{METRIC_LABELS[metric]}</p>
                      <p className="text-2xl font-semibold mt-1">
                        {isLoading || !total ? '…' : total.value === null ? <NotTracked /> : total.value.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {isLoading || !total
                          ? ' '
                          : total.trackedBy === accounts.length
                            ? `All ${accounts.length} accounts`
                            : `Tracked by ${total.trackedBy} of ${accounts.length} accounts`}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {accounts.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      {PLATFORM_STAT_METRICS.map((metric) => (
                        <TableHead key={metric} className="text-right whitespace-nowrap">
                          {METRIC_LABELS[metric]}
                        </TableHead>
                      ))}
                      <TableHead className="whitespace-nowrap">Snapshot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="whitespace-nowrap" title={account.notes ?? undefined}>
                          <div className="font-medium">{account.account_label}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {PLATFORM_LABELS[account.platform] ?? account.platform}
                          </div>
                        </TableCell>
                        {PLATFORM_STAT_METRICS.map((metric) => (
                          <TableCell key={metric} className="text-right tabular-nums whitespace-nowrap">
                            {account[metric] === null || account[metric] === undefined ? (
                              <NotTracked />
                            ) : (
                              account[metric]!.toLocaleString()
                            )}
                          </TableCell>
                        ))}
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {format(new Date(account.snapshot_at), 'MMM d, yyyy')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
