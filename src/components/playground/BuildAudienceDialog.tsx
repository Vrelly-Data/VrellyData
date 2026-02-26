import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Sparkles, Users, Lightbulb, Target, TrendingUp, Save, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TagInput } from '@/components/ui/tag-input';
import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';
import { useFreeDataSuggestions } from '@/hooks/useFreeDataSuggestions';
import { useAudienceAttributes } from '@/hooks/useAudienceAttributes';
import { useAuthStore } from '@/stores/authStore';
import { usePersistRecords } from '@/hooks/usePersistRecords';
import { useCreateList, useAddToList } from '@/hooks/useLists';
import type { PersonEntity } from '@/types/audience';

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

export function BuildAudienceDialog({ open, onOpenChange }: BuildAudienceDialogProps) {
  const [step, setStep] = useState<'form' | 'result'>('form');
  const [isGenerating, setIsGenerating] = useState(false);
  const [insights, setInsights] = useState<AudienceInsights | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [totalFound, setTotalFound] = useState(0);

  // Save flow state
  const [audienceName, setAudienceName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const { suggestions } = useFreeDataSuggestions();
  const { attributes } = useAudienceAttributes();
  const { profile, fetchProfile } = useAuthStore();
  const { saveRecords } = usePersistRecords();
  const createList = useCreateList();
  const addToList = useAddToList();

  // Form state
  const [industries, setIndustries] = useState<string[]>([]);
  const [isBtoB, setIsBtoB] = useState(true);
  const [targetTitles, setTargetTitles] = useState<string[]>([]);
  const [companyTypes, setCompanyTypes] = useState<string[]>([]);
  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);

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
      const { data, error } = await supabase.functions.invoke('build-audience', {
        body: { industries, isBtoB, targetTitles, companyTypes, companySizes, locations },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setInsights(data.insights);
      setProspects(data.prospects || []);
      setTotalFound(data.totalFound || 0);
      setAudienceName(defaultAudienceName);
      setStep('result');
    } catch (err: any) {
      toast.error(`Failed to build audience: ${err.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAudience = async () => {
    if (!audienceName.trim() || prospects.length === 0) return;
    setIsSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Deduct credits
      const { data: deductResult, error: deductError } = await supabase.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: creditCost,
      });

      if (deductError) throw deductError;
      const result = deductResult as unknown as { success: boolean; remaining_credits: number; error?: string };
      if (!result.success) throw new Error(result.error || 'Insufficient credits');

      // Log credit transaction
      await supabase.from('credit_transactions').insert({
        user_id: user.id,
        audience_id: '',
        entity_type: 'person',
        records_returned: creditCost,
        credits_deducted: creditCost,
      });

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

      // Refresh profile for updated credits
      await fetchProfile();

      setIsSaved(true);
      toast.success(`Saved ${prospects.length} contacts to "${audienceName.trim()}"`);
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep('form');
      setInsights(null);
      setProspects([]);
      setTotalFound(0);
      setIsSaved(false);
      setAudienceName('');
    }, 300);
  };

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-500';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            {step === 'form' ? 'Build Audience' : 'Your Audience'}
          </DialogTitle>
          <DialogDescription>
            {step === 'form'
              ? 'Define your ideal customer profile and we\'ll find matching prospects from our database with AI-powered insights.'
              : `Found ${totalFound.toLocaleString()} matching prospects. Showing up to 50 below.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' ? (
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
              <Label>Is this B2B or B2C?</Label>
              <div className="flex gap-3">
                {(['B2B', 'B2C'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setIsBtoB(option === 'B2B')}
                    className={`px-4 py-2 rounded-md border text-sm font-medium transition-colors ${
                      (option === 'B2B') === isBtoB
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-input hover:bg-muted'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
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
                placeholder="e.g. Series A startups, Enterprise, SMBs — press Enter"
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
              <Label>Do you know where the companies you sell to are located?</Label>
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

            {/* Save Audience Section */}
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
                          <span>{prospects.length} contacts × 1 credit = <strong className="text-foreground">{creditCost} credits</strong></span>
                          <span>Balance: <strong className={hasEnough ? 'text-foreground' : 'text-destructive'}>{currentCredits.toLocaleString()}</strong></span>
                        </div>
                        <Button
                          onClick={handleSaveAudience}
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

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => { setStep('form'); setIsSaved(false); }}>
                ← Edit Criteria
              </Button>
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
