import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Plug, RefreshCw, Trash2, AlertCircle, Loader2, Pencil, Building2 } from 'lucide-react';
import { OutboundIntegration, useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { useState } from 'react';
import { AddIntegrationDialog } from './AddIntegrationDialog';
import { EditIntegrationDialog } from './EditIntegrationDialog';
import { formatDistanceToNow } from 'date-fns';

const platformIcons: Record<string, string> = {
  'reply.io': '📧',
  'smartlead': '🎯',
  'instantly': '⚡',
  'lemlist': '🍋',
};

function getStatusBadge(status: string | null, error: string | null) {
  if (error) {
    return <Badge variant="destructive" className="text-xs">Error</Badge>;
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
  isSyncing: boolean;
}

function IntegrationRow({ integration, onToggle, onDelete, onSync, onEdit, isSyncing }: IntegrationRowProps) {
  const icon = platformIcons[integration.platform.toLowerCase()] || '🔌';
  const isCurrentlySyncing = isSyncing || integration.sync_status === 'syncing';
  // Access reply_team_id from extended integration type
  const replyTeamId = (integration as OutboundIntegration & { reply_team_id?: string }).reply_team_id;

  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{integration.name}</span>
            {getStatusBadge(integration.sync_status, integration.sync_error)}
            {replyTeamId && (
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                Team: {replyTeamId}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground capitalize">
            {integration.platform}
            {integration.last_synced_at && (
              <> · Last synced {formatDistanceToNow(new Date(integration.last_synced_at), { addSuffix: true })}</>
            )}
          </p>
          {integration.sync_error && (
            <p className="text-xs text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="h-3 w-3" />
              {integration.sync_error}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
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
  const [editingIntegration, setEditingIntegration] = useState<OutboundIntegration | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const { integrations, isLoading, toggleIntegration, deleteIntegration, syncIntegration } = useOutboundIntegrations();

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

  const handleEdit = (integration: OutboundIntegration) => {
    setEditingIntegration(integration);
    setEditDialogOpen(true);
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
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Connect Platform
          </Button>
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
                  isSyncing={syncingId === integration.id}
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
    </>
  );
}
