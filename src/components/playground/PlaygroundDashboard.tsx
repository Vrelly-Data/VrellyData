import { useState } from 'react';
import { IntegrationSetupCard } from './IntegrationSetupCard';
import { PlaygroundStatsGrid } from './PlaygroundStatsGrid';
import { CampaignsTable } from './CampaignsTable';
import { BuildAudienceDialog } from './BuildAudienceDialog';
import { CreateCopyDialog } from './CreateCopyDialog';
import { ViewCopyDialog } from './ViewCopyDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, Target, FileText, Trash2, ExternalLink } from 'lucide-react';
import { useAICopyGroups, useDeleteCopyGroup, type CopyGroup } from '@/hooks/useCopyTemplates';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

function DocCard({ group, onOpen, onDelete }: { group: CopyGroup; onOpen: () => void; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const deleteMutation = useDeleteCopyGroup();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteMutation.mutateAsync(group.groupId);
      toast.success('Copy deleted');
    } catch {
      toast.error('Failed to delete copy');
    } finally {
      setDeleting(false);
    }
  };

  const channelLabel = group.channels.length > 0
    ? group.channels.slice(0, 2).join(', ') + (group.channels.length > 2 ? ` +${group.channels.length - 2}` : '')
    : 'Email';

  return (
    <div
      className="group relative rounded-lg border border-border bg-card overflow-hidden cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-200"
      onClick={onOpen}
    >
      {/* Coloured top strip — Google Doc style */}
      <div className="h-8 bg-gradient-to-r from-primary/20 to-primary/10 flex items-center px-3 gap-2">
        <FileText className="h-3.5 w-3.5 text-primary/70" />
        <Sparkles className="h-3 w-3 text-primary/50" />
      </div>

      <div className="p-3 space-y-1.5">
        <p className="font-semibold text-sm leading-snug line-clamp-2">{group.name}</p>
        <p className="text-xs text-muted-foreground">
          {group.stepCount} step{group.stepCount !== 1 ? 's' : ''} · {channelLabel}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(group.createdAt), { addSuffix: true })}
        </p>
      </div>

      <div className="px-3 pb-3 flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-xs gap-1"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function PlaygroundDashboard() {
  const [buildAudienceOpen, setBuildAudienceOpen] = useState(false);
  const [createCopyOpen, setCreateCopyOpen] = useState(false);
  const [viewGroup, setViewGroup] = useState<CopyGroup | null>(null);

  const { data: copyGroups = [] } = useAICopyGroups();

  return (
    <div className="space-y-6">
      <IntegrationSetupCard />

      {/* AI Tools */}
      <div>
        <h3 className="text-lg font-semibold mb-4">AI Tools</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Generate Copy card — expanded with saved copies shelf */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Generate Copy
              </CardTitle>
              <CardDescription>
                AI-powered email copy generation trained on your best-performing sequences and sales knowledge base.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <Button size="sm" onClick={() => setCreateCopyOpen(true)}>
                <Sparkles className="h-4 w-4 mr-2" />
                Create New Copy
              </Button>

              {/* Saved copies — Google Drive-style grid */}
              {copyGroups.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground font-medium">Saved Copies</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {copyGroups.map((group) => (
                      <DocCard
                        key={group.groupId}
                        group={group}
                        onOpen={() => setViewGroup(group)}
                        onDelete={() => {}}
                      />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Build Audience
              </CardTitle>
              <CardDescription>
                Define your ideal customer profile and instantly find matching prospects from our database with AI insights.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button size="sm" onClick={() => setBuildAudienceOpen(true)}>
                <Target className="h-4 w-4 mr-2" />
                Build Audience
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Overview</h3>
        <PlaygroundStatsGrid />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-4">Synced Campaigns</h3>
        <CampaignsTable />
      </div>

      <BuildAudienceDialog open={buildAudienceOpen} onOpenChange={setBuildAudienceOpen} />
      <CreateCopyDialog open={createCopyOpen} onOpenChange={setCreateCopyOpen} />
      <ViewCopyDialog group={viewGroup} open={!!viewGroup} onOpenChange={(o) => { if (!o) setViewGroup(null); }} />
    </div>
  );
}
