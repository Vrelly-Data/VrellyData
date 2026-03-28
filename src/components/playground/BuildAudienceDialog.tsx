import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Loader2, Sparkles, Users, Lightbulb, Target, TrendingUp, Save, CheckCircle2, Bookmark, ExternalLink, Pencil, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCredit } from '@/lib/credits';
import { TagInput } from '@/components/ui/tag-input';
import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';
import { useFreeDataSuggestions } from '@/hooks/useFreeDataSuggestions';
import { useAudienceAttributes } from '@/hooks/useAudienceAttributes';
import { useAuthStore } from '@/stores/authStore';
import { usePersistRecords } from '@/hooks/usePersistRecords';
import { useCreateList, useAddToList } from '@/hooks/useLists';
import { useSaveAudience, type AudienceFilters } from '@/hooks/useSavedAudiences';
import { useAudienceStore } from '@/stores/audienceStore';
import { getDefaultFilterBuilderState } from '@/lib/filterConversion';
import type { PersonEntity } from '@/types/audience';

export type { AudienceFilters };

interface AudienceInsights {
  icp_summary: string;
  key_insights: string[];
  recommended_approach: string;
  audience_score: number;
}

interface Prospect {
  entity_external_id: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  email: string | null;
  linkedin: string | null;
}

interface BuildAudienceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters?: AudienceFilters | null;
  savedAudienceId?: string | null;
  savedPresetId?: string | null;
  savedInsights?: string | null;
  savedName?: string | null;
}

function BlurredText({ text, blur = true }: { text: string | null; blur?: boolean }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  if (!blur) return <span>{text}</span>;
  return (
    <span
      className="select-none blur-sm text-foreground cursor-not-allowed"
      title="Unlock to reveal"
    >
      {text}
    </span>
  );
}

const dedup = (arr: string[]) => [...new Set(arr.filter(Boolean))];

/** Serialize AudienceInsights to a single text string for storage */
function insightsToText(insights: AudienceInsights): string {
  const parts: string[] = [];
  if (insights.icp_summary) parts.push(insights.icp_summary);
  if (insights.key_insights?.length > 0) {
    parts.push(insights.key_insights.map(i => `- ${i}`).join('\n'));
  }
  if (insights.recommended_approach) parts.push(insights.recommended_approach);
  if (insights.audience_score) parts.push(`Audience Score: ${insights.audience_score}/100`);
  return parts.join('\n\n');
}

