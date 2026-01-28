import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Users } from 'lucide-react';
import { useAvailableCampaigns, AvailableCampaign } from '@/hooks/useAvailableCampaigns';

interface ManageCampaignsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationId: string | null;
}

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'active':
      return <Badge className="bg-green-500/15 text-green-600 border-green-500/30 text-xs">Active</Badge>;
    case 'paused':
      return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-xs">Paused</Badge>;
    case 'completed':
      return <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-xs">Completed</Badge>;
    case 'archived':
      return <Badge className="bg-muted text-muted-foreground border-muted text-xs">Archived</Badge>;
    case 'draft':
      return <Badge className="bg-gray-500/15 text-gray-600 border-gray-500/30 text-xs">Draft</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

export function ManageCampaignsDialog({ open, onOpenChange, integrationId }: ManageCampaignsDialogProps) {
  const { campaigns, isLoading, error, refetch, bulkUpdateLinks, isUpdating } = useAvailableCampaigns(integrationId);
  const [searchQuery, setSearchQuery] = useState('');
  const [localSelections, setLocalSelections] = useState<Map<string, boolean>>(new Map());
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize local selections when campaigns load
  useEffect(() => {
    if (campaigns.length > 0 && localSelections.size === 0) {
      const initial = new Map<string, boolean>();
      campaigns.forEach(c => initial.set(c.id, c.isLinked));
      setLocalSelections(initial);
      setHasChanges(false);
    }
  }, [campaigns]);

  // Reset when dialog opens
  useEffect(() => {
    if (open && integrationId) {
      refetch();
      setSearchQuery('');
      // Reset local selections
      const initial = new Map<string, boolean>();
      campaigns.forEach(c => initial.set(c.id, c.isLinked));
      setLocalSelections(initial);
      setHasChanges(false);
    }
  }, [open, integrationId]);

  const filteredCampaigns = useMemo(() => {
    if (!searchQuery.trim()) return campaigns;
    const query = searchQuery.toLowerCase();
    return campaigns.filter(c => c.name.toLowerCase().includes(query));
  }, [campaigns, searchQuery]);

  const linkedCount = useMemo(() => {
    return Array.from(localSelections.values()).filter(Boolean).length;
  }, [localSelections]);

  const allSelected = filteredCampaigns.length > 0 && filteredCampaigns.every(c => localSelections.get(c.id));
  const someSelected = filteredCampaigns.some(c => localSelections.get(c.id));

  const handleToggle = (campaignId: string) => {
    const newSelections = new Map(localSelections);
    newSelections.set(campaignId, !newSelections.get(campaignId));
    setLocalSelections(newSelections);
    setHasChanges(true);
  };

  const handleSelectAll = () => {
    const newSelections = new Map(localSelections);
    filteredCampaigns.forEach(c => newSelections.set(c.id, true));
    setLocalSelections(newSelections);
    setHasChanges(true);
  };

  const handleDeselectAll = () => {
    const newSelections = new Map(localSelections);
    filteredCampaigns.forEach(c => newSelections.set(c.id, false));
    setLocalSelections(newSelections);
    setHasChanges(true);
  };

  const handleSave = async () => {
    // Find changes
    const updates: { id: string; isLinked: boolean }[] = [];
    campaigns.forEach(c => {
      const newValue = localSelections.get(c.id) ?? false;
      if (newValue !== c.isLinked) {
        updates.push({ id: c.id, isLinked: newValue });
      }
    });

    if (updates.length > 0) {
      await bulkUpdateLinks(updates);
    }
    
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Campaigns</DialogTitle>
          <DialogDescription>
            Select which campaigns to track. Only linked campaigns will be synced for detailed data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search campaigns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Select All / Deselect All */}
          <div className="flex items-center gap-4 text-sm">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              disabled={allSelected}
              className="h-8"
            >
              Select All ({filteredCampaigns.length})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeselectAll}
              disabled={!someSelected}
              className="h-8"
            >
              Deselect All
            </Button>
            <span className="ml-auto text-muted-foreground">
              {linkedCount} of {campaigns.length} linked
            </span>
          </div>

          {/* Campaign List */}
          <ScrollArea className="flex-1 border rounded-md">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading campaigns...</span>
              </div>
            ) : error ? (
              <div className="text-center py-12 text-destructive">
                Failed to load campaigns: {error.message}
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchQuery ? 'No campaigns match your search' : 'No campaigns found'}
              </div>
            ) : (
              <div className="divide-y">
                {filteredCampaigns.map((campaign) => (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    isChecked={localSelections.get(campaign.id) ?? false}
                    onToggle={() => handleToggle(campaign.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isUpdating || !hasChanges}>
            {isUpdating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CampaignRowProps {
  campaign: AvailableCampaign;
  isChecked: boolean;
  onToggle: () => void;
}

function CampaignRow({ campaign, isChecked, onToggle }: CampaignRowProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer"
      onClick={onToggle}
    >
      <Checkbox
        checked={isChecked}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{campaign.name}</div>
      </div>
      {getStatusBadge(campaign.status)}
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>{campaign.peopleCount}</span>
      </div>
    </div>
  );
}
