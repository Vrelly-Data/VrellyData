import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Sparkles, Copy, X, Plus, Lightbulb, Mail, CheckCircle2, BookOpen, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSaveCopyMutation } from '@/hooks/useCopyTemplates';
import { useCredit } from '@/lib/credits';
import { format } from 'date-fns';

interface CopyStep {
  step: number;
  day: number;
  subject?: string | null;
  body: string;
  channel?: string;
}

interface GeneratedCopy {
  positioning_statement: string;
  key_insight: string;
  why_this_works?: string[];
  source_insights?: { title: string; category: string }[];
  steps: CopyStep[];
}

interface CreateCopyDialogProps {
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

const CHANNELS = ['Email', 'LinkedIn', 'Twitter message', 'Instagram message', 'Facebook message'];

function categoryLabel(cat: string) {
  switch (cat) {
    case 'sales_guideline': return 'Guideline';
    case 'audience_insight': return 'Insight';
    case 'campaign_result': return 'Campaign';
    case 'email_template': return 'Template';
    case 'sequence_playbook': return 'Playbook';
    default: return cat;
  }
}

export function CreateCopyDialog({ open, onOpenChange }: CreateCopyDialogProps) {
  const [step, setStep] = useState<'form' | 'result'>('form');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedCopy | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [savedGroupId, setSavedGroupId] = useState<string | null>(null);

  const saveMutation = useSaveCopyMutation();

  // Form state
  const [product, setProduct] = useState('');
  const [industries, setIndustries] = useState<string[]>([]);
  const [isBtoB, setIsBtoB] = useState(true);
  const [channels, setChannels] = useState<string[]>([]);
  const [targetTitles, setTargetTitles] = useState<string[]>([]);
  const [companyTypes, setCompanyTypes] = useState<string[]>([]);
  const [companyStandout, setCompanyStandout] = useState('');

  const toggleChannel = (ch: string) => {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  };

  const buildDefaultName = () => {
    const snippet = product.trim().split(' ').slice(0, 4).join(' ');
    return `AI Copy — ${snippet} — ${format(new Date(), 'MMM yyyy')}`;
  };

  const handleGenerate = async () => {
    if (!product.trim()) {
      toast.error('Please describe your product or service');
      return;
    }

    setIsGenerating(true);
    try {
      // Deduct 1 AI generation credit
      await useCredit('ai_generation', 1);

      const { data, error } = await supabase.functions.invoke('generate-copy', {
        body: { product, industries, isBtoB, targetTitles, companyTypes, companyStandout, channels },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data as GeneratedCopy);
      setTemplateName(buildDefaultName());
      setSavedGroupId(null);
      setStep('result');
    } catch (err: any) {
      if (err.message === 'UPGRADE_REQUIRED') {
        toast.error('You need an active subscription to generate copy. Please upgrade your plan.');
        return;
      }
      if (err.message === 'OUT_OF_CREDITS') {
        toast.error('You have run out of AI generation credits for this period.');
        return;
      }
      toast.error(`Failed to generate copy: ${err.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      toast.error('Please enter a name for this copy');
      return;
    }
    if (!result?.steps?.length) return;

    try {
      const groupId = await saveMutation.mutateAsync({
        templateName: templateName.trim(),
        steps: result.steps,
      });
      setSavedGroupId(groupId);
      toast.success('Copy saved to your library');
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message || 'Unknown error'}`);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep('form');
      setResult(null);
      setSavedGroupId(null);
      setTemplateName('');
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {step === 'form' ? 'Create New Copy' : 'Your Generated Copy'}
          </DialogTitle>
          <DialogDescription>
            {step === 'form'
              ? "Tell us about your business and we'll generate a tailored outreach sequence using your top-performing campaign data."
              : 'AI-generated copy based on your best-performing campaigns. Save it to your library or copy individual sections.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' ? (
          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="product">What service/product do you provide? <span className="text-destructive">*</span></Label>
              <Textarea
                id="product"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                placeholder="e.g. A B2B SaaS platform that helps marketing teams automate lead scoring..."
                rows={3}
              />
            </div>

            <TagInput
              label="What Industry/Industries do you operate in?"
              values={industries}
              onChange={setIndustries}
              placeholder="e.g. SaaS, Healthcare, Finance — press Enter"
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

            <div className="space-y-1.5">
              <Label>Which channels do you use for outreach?</Label>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => toggleChannel(ch)}
                    className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                      channels.includes(ch)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-input hover:bg-muted'
                    }`}
                  >
                    {ch}
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

            <div className="space-y-1.5">
              <Label htmlFor="standout">Anything about your company that stands out?</Label>
              <Textarea
                id="standout"
                value={companyStandout}
                onChange={(e) => setCompanyStandout(e.target.value)}
                placeholder="e.g. We're the only tool that integrates natively with Salesforce without a developer..."
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={isGenerating || !product.trim()}>
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />Generate Copy</>
                )}
              </Button>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-4 py-2">
            {/* Enhanced Insights Card */}
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="py-3 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  Why This Copy Works
                </CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-4 space-y-3">
                {result.positioning_statement && (
                  <p className="text-sm">
                    <span className="font-medium">Positioning:</span> {result.positioning_statement}
                  </p>
                )}
                {result.key_insight && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Key Insight:</span> {result.key_insight}
                  </p>
                )}

                {result.why_this_works && result.why_this_works.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      Why this approach
                    </p>
                    <ul className="space-y-1">
                      {result.why_this_works.map((reason, i) => (
                        <li key={i} className="text-sm flex gap-2">
                          <span className="text-primary mt-0.5 shrink-0">•</span>
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.source_insights && result.source_insights.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      Informed by
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.source_insights.map((src, i) => (
                        <Badge key={i} variant="outline" className="text-xs gap-1 border-primary/30 text-primary bg-primary/5">
                          <span className="opacity-60">{categoryLabel(src.category)}</span>
                          {src.title}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Save section */}
            <div className="flex gap-2 items-center">
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Name this copy..."
                className="flex-1"
                disabled={!!savedGroupId}
              />
              <Button
                size="sm"
                variant={savedGroupId ? 'outline' : 'default'}
                onClick={handleSave}
                disabled={!!savedGroupId || saveMutation.isPending || !templateName.trim()}
                className={savedGroupId ? 'text-green-600 border-green-300' : ''}
              >
                {saveMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving...</>
                ) : savedGroupId ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Saved ✓</>
                ) : (
                  'Save to Library'
                )}
              </Button>
            </div>

            {/* Outreach Steps */}
            {result.steps?.map((s) => (
              <Card key={s.step}>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Step {s.step}
                      <Badge variant="secondary" className="text-xs">Day {s.day}</Badge>
                      {s.channel && (
                        <Badge variant="outline" className="text-xs">{s.channel}</Badge>
                      )}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="py-0 pb-4 space-y-3">
                  {s.subject && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</p>
                        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => handleCopy(s.subject!, 'Subject')}>
                          <Copy className="h-3 w-3 mr-1" />Copy
                        </Button>
                      </div>
                      <p className="text-sm font-medium">{s.subject}</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Body</p>
                      <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => handleCopy(s.body, 'Body')}>
                        <Copy className="h-3 w-3 mr-1" />Copy
                      </Button>
                    </div>
                    <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded-md p-3">{s.body}</p>
                  </div>
                </CardContent>
              </Card>
            ))}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep('form')}>
                ← Edit Inputs
              </Button>
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
