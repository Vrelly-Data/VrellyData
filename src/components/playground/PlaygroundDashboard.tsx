import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IntegrationSetupCard } from './IntegrationSetupCard';
import { PlaygroundStatsGrid } from './PlaygroundStatsGrid';
import { CampaignsTable } from './CampaignsTable';
import { BuildAudienceDialog } from './BuildAudienceDialog';
import { CreateCopyDialog } from './CreateCopyDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Target, Users, ExternalLink, Trash2, Pencil } from 'lucide-react';
import { useSavedAudiences, useDeleteSavedAudience, type SavedAudience, type AudienceFilters } from '@/hooks/useSavedAudiences';
import { useAudienceStore } from '@/stores/audienceStore';
import { getDefaultFilterBuilderState } from '@/lib/filterConversion';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

function AudienceCard({ audience, onOpen, onEditCriteria }: { audience: SavedAudience; onOpen: () => void; onEditCriteria: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const deleteMutation = useDeleteSavedAudience();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteMutation.mutateAsync({ id: audience.id, presetId: audience.preset_id });
      toast.success('Audience deleted');
    } catch {
      toast.error('Failed to delete audience');
    } finally {
      setDeleting(false);
    }
  };

  const filterSummary = [
    ...audience.filters.industries.slice(0, 1),
    ...audience.filters.targetTitles.slice(0, 1),
    ...audience.filters.locations.slice(0, 1),
  ].filter(Boolean);

  return (
    <div
      className="group relative rounded-lg border border-border bg-card overflow-hidden cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-200"
      onClick={onOpen}
    >
      <div className="h-8 bg-gradient-to-r from-primary/20 to-primary/10 flex items-center px-3 gap-2">
        <Target className="h-3.5 w-3.5 text-primary/70" />
        <Users className="h-3 w-3 text-primary/50" />
      </div>
      <div className="p-3 space-y-1.5">
        <p className="font-semibold text-sm leading-snug line-clamp-2">{audience.name}</p>
        {filterSummary.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {filterSummary.map((f, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                {f}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {audience.result_count != null ? `${audience.result_count.toLocaleString()} results` : 'No results'} · {audience.filters.isBtoB ? 'B2B' : 'B2C'}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(audience.created_at), { addSuffix: true })}
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
          Load
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-xs gap-1"
          onClick={(e) => { e.stopPropagation(); onEditCriteria(); }}
        >
          <Pencil className="h-3 w-3" />
          Edit Criteria
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
  const navigate = useNavigate();
  const { setFilterBuilderState } = useAudienceStore();
  const [buildAudienceOpen, setBuildAudienceOpen] = useState(false);
  const [createCopyOpen, setCreateCopyOpen] = useState(false);
  const [loadedFilters, setLoadedFilters] = useState<AudienceFilters | null>(null);
  const [loadedSavedId, setLoadedSavedId] = useState<string | null>(null);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [loadedInsights, setLoadedInsights] = useState<string | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const { data: savedAudiences } = useSavedAudiences();

  const handleOpenSavedAudience = (audience: SavedAudience) => {
    setLoadedFilters(audience.filters);
    setLoadedSavedId(audience.id);
    setLoadedPresetId(audience.preset_id);
    setLoadedInsights(audience.insights);
    setLoadedName(audience.name);
    setBuildAudienceOpen(true);
  };

  const handleEditCriteria = (audience: SavedAudience) => {
    const state = getDefaultFilterBuilderState();
    state.industries = audience.filters.industries;
    state.jobTitles = audience.filters.targetTitles;
    state.companySize = audience.filters.companySizes;
    state.cities = audience.filters.locations;
    setFilterBuilderState(state);
    navigate('/dashboard');
  };

  const handleOpenNew = () => {
    setLoadedFilters(null);
    setLoadedSavedId(null);
    setLoadedPresetId(null);
    setLoadedInsights(null);
    setLoadedName(null);
    setBuildAudienceOpen(true);
  };

  return (
    <div className="space-y-6">
      <IntegrationSetupCard />

      {/* AI Tools */}
      <div>
        <h3 className="text-lg font-semibold mb-4">AI Tools</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Generate Copy card */}
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
            <CardContent className="pt-0">
              <Button size="sm" onClick={() => setCreateCopyOpen(true)}>
                <Sparkles className="h-4 w-4 mr-2" />
                Create New Copy
              </Button>
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
              <Button size="sm" onClick={handleOpenNew}>
                <Target className="h-4 w-4 mr-2" />
                Build Audience
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Saved Audiences */}
      {savedAudiences && savedAudiences.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-sm font-medium text-muted-foreground">Saved Audiences</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {savedAudiences.map((audience) => (
              <AudienceCard
                key={audience.id}
                audience={audience}
                onOpen={() => handleOpenSavedAudience(audience)}
                onEditCriteria={() => handleEditCriteria(audience)}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold mb-4">Overview</h3>
        <PlaygroundStatsGrid />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-4">Synced Campaigns</h3>
        <CampaignsTable />
      </div>

      <BuildAudienceDialog
        open={buildAudienceOpen}
        onOpenChange={setBuildAudienceOpen}
        initialFilters={loadedFilters}
        savedAudienceId={loadedSavedId}
        savedPresetId={loadedPresetId}
        savedInsights={loadedInsights}
        savedName={loadedName}
      />
      <CreateCopyDialog open={createCopyOpen} onOpenChange={setCreateCopyOpen} />
    </div>
  );
}
