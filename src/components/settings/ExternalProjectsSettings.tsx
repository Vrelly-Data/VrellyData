import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function ExternalProjectsSettings() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const { integrations, addIntegration, deleteIntegration } = useOutboundIntegrations();

  const heyreachIntegrations = integrations.filter(i => i.platform === 'heyreach');

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    setConnecting(true);
    try {
      const result = await addIntegration.mutateAsync({
        platform: 'heyreach',
        name: name.trim() || 'HeyReach',
        apiKey: apiKey.trim(),
      });

      // Trigger campaign sync after adding
      if (result?.id) {
        try {
          const { error } = await supabase.functions.invoke('sync-heyreach-campaigns', {
            body: { integrationId: result.id },
          });
          if (error) {
            console.warn('Campaign sync failed:', error);
          } else {
            toast.success('HeyReach connected and campaigns synced');
          }
        } catch (err) {
          console.warn('Campaign sync error:', err);
        }
      }

      setApiKey('');
      setName('');
      setIsDialogOpen(false);
    } catch {
      // error toast handled by useOutboundIntegrations
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async (integrationId: string) => {
    setSyncingId(integrationId);
    try {
      const { error } = await supabase.functions.invoke('sync-heyreach-campaigns', {
        body: { integrationId },
      });
      if (error) throw error;
      toast.success('Campaigns synced');
    } catch (err) {
      toast.error('Failed to sync campaigns');
      console.error(err);
    } finally {
      setSyncingId(null);
    }
  };

  const webhookUrl = (integrationId: string) =>
    `https://lgnvolndyftsbcjprmic.supabase.co/functions/v1/heyreach-webhook/${integrationId}`;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Integrations</h3>
          <p className="text-sm text-muted-foreground">
            Connect outbound platforms to power the Agent inbox
          </p>
        </div>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Connect HeyReach
        </Button>
      </div>

      {heyreachIntegrations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">
              No integrations connected
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Connect HeyReach
            </Button>
          </CardContent>
        </Card>
      ) : (
        heyreachIntegrations.map((integration) => (
          <Card key={integration.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">{integration.name}</CardTitle>
                  <Badge variant="outline">HeyReach</Badge>
                  <Badge variant={integration.is_active ? 'default' : 'secondary'}>
                    {integration.sync_status || 'pending'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSync(integration.id)}
                    disabled={syncingId === integration.id}
                  >
                    <RefreshCw className={`h-4 w-4 ${syncingId === integration.id ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteIntegration.mutate(integration.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              {integration.last_synced_at && (
                <CardDescription>
                  Last synced: {new Date(integration.last_synced_at).toLocaleString()}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Webhook URL (paste into HeyReach)</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrl(integration.id)}
                    className="text-xs font-mono bg-muted"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl(integration.id));
                      toast.success('Copied webhook URL');
                    }}
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Set this as your webhook URL in HeyReach settings with event EVERY_MESSAGE_REPLY_RECEIVED
                </p>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect HeyReach</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="hr-name">Name (optional)</Label>
              <Input
                id="hr-name"
                placeholder="My HeyReach Account"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hr-key">API Key</Label>
              <Input
                id="hr-key"
                type="password"
                placeholder="Enter your HeyReach API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Find your API key in HeyReach under Settings &gt; API
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={!apiKey.trim() || connecting}>
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
