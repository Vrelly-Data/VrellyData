import { useMemo, useState } from 'react';
import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Link2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// Keys used by the filter pills. 'in_progress' is the canonical key for the
// "Active" pill; Reply.io's `active` status is treated as synonymous so both
// sync conventions group under one label instead of fragmenting.
const FIXED_PILL_KEYS = new Set(['in_progress', 'active', 'finished', 'paused']);

// Title-cases a raw status value for dynamic pill labels (e.g. draft → Draft,
// in_progress → In Progress). Used only for the pills that don't have a
// hardcoded display label.
function toPillLabel(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getStatusBadge(status: string | null) {
  const statusLower = (status || 'unknown').toLowerCase();
  
  switch (statusLower) {
    case 'active':
      return <Badge className="bg-green-500/15 text-green-600 border-green-500/30">Active</Badge>;
    case 'paused':
      return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30">Paused</Badge>;
    case 'completed':
      return <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30">Completed</Badge>;
    case 'archived':
      return <Badge className="bg-muted text-muted-foreground border-muted">Archived</Badge>;
    case 'draft':
      return <Badge className="bg-gray-500/15 text-gray-600 border-gray-500/30">Draft</Badge>;
    default:
      return <Badge variant="outline">{status || 'Unknown'}</Badge>;
  }
}

export function CampaignsTable() {
  const { data: campaigns, isLoading, error } = useSyncedCampaigns();
  const { integrations, linkAllCampaigns } = useOutboundIntegrations();

  // Status filter. 'in_progress' is the default and covers HeyReach's
  // in_progress + Reply.io's active. 'all' disables filtering.
  const [filter, setFilter] = useState<string>('in_progress');

  // Get the most recent active Reply.io integration
  const activeIntegration = integrations.find(i => i.platform === 'reply.io' && i.is_active);

  // Counts by status across ALL returned campaigns. Drives pill visibility
  // (hide pills with count === 0, except "All") and the badge numbers.
  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    (campaigns ?? []).forEach((c) => {
      const s = (c.status ?? 'unknown').toLowerCase();
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    });

    const activeCount = (byStatus.in_progress ?? 0) + (byStatus.active ?? 0);

    const extras = Object.entries(byStatus)
      .filter(([s, n]) => n > 0 && !FIXED_PILL_KEYS.has(s))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => ({ status, count }));

    return {
      total: campaigns?.length ?? 0,
      in_progress: activeCount,
      finished: byStatus.finished ?? 0,
      paused: byStatus.paused ?? 0,
      extras,
    };
  }, [campaigns]);

  // Apply the current filter to the rendered rows. 'in_progress' matches both
  // in_progress and active so Reply.io's convention works alongside HeyReach.
  const filteredCampaigns = useMemo(() => {
    if (!campaigns) return [];
    if (filter === 'all') return campaigns;
    if (filter === 'in_progress') {
      return campaigns.filter((c) => {
        const s = (c.status ?? '').toLowerCase();
        return s === 'in_progress' || s === 'active';
      });
    }
    return campaigns.filter((c) => (c.status ?? '').toLowerCase() === filter);
  }, [campaigns, filter]);

  // Pill list in display order — hidden entries pruned.
  type Pill = { key: string; label: string; count: number };
  const pills: Pill[] = [
    { key: 'in_progress', label: 'Active', count: counts.in_progress },
    { key: 'all', label: 'All', count: counts.total },
    { key: 'finished', label: 'Finished', count: counts.finished },
    { key: 'paused', label: 'Paused', count: counts.paused },
    ...counts.extras.map((e) => ({
      key: e.status,
      label: toPillLabel(e.status),
      count: e.count,
    })),
  ].filter((p) => p.key === 'all' || p.count > 0);

  const handleLinkAll = () => {
    if (activeIntegration) {
      linkAllCampaigns.mutate(activeIntegration.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load campaigns
      </div>
    );
  }

  if (!campaigns || campaigns.length === 0) {
    return (
      <div className="text-center py-8 space-y-4">
        <p className="text-muted-foreground">
          {activeIntegration
            ? 'No linked campaigns yet. Use "Manage Campaigns" or link them all below.'
            : 'No campaigns synced yet. Run a sync on one of your connected integrations to populate this table.'}
        </p>
        {activeIntegration && (
          <Button
            onClick={handleLinkAll}
            disabled={linkAllCampaigns.isPending}
            variant="outline"
            className="gap-2"
          >
            {linkAllCampaigns.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            Link All Campaigns
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Status filter pills */}
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          {pills.map((p) => (
            <TabsTrigger key={p.key} value={p.key}>
              {p.label} ({p.count})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Contacts</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">Opens</TableHead>
              <TableHead className="text-right">Replies</TableHead>
              <TableHead>Last Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCampaigns.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-sm text-muted-foreground py-8"
                >
                  No campaigns match this filter.
                </TableCell>
              </TableRow>
            ) : (
              filteredCampaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium max-w-[300px] truncate">
                    {campaign.name}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(campaign.status)}
                  </TableCell>
                  <TableCell className="text-right">
                    {campaign.stats?.peopleCount ?? '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {campaign.stats?.sent ?? campaign.stats?.delivered ?? '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {campaign.stats?.opens ?? '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {campaign.stats?.replies ?? '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDistanceToNow(new Date(campaign.updated_at), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
