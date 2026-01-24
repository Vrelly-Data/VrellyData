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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { OutboundIntegration } from '@/hooks/useOutboundIntegrations';

interface EditIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: OutboundIntegration | null;
}

export function EditIntegrationDialog({ open, onOpenChange, integration }: EditIntegrationDialogProps) {
  const [teamId, setTeamId] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const queryClient = useQueryClient();

  // Get reply_team_id from integration (extended type)
  const currentTeamId = integration 
    ? (integration as OutboundIntegration & { reply_team_id?: string }).reply_team_id || ''
    : '';

  useEffect(() => {
    if (integration) {
      setTeamId(currentTeamId);
    }
  }, [integration, currentTeamId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!integration) return;

    setIsUpdating(true);
    
    const { error } = await supabase
      .from('outbound_integrations')
      .update({ 
        reply_team_id: teamId || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', integration.id);

    setIsUpdating(false);

    if (error) {
      toast.error('Failed to update integration');
      console.error('Update error:', error);
      return;
    }

    toast.success('Integration updated! Re-sync to apply changes.');
    queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTeamId('');
    }
    onOpenChange(open);
  };

  if (!integration) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Edit {integration.name}</DialogTitle>
          <DialogDescription>
            Update the team ID for this Reply.io integration. Leave empty to sync all campaigns.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="teamId" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Team ID
              </Label>
              <Input
                id="teamId"
                placeholder="Enter team ID from Reply.io"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                For agency accounts: find this in Reply.io → Settings → Agency/Clients
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isUpdating}>
              {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
