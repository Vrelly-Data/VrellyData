import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Link2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

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
  
  // Get the most recent active Reply.io integration
  const activeIntegration = integrations.find(i => i.platform === 'reply.io' && i.is_active);

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
          {campaigns.map((campaign) => (
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
