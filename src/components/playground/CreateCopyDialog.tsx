import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Sparkles, Copy, X, Plus, Lightbulb, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CopyStep {
  step: number;
  day: number;
  subject: string;
  body: string;
}

interface GeneratedCopy {
  positioning_statement: string;
  key_insight: string;
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

export function CreateCopyDialog({ open, onOpenChange }: CreateCopyDialogProps) {
  const [step, setStep] = useState<'form' | 'result'>('form');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedCopy | null>(null);

  // Form state
  const [product, setProduct] = useState('');
  const [industries, setIndustries] = useState<string[]>([]);
  const [isBtoB, setIsBtoB] = useState(true);
  const [targetTitles, setTargetTitles] = useState<string[]>([]);
  const [companyTypes, setCompanyTypes] = useState<string[]>([]);
  const [companyStandout, setCompanyStandout] = useState('');

  const handleGenerate = async () => {
    if (!product.trim()) {
      toast.error('Please describe your product or service');
      return;
    }

    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-copy', {
        body: { product, industries, isBtoB, targetTitles, companyTypes, companyStandout },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data as GeneratedCopy);
      setStep('result');
    } catch (err: any) {
      toast.error(`Failed to generate copy: ${err.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep('form');
      setResult(null);
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
              ? 'Tell us about your business and we\'ll generate a tailored email sequence using your top-performing campaign data.'
              : 'AI-generated copy based on your best-performing campaigns. Click to copy any section.'}
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
            {/* Insights */}
            {(result.positioning_statement || result.key_insight) && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    AI Insights
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-0 pb-4 space-y-2">
                  {result.positioning_statement && (
                    <p className="text-sm"><span className="font-medium">Positioning:</span> {result.positioning_statement}</p>
                  )}
                  {result.key_insight && (
                    <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Key Insight:</span> {result.key_insight}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Email Steps */}
            {result.steps?.map((s) => (
              <Card key={s.step}>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Step {s.step}
                      <Badge variant="secondary" className="text-xs">Day {s.day}</Badge>
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="py-0 pb-4 space-y-3">
                  {s.subject && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</p>
                        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => handleCopy(s.subject, 'Subject')}>
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
