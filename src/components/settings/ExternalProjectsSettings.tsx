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
import { toast } from 'sonner';

type ConnectPlatform = 'heyreach' | 'reply.io';

const PLATFORM_LABEL: Record<string, string> = {
  heyreach: 'HeyReach',
  'reply.io': 'Reply.io',
  replyio: 'Reply.io',
  smartlead: 'Smartlead',
};
const platformLabel = (p: string) => PLATFORM_LABEL[p?.toLowerCase()] ?? p;
const isHeyReach = (p: string) => p?.toLowerCase() === 'heyreach';
const isReplyIo = (p: string) => ['reply.io', 'replyio'].includes(p?.toLowerCase());

export function ExternalProjectsSettings() {
  // Platform-driven connect dialog (null = closed). Replaces the old
  // HeyReach-only boolean so the same dialog can connect either platform.
  const [connectPlatform, setConnectPlatform] = useState<ConnectPlatform | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [replyTeamId, setReplyTeamId] = useState('');
  const [connecting, setConnecting] = useState(false);

  const { integrations, addIntegration, deleteIntegration, syncIntegration } =
    useOutboundIntegrations();

  // Render ALL of the team's integrations regardless of platform — RLS already
  // scopes the query to the user's team, so no client-side platform filter.
  // (The old `filter(i => i.platform === 'heyreach')` hid the Reply.io row.)

  const handleConnect = async () => {
    if (!connectPlatform || !apiKey.trim()) return;
    setConnecting(true);
    try {
      await addIntegration.mutateAsync({
        platform: connectPlatform,
        name: name.trim() || platformLabel(connectPlatform),
        apiKey: apiKey.trim(),
        ...(isReplyIo(connectPlatform) && replyTeamId.trim()
          ? { replyTeamId: replyTeamId.trim() }
          : {}),
      });
      // Post-add setup (campaign sync, contact sync, webhook registration) is
      // handled per-platform by useOutboundIntegrations.addIntegration.onSuccess
      // for ALL platforms — including the full Reply.io chain — so there's no
      // manual function invoke here.
      setApiKey('');
      setName('');
      setReplyTeamId('');
      setConnectPlatform(null);
    } catch {
      // error toast handled by useOutboundIntegrations
    } finally {
      setConnecting(false);
    }
  };

  // Platform-aware sync (was hardcoded to sync-heyreach-campaigns). Routes to
  // the correct sync function per integration.platform via the hook.
  const handleSync = (integrationId: string) => {
    syncIntegration.mutate(integrationId);
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setConnectPlatform('heyreach')}>
            <Plus className="h-4 w-4 mr-2" />
            Connect HeyReach
          </Button>
          <Button onClick={() => setConnectPlatform('reply.io')}>
            <Plus className="h-4 w-4 mr-2" />
            Connect Reply.io
          </Button>
        </div>
      </div>

      {integrations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">
              No integrations connected
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConnectPlatform('heyreach')}>
                <Plus className="h-4 w-4 mr-2" />
                Connect HeyReach
              </Button>
              <Button onClick={() => setConnectPlatform('reply.io')}>
                <Plus className="h-4 w-4 mr-2" />
                Connect Reply.io
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        integrations.map((integration) => {
          const syncing =
            syncIntegration.isPending && syncIntegration.variables === integration.id;
          return (
            <Card key={integration.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base">{integration.name}</CardTitle>
                    <Badge variant="outline">{platformLabel(integration.platform)}</Badge>
                    <Badge variant={integration.is_active ? 'default' : 'secondary'}>
                      {integration.sync_status || 'pending'}
                    </Badge>
                    {isReplyIo(integration.platform) && integration.reply_team_id && (
                      <Badge variant="outline">Team {integration.reply_team_id}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSync(integration.id)}
                      disabled={syncing}
                    >
                      <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
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
                {isHeyReach(integration.platform) ? (
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
                ) : isReplyIo(integration.platform) ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Reply.io webhooks are registered automatically on connect — no manual setup needed.
                    </p>
                    {integration.webhook_status && (
                      <p className="text-xs text-muted-foreground">
                        Webhook status: {integration.webhook_status}
                      </p>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog open={connectPlatform !== null} onOpenChange={(open) => !open && setConnectPlatform(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Connect {connectPlatform ? platformLabel(connectPlatform) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="int-name">Name (optional)</Label>
              <Input
                id="int-name"
                placeholder={`My ${connectPlatform ? platformLabel(connectPlatform) : ''} Account`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="int-key">API Key</Label>
              <Input
                id="int-key"
                type="password"
                placeholder={`Enter your ${connectPlatform ? platformLabel(connectPlatform) : ''} API key`}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              {connectPlatform && isHeyReach(connectPlatform) && (
                <p className="text-xs text-muted-foreground">
                  Find your API key in HeyReach under Settings &gt; API
                </p>
              )}
            </div>
            {connectPlatform && isReplyIo(connectPlatform) && (
              <div className="space-y-2">
                <Label htmlFor="reply-team">Team ID (optional)</Label>
                <Input
                  id="reply-team"
                  placeholder="e.g. 437198"
                  value={replyTeamId}
                  onChange={(e) => setReplyTeamId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Scopes sync to one Reply.io workspace. Leave empty to sync all.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectPlatform(null)}>
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
