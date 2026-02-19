import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Copy, Sparkles, Lightbulb, CheckCircle2, BookOpen, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useSaveCopyMutation } from '@/hooks/useCopyTemplates';

interface RevampResult {
  subject: string | null;
  body: string | null;
  why_this_works?: string[];
  key_insight?: string;
  source_insights?: { title: string; category: string }[];
}

interface RevampResultDialogProps {
  open: boolean;
  onClose: () => void;
  original: { subject: string | null; body: string | null };
  revamped: RevampResult | null;
  stepNumber: number;
  stepType: string;
  campaignName?: string;
}

const categoryIconMap: Record<string, React.ReactNode> = {
  campaign_result: <TrendingUp className="h-3 w-3" />,
  sequence_playbook: <BookOpen className="h-3 w-3" />,
  audience_insight: <Users className="h-3 w-3" />,
  sales_guideline: <Lightbulb className="h-3 w-3" />,
  email_template: <Copy className="h-3 w-3" />,
};

const categoryLabelMap: Record<string, string> = {
  campaign_result: 'Campaign',
  sequence_playbook: 'Playbook',
  audience_insight: 'Audience',
  sales_guideline: 'Guideline',
  email_template: 'Template',
};

function getDefaultName(campaignName: string | undefined, stepNumber: number): string {
  const month = new Date().toLocaleString('default', { month: 'short', year: 'numeric' });
  const base = campaignName ? `Revamped — ${campaignName}` : 'Revamped';
  return `${base} Step ${stepNumber} — ${month}`;
}

export function RevampResultDialog({
  open,
  onClose,
  original,
  revamped,
  stepNumber,
  stepType,
  campaignName,
}: RevampResultDialogProps) {
  const [templateName, setTemplateName] = useState('');
  const [saved, setSaved] = useState(false);
  const saveMutation = useSaveCopyMutation();

  // Reset state when dialog opens with new result
  useEffect(() => {
    if (open) {
      setTemplateName(getDefaultName(campaignName, stepNumber));
      setSaved(false);
    }
  }, [open, campaignName, stepNumber]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleSave = async () => {
    if (!revamped || !templateName.trim()) return;
    try {
      await saveMutation.mutateAsync({
        templateName: templateName.trim(),
        steps: [{
          step: stepNumber,
          day: 1,
          channel: stepType,
          subject: revamped.subject,
          body: revamped.body || '',
        }],
      });
      setSaved(true);
      toast.success('Revamped copy saved to your library');
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message || 'Unknown error'}`);
    }
  };

  if (!revamped) return null;

  const hasInsights = !!(revamped.why_this_works?.length || revamped.key_insight);
  const hasSourceInsights = !!(revamped.source_insights?.length);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Revamped Copy — Step {stepNumber}
          </DialogTitle>
          <DialogDescription>
            AI-generated rewrite for your {stepType || 'email'}. Copy what you like or save it to your library.
          </DialogDescription>
        </DialogHeader>

        {/* Insights Card */}
        {(hasInsights || hasSourceInsights) && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-primary font-semibold text-sm">
              <Lightbulb className="h-4 w-4" />
              Why This Revamp Works
            </div>

            {revamped.key_insight && (
              <p className="text-sm text-foreground/80 italic border-l-2 border-primary/40 pl-3">
                "{revamped.key_insight}"
              </p>
            )}

            {revamped.why_this_works && revamped.why_this_works.length > 0 && (
              <ul className="space-y-1.5">
                {revamped.why_this_works.map((reason, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                    {reason}
                  </li>
                ))}
              </ul>
            )}

            {hasSourceInsights && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <span className="text-xs text-muted-foreground">Informed by:</span>
                {revamped.source_insights!.map((insight, i) => (
                  <Badge key={i} variant="outline" className="text-xs flex items-center gap-1 border-primary/30 text-primary">
                    {categoryIconMap[insight.category] || <TrendingUp className="h-3 w-3" />}
                    {categoryLabelMap[insight.category] || insight.category}: {insight.title}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Save to Library */}
        <div className="flex gap-2 items-center">
          <Input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Name this copy..."
            className="flex-1"
            disabled={saved}
          />
          <Button
            onClick={handleSave}
            disabled={saved || saveMutation.isPending || !templateName.trim()}
            className={saved ? 'bg-green-600 hover:bg-green-600 text-white' : ''}
          >
            {saved ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Saved ✓
              </>
            ) : saveMutation.isPending ? (
              'Saving...'
            ) : (
              'Save to Library'
            )}
          </Button>
        </div>

        {/* Side-by-side comparison */}
        <div className="grid grid-cols-2 gap-4">
          {/* Original */}
          <div className="space-y-3">
            <Badge variant="secondary">Original</Badge>
            {original.subject && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Subject</p>
                <p className="text-sm font-medium bg-muted/50 p-2 rounded">{original.subject}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Body</p>
              <div className="text-sm bg-muted/50 p-3 rounded max-h-64 overflow-y-auto whitespace-pre-wrap">
                {original.body || '(empty)'}
              </div>
            </div>
          </div>

          {/* Revamped */}
          <div className="space-y-3">
            <Badge className="bg-primary">Revamped</Badge>
            {revamped.subject && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">Subject</p>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => handleCopy(revamped.subject!, 'Subject')}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                </div>
                <p className="text-sm font-medium bg-primary/10 p-2 rounded border border-primary/20">{revamped.subject}</p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Body</p>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => handleCopy(revamped.body || '', 'Body')}>
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>
              <div className="text-sm bg-primary/10 p-3 rounded border border-primary/20 max-h-64 overflow-y-auto whitespace-pre-wrap">
                {revamped.body || '(empty)'}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
