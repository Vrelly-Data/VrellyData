import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface SendContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: string[];
  projectId: string;
  projectName: string;
}

export function SendContactsDialog({
  open,
  onOpenChange,
  contactIds,
  projectId,
  projectName,
}: SendContactsDialogProps) {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [fetchingCampaigns, setFetchingCampaigns] = useState(false);

  useEffect(() => {
    if (open) {
      fetchCampaigns();
    }
  }, [open, projectId]);

  const fetchCampaigns = async () => {
    setFetchingCampaigns(true);
    try {
      const { data: externalCampaigns } = await supabase
        .from('external_campaigns')
        .select('*')
        .eq('project_id', projectId);

      setCampaigns(externalCampaigns || []);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      toast({
        title: 'Error',
        description: 'Failed to load campaigns',
        variant: 'destructive',
      });
    } finally {
      setFetchingCampaigns(false);
    }
  };

  const handleSend = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-contacts', {
        body: {
          project_id: projectId,
          campaign_id: selectedCampaign || null,
          contact_ids: contactIds,
        },
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Sent ${contactIds.length} contact(s) to ${projectName}`,
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error('Error sending contacts:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to send contacts',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send Contacts to {projectName}</DialogTitle>
          <DialogDescription>
            Select a campaign to send {contactIds.length} contact(s) to
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {fetchingCampaigns ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No campaigns found. Create a campaign first in settings.
            </div>
          ) : (
            <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
              <SelectTrigger>
                <SelectValue placeholder="Select campaign (optional)" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.campaign_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={loading || fetchingCampaigns}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}