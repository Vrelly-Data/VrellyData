import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { toast } from 'sonner';
import { AddIntegrationDialog } from '@/components/playground/AddIntegrationDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ConnectPlatform = 'heyreach' | 'reply.io' | 'phoneburner' | 'smartlead';

const PLATFORM_LABEL: Record<string, string> = {
  heyreach: 'HeyReach',
  'reply.io': 'Reply.io',
  replyio: 'Reply.io',
  smartlead: 'Smartlead',
  phoneburner: 'PhoneBurner / Dialer',
};
const platformLabel = (p: string) => PLATFORM_LABEL[p?.toLowerCase()] ?? p;
const isHeyReach = (p: string) => p?.toLowerCase() === 'heyreach';
const isReplyIo = (p: string) => ['reply.io', 'replyio'].includes(p?.toLowerCase());
const isPhoneBurner = (p: string) => p?.toLowerCase() === 'phoneburner';

export function ExternalProjectsSettings() {
  // Unified "Add Integration" dialog — reuse the Playground dialog with
  // preselected platform for a consistent, first-class experience.
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [initialPlatform, setInitialPlatform] = useState<ConnectPlatform | ''>('');

  const { integrations, deleteIntegration, syncIntegration } =
    useOutboundIntegrations();

  // Render ALL of the team's integrations regardless of platform — RLS already
  // scopes the query to the user's team, so no client-side platform filter.
  // (The old `filter(i => i.platform === 'heyreach')` hid the Reply.io row.)

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Integration
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setInitialPlatform('smartlead');
                setAddDialogOpen(true);
              }}
            >
              🎯 Smartlead
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setInitialPlatform('reply.io');
                setAddDialogOpen(true);
              }}
            >
              📧 Reply.io
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setInitialPlatform('heyreach');
                setAddDialogOpen(true);
              }}
            >
              🤝 HeyReach
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setInitialPlatform('phoneburner');
                setAddDialogOpen(true);
              }}
            >
              📞 PhoneBurner / Dialer
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setInitialPlatform('calendly' as ConnectPlatform);
                setAddDialogOpen(true);
              }}
            >
              📅 Calendly
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {integrations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">
              No integrations connected
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Integration
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem
                  onClick={() => {
                    setInitialPlatform('smartlead');
                    setAddDialogOpen(true);
                  }}
                >
                  🎯 Smartlead
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setInitialPlatform('reply.io');
                    setAddDialogOpen(true);
                  }}
                >
                  📧 Reply.io
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setInitialPlatform('heyreach');
                    setAddDialogOpen(true);
                  }}
                >
                  🤝 HeyReach
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setInitialPlatform('phoneburner');
                    setAddDialogOpen(true);
                  }}
                >
                  📞 PhoneBurner / Dialer
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setInitialPlatform('calendly' as ConnectPlatform);
                    setAddDialogOpen(true);
                  }}
                >
                  📅 Calendly
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                ) : isPhoneBurner(integration.platform) ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Activity syncs via polling — no webhook setup required.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
      <AddIntegrationDialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setInitialPlatform('');
          }
          setAddDialogOpen(open);
        }}
        initialPlatform={initialPlatform || undefined}
      />
    </div>
  );
}
