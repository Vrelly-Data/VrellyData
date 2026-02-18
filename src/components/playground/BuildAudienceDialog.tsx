import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Sparkles, X, Plus, Users, Lightbulb, Target, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

function TagInput({ label, values, onChange, placeholder }: {
  label: string;
  values: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={addTag}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1">
              {v}
              <button onClick={() => onChange(values.filter(x => x !== v))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
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

export function BuildAudienceDialog({ open, onOpenChange }: BuildAudienceDialogProps) {
  const [step, setStep] = useState<'form' | 'result'>('form');
  const [isGenerating, setIsGenerating] = useState(false);
  const [insights, setInsights] = useState<AudienceInsights | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [totalFound, setTotalFound] = useState(0);

  // Form state
  const [industries, setIndustries] = useState<string[]>([]);
  const [isBtoB, setIsBtoB] = useState(true);
  const [targetTitles, setTargetTitles] = useState<string[]>([]);
  const [companyTypes, setCompanyTypes] = useState<string[]>([]);
  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('build-audience', {
        body: { industries, isBtoB, targetTitles, companyTypes, companySizes, locations },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setInsights(data.insights);
      setProspects(data.prospects || []);
      setTotalFound(data.totalFound || 0);
      setStep('result');
    } catch (err: any) {
      toast.error(`Failed to build audience: ${err.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep('form');
      setInsights(null);
      setProspects([]);
      setTotalFound(0);
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
              : `Found ${totalFound.toLocaleString()} matching prospects. Showing up to 100 below.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' ? (
          <div className="space-y-5 py-2">
            <TagInput
              label="What Industry/Industries do you operate in?"
              values={industries}
              onChange={setIndustries}
              placeholder="e.g. SaaS, Healthcare — press Enter"
            />

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

            <TagInput
              label="Do you know the titles you typically sell to?"
              values={targetTitles}
              onChange={setTargetTitles}
              placeholder="e.g. VP of Marketing, Head of Growth — press Enter"
            />

            <TagInput
              label="What types of companies do you sell to?"
              values={companyTypes}
              onChange={setCompanyTypes}
              placeholder="e.g. Series A startups, Enterprise, SMBs — press Enter"
            />

            <TagInput
              label="Do you know the typical size of company you sell to?"
              values={companySizes}
              onChange={setCompanySizes}
              placeholder="e.g. 51-200, 201-500 — press Enter"
            />

            <TagInput
              label="Do you know where the companies you sell to are located?"
              values={locations}
              onChange={setLocations}
              placeholder="e.g. United States, United Kingdom — press Enter"
            />

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

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep('form')}>
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