export function BuildAudienceDialog({
  open,
  onOpenChange,
  initialFilters,
  savedAudienceId,
  savedPresetId,
  savedInsights,
  savedName,
}: BuildAudienceDialogProps) {
  const navigate = useNavigate();
  // 'saved' = viewing a saved audience, 'form' = editing criteria, 'result' = after AI search
  const [step, setStep] = useState<'saved' | 'form' | 'result'>('form');
  const [isGenerating, setIsGenerating] = useState(false);
  const [insights, setInsights] = useState<AudienceInsights | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [totalFound, setTotalFound] = useState(0);

  // Save flow state
  const [audienceName, setAudienceName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSearchSaved, setIsSearchSaved] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  // Track IDs for upsert across re-saves within the same session
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);
  const [currentPresetId, setCurrentPresetId] = useState<string | null>(null);

  const { suggestions } = useFreeDataSuggestions();
  const { attributes } = useAudienceAttributes();
  const { profile, fetchProfile } = useAuthStore();
  const { saveRecords } = usePersistRecords();
  const createList = useCreateList();
  const addToList = useAddToList();
  const saveAudienceMutation = useSaveAudience();
  const { setFilterBuilderState } = useAudienceStore();

  // Form state
  const [industries, setIndustries] = useState<string[]>([]);
  const [targetTitles, setTargetTitles] = useState<string[]>([]);
  const [companyTypes, setCompanyTypes] = useState<string[]>([]);
  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);

  // Pre-populate filters and IDs when opening with a saved audience
  useEffect(() => {
    if (open && initialFilters) {
      setIndustries(initialFilters.industries);
      setTargetTitles(initialFilters.targetTitles);
      setCompanyTypes(initialFilters.companyTypes);
      setCompanySizes(initialFilters.companySizes);
      setLocations(initialFilters.locations);
      setCurrentSavedId(savedAudienceId ?? null);
      setCurrentPresetId(savedPresetId ?? null);
      setAudienceName(savedName ?? '');
      // If loading a saved audience, show the saved detail view
      if (savedAudienceId) {
        setStep('saved');
      }
    }
  }, [open, initialFilters, savedAudienceId, savedPresetId, savedInsights, savedName]);

  // Merged suggestions
  const industrySuggestions = dedup([...attributes.industries, ...suggestions.industries]);
  const jobTitleSuggestions = attributes.jobTitles || [];
  const locationSuggestions = attributes.cities || [];

  const creditCost = prospects.length;
  const currentCredits = profile?.credits ?? 0;
  const hasEnough = currentCredits >= creditCost;

  const defaultAudienceName = useMemo(() => {
    const parts: string[] = [];
    if (industries.length > 0) parts.push(industries[0]);
    if (targetTitles.length > 0) parts.push(targetTitles[0]);
    const date = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `Audience - ${parts.join(' / ') || 'Custom'} - ${date}`;
  }, [industries, targetTitles]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setIsSaved(false);
    try {
      // Deduct 1 AI generation credit for audience building
      await useCredit('ai_generation', 1);

      const { data, error } = await supabase.functions.invoke('build-audience', {
        body: { industries, targetTitles, keywords: companyTypes, companySizes, locations },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setInsights(data.insights);
      setProspects(data.prospects || []);
      setTotalFound(data.totalFound || 0);
      if (!audienceName) setAudienceName(defaultAudienceName);
      setStep('result');
    } catch (err: any) {
      if (err.message === 'UPGRADE_REQUIRED') {
        toast.error('You need an active subscription to build audiences.');
        return;
      }
      if (err.message === 'OUT_OF_CREDITS') {
        toast.error('You have run out of AI generation credits for this period.');
        return;
      }
      toast.error(`Failed to build audience: ${err.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAudienceClick = () => {
    if (!audienceName.trim() || prospects.length === 0) return;
    setShowSaveConfirm(true);
  };

  const handleSaveAudienceConfirm = async () => {
    setShowSaveConfirm(false);
    setIsSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Deduct export credits via check-and-use-credits
      await useCredit('export', creditCost);

      // 2. Save records to people_records
      const entities: PersonEntity[] = prospects.map(p => ({
        id: p.entity_external_id,
        firstName: p.name.split(' ')[0] || '',
        lastName: p.name.split(' ').slice(1).join(' ') || '',
        title: p.title,
        company: p.company,
        industry: p.industry,
        email: p.email || undefined,
        linkedin: p.linkedin || undefined,
      })) as any;

      await saveRecords(entities, 'person', 'export');

      // 3. Create list and add items
      const newList = await createList.mutateAsync({
        name: audienceName.trim(),
        description: `Built from Data Playground audience builder`,
        entityType: 'person',
      });

      await addToList.mutateAsync({
        listId: newList.id,
        records: prospects.map(p => ({
          id: p.entity_external_id,
          data: {
            name: p.name,
            title: p.title,
            company: p.company,
            industry: p.industry,
            location: p.location,
            email: p.email,
            linkedin: p.linkedin,
          },
        })),
      });

      // 4. Also save filters to Builder Saved Searches (filter_presets)
      const currentFilters: AudienceFilters = { industries, isBtoB: true, targetTitles, companyTypes, companySizes, locations };
      const insightsText = insights ? insightsToText(insights) : null;
      try {
        const result = await saveAudienceMutation.mutateAsync({
          name: audienceName.trim(),
          filters: currentFilters,
          result_count: totalFound,
          insights: insightsText,
          existingId: currentSavedId,
          existingPresetId: currentPresetId,
        });
        setCurrentSavedId(result.id);
        setCurrentPresetId(result.presetId ?? null);
      } catch {
        // Non-critical: people list was saved successfully even if preset save fails
      }

      // Refresh profile for updated credits
      await fetchProfile();

      setIsSaved(true);
      toast.success(`Saved ${prospects.length} contacts to "${audienceName.trim()}"`);
    } catch (err: any) {
      if (err.message === 'UPGRADE_REQUIRED') {
        toast.error('You need an active subscription to save audiences.');
      } else if (err.message === 'OUT_OF_CREDITS') {
        toast.error('You have run out of export credits for this period.');
      } else {
        toast.error(`Failed to save: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSearch = async () => {
    if (!audienceName.trim()) return;
    try {
      const insightsText = insights ? insightsToText(insights) : null;
      const result = await saveAudienceMutation.mutateAsync({
        name: audienceName.trim(),
        filters: { industries, isBtoB: true, targetTitles, companyTypes, companySizes, locations },
        result_count: totalFound,
        insights: insightsText,
        existingId: currentSavedId,
        existingPresetId: currentPresetId,
      });
      setCurrentSavedId(result.id);
      setCurrentPresetId(result.presetId ?? null);
      setIsSearchSaved(true);
      toast.success(`Search "${audienceName.trim()}" saved`);
    } catch (err: any) {
      toast.error(`Failed to save search: ${err.message || 'Unknown error'}`);
    }
  };

  const handleEditInBuilder = () => {
    const knownCountries = new Set([
      'United States', 'United Kingdom', 'Canada', 'Australia',
      'Germany', 'France', 'India', 'Singapore', 'Netherlands',
    ]);
    const state = getDefaultFilterBuilderState();
    state.industries = industries;
    state.jobTitles = targetTitles;
    state.companySize = companySizes;
    state.personCity = locations.filter(l => !knownCountries.has(l));
    state.personCountry = locations.filter(l => knownCountries.has(l));
    // companyTypes (e.g. "Series A startups", "Enterprise") don't have a direct
    // FilterBuilderState equivalent — they remain visible in the ICP summary only.
    setFilterBuilderState(state);
    handleClose();
    navigate('/dashboard');
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep('form');
      setInsights(null);
      setProspects([]);
      setTotalFound(0);
      setIsSaved(false);
      setIsSearchSaved(false);
      setShowSaveConfirm(false);
      setAudienceName('');
      setCurrentSavedId(null);
      setCurrentPresetId(null);
    }, 300);
  };

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-500';

  // Build filter summary pills for the saved view
  const filterPills = [
    ...industries.slice(0, 2),
    ...targetTitles.slice(0, 2),
    ...locations.slice(0, 2),
    ...companySizes.slice(0, 1),
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            {step === 'saved' ? audienceName || 'Saved Audience' : step === 'form' ? 'Build Audience' : 'Your Audience'}
          </DialogTitle>
          <DialogDescription>
            {step === 'saved'
              ? 'View your saved audience details, edit criteria, or open in the full Audience Builder.'
              : step === 'form'
              ? 'Define your ideal customer profile and we\'ll find matching prospects from our database with AI-powered insights.'
              : `Found ${prospects.length === 50 ? '50+' : prospects.length.toLocaleString()} matching prospects.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'saved' ? (
          /* -------- Saved audience detail view -------- */
          <div className="space-y-4 py-2">
            {/* Filter summary */}
            <div className="flex flex-wrap gap-1.5">
              {filterPills.map((pill, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {pill}
                </Badge>
              ))}
            </div>

            {/* Saved insights */}
            {savedInsights && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    AI Insights
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-0 pb-3">
                  <p className="text-sm whitespace-pre-line">{savedInsights}</p>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button onClick={() => setStep('form')} className="flex-1">
                <Pencil className="h-4 w-4 mr-2" />
                Edit Criteria
              </Button>
              <Button variant="outline" onClick={handleEditInBuilder} className="flex-1">
                <ExternalLink className="h-4 w-4 mr-2" />
                Build in Audience Builder
              </Button>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={handleClose}>Close</Button>
            </div>
          </div>
        ) : step === 'form' ? (
          /* -------- Form / questionnaire step -------- */
          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label>What Industry/Industries do you operate in?</Label>
              <TagInput
                value={industries}
                onChange={setIndustries}
                placeholder="Type to search industries..."
                suggestions={industrySuggestions}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Do you know the titles you typically sell to?</Label>
              <TagInput
                value={targetTitles}
                onChange={setTargetTitles}
                placeholder="Type to search job titles..."
                suggestions={jobTitleSuggestions}
              />
            </div>

            <div className="space-y-1.5">
              <Label>What types of companies do you sell to?</Label>
              <TagInput
                value={companyTypes}
                onChange={setCompanyTypes}
                placeholder="e.g. biotech, sales SaaS, eCommerce — press Enter"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Do you know the typical size of company you sell to?</Label>
              <MultiSelectDropdown
                options={attributes.companySizeRanges || []}
                selected={companySizes}
                onChange={setCompanySizes}
                placeholder="Select company size ranges..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Where are your target prospects located? (city or country)</Label>
              <TagInput
                value={locations}
                onChange={setLocations}
                placeholder="Type to search locations..."
                suggestions={locationSuggestions}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Building Audience...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />Build Audience</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* -------- Result step (after AI search) -------- */
          <div className="space-y-4 py-2">
            {/* AI Insights */}
            {insights && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="md:col-span-2 border-primary/20 bg-primary/5">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-primary" />
                      ICP Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-0 pb-3 space-y-3">
                    <p className="text-sm">{insights.icp_summary}</p>
                    {insights.key_insights?.length > 0 && (
                      <ul className="space-y-1">
                        {insights.key_insights.map((ins, i) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-primary mt-0.5">•</span>
                            {ins}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Audience Score
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-0 pb-3 text-center">
                    <p className={`text-4xl font-bold ${scoreColor(insights.audience_score || 0)}`}>
                      {insights.audience_score || '—'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">out of 100</p>
                    <p className="text-xs mt-3 text-muted-foreground">{insights.recommended_approach}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Prospects List */}
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Matching Prospects
                    <Badge variant="secondary">{prospects.length} shown</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Email & LinkedIn blurred — unlock in the Audience Builder
                  </p>
                </div>
              </CardHeader>
              <CardContent className="py-0 pb-4">
                {prospects.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No matching prospects found for these criteria. Try broadening your filters.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Name</th>
                          <th className="pb-2 pr-4 font-medium">Title</th>
                          <th className="pb-2 pr-4 font-medium">Company</th>
                          <th className="pb-2 pr-4 font-medium">Industry</th>
                          <th className="pb-2 pr-4 font-medium">Location</th>
                          <th className="pb-2 pr-4 font-medium">Email</th>
                          <th className="pb-2 font-medium">LinkedIn</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prospects.map((p) => (
                          <tr key={p.entity_external_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-2 pr-4 font-medium">{p.name}</td>
                            <td className="py-2 pr-4 text-muted-foreground max-w-[140px] truncate">{p.title}</td>
                            <td className="py-2 pr-4 max-w-[140px] truncate">{p.company}</td>
                            <td className="py-2 pr-4 text-muted-foreground max-w-[120px] truncate">{p.industry}</td>
                            <td className="py-2 pr-4 text-muted-foreground max-w-[120px] truncate">{p.location}</td>
                            <td className="py-2 pr-4">
                              <BlurredText text={p.email} />
                            </td>
                            <td className="py-2">
                              <BlurredText text={p.linkedin} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Save Section */}
            {prospects.length > 0 && (
              <Card className={isSaved ? 'border-green-500/30 bg-green-500/5' : ''}>
                <CardContent className="py-4">
                  {isSaved ? (
                    <div className="flex items-center gap-3 justify-center text-green-600">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium">Saved! {prospects.length} contacts added to your People records and list.</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Audience Name</Label>
                        <Input
                          value={audienceName}
                          onChange={(e) => setAudienceName(e.target.value)}
                          placeholder="Name your audience..."
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground space-x-4">
                          <span>{prospects.length} contacts x 1 credit = <strong className="text-foreground">{creditCost} credits</strong></span>
                          <span>Balance: <strong className={hasEnough ? 'text-foreground' : 'text-destructive'}>{currentCredits.toLocaleString()}</strong></span>
                        </div>
                        <Button
                          onClick={handleSaveAudienceClick}
                          disabled={isSaving || !hasEnough || !audienceName.trim()}
                        >
                          {isSaving ? (
                            <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</>
                          ) : (
                            <><Save className="h-4 w-4 mr-2" />Save Audience</>
                          )}
                        </Button>
                      </div>
                      {!hasEnough && (
                        <p className="text-xs text-destructive">Not enough credits. You need {creditCost} but have {currentCredits}.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="flex justify-between items-center pt-2">
              <Button variant="outline" onClick={() => { setStep('form'); setIsSaved(false); setIsSearchSaved(false); }}>
                ← Edit Criteria
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleSaveSearch}
                  disabled={saveAudienceMutation.isPending || isSearchSaved || !audienceName.trim()}
                >
                  {saveAudienceMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</>
                  ) : isSearchSaved ? (
                    <><CheckCircle2 className="h-4 w-4 mr-2" />Search Saved</>
                  ) : (
                    <><Bookmark className="h-4 w-4 mr-2" />Save Search</>
                  )}
                </Button>
                <Button variant="outline" onClick={handleEditInBuilder}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Edit in Builder
                </Button>
                <Button onClick={handleClose}>Done</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      {/* Credit confirmation dialog */}
      <AlertDialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Confirm Save Audience
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>You are about to save this audience to your People list.</p>
                <div className="rounded-md border p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">People to save</span>
                    <span className="font-medium text-foreground">{prospects.length.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Credits to deduct</span>
                    <span className="font-medium text-foreground">{creditCost.toLocaleString()} credits</span>
                  </div>
                  <div className="border-t pt-1.5 flex justify-between">
                    <span className="text-muted-foreground">Remaining balance</span>
                    <span className={`font-medium ${hasEnough ? 'text-foreground' : 'text-destructive'}`}>
                      {(currentCredits - creditCost).toLocaleString()} credits
                    </span>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveAudienceConfirm}>
              <Save className="h-4 w-4 mr-2" />
              Confirm & Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
