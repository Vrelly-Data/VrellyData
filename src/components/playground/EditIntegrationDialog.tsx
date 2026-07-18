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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Loader2, RefreshCw, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { OutboundIntegration } from '@/hooks/useOutboundIntegrations';

interface ReplyTeam {
  id: number;
  name: string;
}

interface EditIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: OutboundIntegration | null;
}

export function EditIntegrationDialog({ open, onOpenChange, integration }: EditIntegrationDialogProps) {
  const [teamId, setTeamId] = useState('');
  // New API key to replace the stored one (e.g. after a Reply.io key rotation).
  // Blank = leave the existing key untouched.
  const [apiKey, setApiKey] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  const [teams, setTeams] = useState<ReplyTeam[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const queryClient = useQueryClient();

  const currentTeamId = integration?.reply_team_id || '';

  useEffect(() => {
    if (integration) {
      setTeamId(currentTeamId);
      setApiKey('');
      setTeams([]);
      setTeamsLoaded(false);
    }
  }, [integration, currentTeamId]);

  const handleLoadTeams = async () => {
    if (!integration) return;

    setIsLoadingTeams(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-integration-teams', {
        body: { integrationId: integration.id },
      });

      if (error) throw error;

      if (data.error) {
        toast.error(data.error);
        return;
      }

      setTeams(data.teams || []);
      setTeamsLoaded(true);

      if (data.teams?.length === 0) {
        toast.info('No teams found. You can enter a Team ID manually.');
      } else if (data.isAgencyAccount) {
        toast.success(`Found ${data.teams.length} teams`);
      } else {
        toast.success('Team loaded');
      }
    } catch (error) {
      console.error('Failed to load teams:', error);
      toast.error('Failed to load teams. You can enter a Team ID manually.');
    } finally {
      setIsLoadingTeams(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!integration) return;

    setIsUpdating(true);

    const updates: Record<string, unknown> = {
      reply_team_id: teamId || null,
      updated_at: new Date().toISOString(),
    };

    // If a new API key was entered, validate it (same path as the connect
    // flow) BEFORE writing, then re-store it on THIS row — no delete, no new
    // row, so reply_team_id / leads / campaigns are preserved.
    const newKey = apiKey.trim();
    if (newKey) {
      const { data: v, error: vErr } = await supabase.functions.invoke('validate-api-key', {
        body: { platform: integration.platform, apiKey: newKey },
      });
      if (vErr) {
        setIsUpdating(false);
        toast.error('Could not validate the API key. Please try again.');
        return;
      }
      if (!(v as { valid?: boolean; error?: string })?.valid) {
        setIsUpdating(false);
        toast.error((v as { error?: string })?.error || 'Invalid API key.');
        return;
      }
      updates.api_key_encrypted = newKey;
    }

    const { error } = await supabase
      .from('outbound_integrations')
      .update(updates)
      .eq('id', integration.id);

    setIsUpdating(false);

    if (error) {
      toast.error('Failed to update integration');
      console.error('Update error:', error);
      return;
    }

    toast.success(
      newKey
        ? 'API key updated — Send Reply should work again.'
        : 'Integration updated! Re-sync to apply changes.',
    );
    queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTeamId('');
      setApiKey('');
      setTeams([]);
      setTeamsLoaded(false);
    }
    onOpenChange(open);
  };

  if (!integration) return null;

  const showDropdown = teamsLoaded && teams.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit {integration.name}</DialogTitle>
          <DialogDescription>
            Update the team ID for this Reply.io integration. Leave empty to sync all campaigns.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="teamId" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Team ID
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadTeams}
                  disabled={isLoadingTeams}
                  className="h-7 text-xs"
                >
                  {isLoadingTeams ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  Load Teams
                </Button>
              </div>
              
              {showDropdown ? (
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a team..." />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    <SelectItem value="">All Teams (no filter)</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={String(team.id)}>
                        {team.name} ({team.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="teamId"
                  placeholder="Enter team ID or click Load Teams"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                />
              )}
              
              <p className="text-xs text-muted-foreground">
                {showDropdown
                  ? "Select a team to sync, or choose 'All Teams' to sync everything."
                  : "For agency accounts: click 'Load Teams' to see available clients."}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="apiKey" className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                API Key
              </Label>
              <Input
                id="apiKey"
                type="password"
                autoComplete="off"
                placeholder="Leave blank to keep the current key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Paste a new key to replace the stored one — e.g. after a Reply.io
                key rotation. It's validated before saving and replaces the key on
                this integration (leads, campaigns, and team stay intact).
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
