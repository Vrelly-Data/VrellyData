import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSyncedCampaigns, SyncedCampaign } from '@/hooks/useSyncedCampaigns';
import { Loader2, Users, Send, MessageSquare } from 'lucide-react';

interface CampaignListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  statusFilter?: string | null;
}

function getStatusBadge(status: string | null) {
  switch (status?.toLowerCase()) {
    case 'active':
      return <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">Active</Badge>;
    case 'paused':
      return <Badge className="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20">Paused</Badge>;
    case 'completed':
      return <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">Completed</Badge>;
    case 'archived':
      return <Badge className="bg-muted text-muted-foreground hover:bg-muted">Archived</Badge>;
    case 'draft':
      return <Badge variant="outline">Draft</Badge>;
    default:
      return <Badge variant="outline">{status || 'Unknown'}</Badge>;
  }
}

function CampaignRow({ campaign }: { campaign: SyncedCampaign }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0 mr-4">
        <p className="font-medium truncate">{campaign.name}</p>
        <div className="mt-1">{getStatusBadge(campaign.status)}</div>
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1" title="Contacts">
          <Users className="h-3.5 w-3.5" />
          <span>{campaign.stats?.peopleCount ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1" title="Sent">
          <Send className="h-3.5 w-3.5" />
          <span>{campaign.stats?.sent ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1" title="Replies">
          <MessageSquare className="h-3.5 w-3.5" />
          <span>{campaign.stats?.replies ?? '-'}</span>
        </div>
      </div>
    </div>
  );
}

export function CampaignListDialog({ open, onOpenChange, title, statusFilter }: CampaignListDialogProps) {
  const { data: campaigns, isLoading, error } = useSyncedCampaigns();

  const filteredCampaigns = campaigns?.filter(campaign => {
    if (!statusFilter) return true;
    return campaign.status?.toLowerCase() === statusFilter.toLowerCase();
  }) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {title} ({filteredCampaigns.length})
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            Failed to load campaigns
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No campaigns found
          </div>
        ) : (
          <ScrollArea className="max-h-[400px] pr-4">
            <div className="space-y-2">
              {filteredCampaigns.map(campaign => (
                <CampaignRow key={campaign.id} campaign={campaign} />
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
