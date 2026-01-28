import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Plug, RefreshCw, Trash2, AlertCircle, Loader2, Pencil, Building2, Zap, Upload, Settings2 } from 'lucide-react';
import { OutboundIntegration, useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { useState } from 'react';
import { AddIntegrationDialog } from './AddIntegrationDialog';
import { EditIntegrationDialog } from './EditIntegrationDialog';
import { LinkedInStatsUploadDialog } from './LinkedInStatsUploadDialog';
import { ManageCampaignsDialog } from './ManageCampaignsDialog';
import { formatDistanceToNow } from 'date-fns';

const platformIcons: Record<string, string> = {
  'reply.io': '📧',
  'smartlead': '🎯',
  'instantly': '⚡',
  'lemlist': '🍋',
};

function getStatusBadge(status: string | null, error: string | null, isStuck?: boolean) {
  if (error) {
    return <Badge variant="destructive" className="text-xs">Error</Badge>;
  }
  if (isStuck) {
    return <Badge variant="destructive" className="text-xs">Stuck</Badge>;
  }
  switch (status) {
    case 'synced':
      return <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">Synced</Badge>;
    case 'syncing':
      return <Badge variant="secondary" className="text-xs bg-accent text-accent-foreground">Syncing...</Badge>;
    case 'pending':
      return <Badge variant="outline" className="text-xs">Pending</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">Unknown</Badge>;
  }
}

interface IntegrationRowProps {
  integration: OutboundIntegration;
  onToggle: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
  onSync: (id: string) => void;
  onEdit: (integration: OutboundIntegration) => void;
  onSetupWebhook: (id: string) => void;
  onResetSync: (id: string) => void;
  onManageCampaigns: (integration: OutboundIntegration) => void;
  isSyncing: boolean;
  isSettingUpWebhook: boolean;
}

function IntegrationRow({ integration, onToggle, onDelete, onSync, onEdit, onSetupWebhook, onResetSync, onManageCampaigns, isSyncing, isSettingUpWebhook }: IntegrationRowProps) {
  const icon = platformIcons[integration.platform.toLowerCase()] || '🔌';
  const isCurrentlySyncing = isSyncing || integration.sync_status === 'syncing';
  // Access reply_team_id from extended integration type
  const replyTeamId = (integration as OutboundIntegration & { reply_team_id?: string }).reply_team_id;
  const webhookStatus = integration.webhook_status;
  const isReplyIo = integration.platform.toLowerCase() === 'reply.io';
  
  // Check if sync is stuck (syncing for more than 5 minutes)
  const isStuck = integration.sync_status === 'syncing' && integration.updated_at && 
    (new Date().getTime() - new Date(integration.updated_at).getTime()) > 5 * 60 * 1000;

  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{integration.name}</span>
            {getStatusBadge(integration.sync_status, integration.sync_error, isStuck)}
            {replyTeamId && (
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                Team: {replyTeamId}
              </Badge>
            )}
            {isReplyIo && webhookStatus === 'active' && (
              <Badge variant="outline" className="text-xs flex items-center gap-1 text-green-600 border-green-600">
                <Zap className="h-3 w-3" />
                Live
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground capitalize">
            {integration.platform}
            {integration.last_synced_at && (
              <> · Last synced {formatDistanceToNow(new Date(integration.last_synced_at), { addSuffix: true })}</>
            )}
          </p>
          {/* Workspace info for Reply.io */}
          {isReplyIo && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {replyTeamId 
                ? `Workspace: ${replyTeamId}` 
                : 'Single workspace'
              }
            </p>
          )}
          {integration.sync_error && (
            <p className="text-xs text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="h-3 w-3" />
              {integration.sync_error}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {isReplyIo && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onManageCampaigns(integration)}
            disabled={!integration.is_active}
            className="h-8"
          >
            <Settings2 className="h-4 w-4" />
            <span className="ml-1.5">Manage Campaigns</span>
          </Button>
        )}
        {isReplyIo && webhookStatus !== 'active' && (
          <div className="flex items-center gap-2">
            {webhookStatus === 'error' && !replyTeamId && (
              <span className="text-xs text-amber-600 dark:text-amber-400">Set Team ID first →</span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSetupWebhook(integration.id)}
              disabled={isSettingUpWebhook || !integration.is_active}
              className="h-8"
            >
              {isSettingUpWebhook ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              <span className="ml-1.5">{isSettingUpWebhook ? 'Setting up...' : 'Enable Live'}</span>
            </Button>
          </div>
        )}
        {isStuck ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onResetSync(integration.id)}
            className="h-8"
          >
            <AlertCircle className="h-4 w-4" />
            <span className="ml-1.5">Reset Stuck</span>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSync(integration.id)}
            disabled={isCurrentlySyncing || !integration.is_active}
            className="h-8"
          >
            {isCurrentlySyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1.5">{isCurrentlySyncing ? 'Syncing...' : 'Sync'}</span>
          </Button>
        )}
        <Switch
          checked={integration.is_active}
          onCheckedChange={(checked) => onToggle(integration.id, checked)}
        />
        {integration.platform.toLowerCase() === 'reply.io' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-primary"
            onClick={() => onEdit(integration)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(integration.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function IntegrationSetupCard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [linkedInUploadOpen, setLinkedInUploadOpen] = useState(false);
  const [manageCampaignsOpen, setManageCampaignsOpen] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<OutboundIntegration | null>(null);
  const [managingIntegration, setManagingIntegration] = useState<OutboundIntegration | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [webhookSetupId, setWebhookSetupId] = useState<string | null>(null);
  const { integrations, isLoading, toggleIntegration, deleteIntegration, syncIntegration, setupWebhook, resetSyncStatus } = useOutboundIntegrations();

  const handleToggle = (id: string, isActive: boolean) => {
    toggleIntegration.mutate({ id, isActive });
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to remove this integration?')) {
      deleteIntegration.mutate(id);
    }
  };

  const handleSync = (id: string) => {
    setSyncingId(id);
    syncIntegration.mutate(id, {
      onSettled: () => setSyncingId(null),
    });
  };

  const handleSetupWebhook = (id: string) => {
    setWebhookSetupId(id);
    setupWebhook.mutate(id, {
      onSettled: () => setWebhookSetupId(null),
    });
  };

  const handleEdit = (integration: OutboundIntegration) => {
    setEditingIntegration(integration);
    setEditDialogOpen(true);
  };

  const handleResetSync = (id: string) => {
    resetSyncStatus.mutate(id);
  };

  const handleManageCampaigns = (integration: OutboundIntegration) => {
    setManagingIntegration(integration);
    setManageCampaignsOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Connected Platforms
            </CardTitle>
            <CardDescription>
              Connect your outbound tools to sync campaign data
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setLinkedInUploadOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload LinkedIn Stats
            </Button>
            <Button onClick={() => setDialogOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Connect Platform
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Loading integrations...
            </div>
          ) : integrations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Plug className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No platforms connected</p>
              <p className="text-sm mt-1">Connect Reply.io, Smartlead, or Instantly to get started</p>
            </div>
          ) : (
          <div className="divide-y">
              {integrations.map((integration) => (
                <IntegrationRow
                  key={integration.id}
                  integration={integration}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onSync={handleSync}
                  onEdit={handleEdit}
                  onSetupWebhook={handleSetupWebhook}
                  onResetSync={handleResetSync}
                  onManageCampaigns={handleManageCampaigns}
                  isSyncing={syncingId === integration.id}
                  isSettingUpWebhook={webhookSetupId === integration.id}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddIntegrationDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <EditIntegrationDialog 
        open={editDialogOpen} 
        onOpenChange={setEditDialogOpen} 
        integration={editingIntegration}
      />
      <LinkedInStatsUploadDialog 
        open={linkedInUploadOpen} 
        onOpenChange={setLinkedInUploadOpen}
      />
      <ManageCampaignsDialog
        open={manageCampaignsOpen}
        onOpenChange={setManageCampaignsOpen}
        integrationId={managingIntegration?.id ?? null}
        onAddWorkspace={() => setDialogOpen(true)}
      />
    </>
  );
}
