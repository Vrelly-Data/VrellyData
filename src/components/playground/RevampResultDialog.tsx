import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface RevampResult {
  subject: string | null;
  body: string | null;
}

interface RevampResultDialogProps {
  open: boolean;
  onClose: () => void;
  original: { subject: string | null; body: string | null };
  revamped: RevampResult | null;
  stepNumber: number;
  stepType: string;
}

export function RevampResultDialog({ open, onClose, original, revamped, stepNumber, stepType }: RevampResultDialogProps) {
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  if (!revamped) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Revamped Copy — Step {stepNumber}
          </DialogTitle>
          <DialogDescription>
            AI-generated rewrite for your {stepType || 'email'}. Copy what you like.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 mt-4">
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

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
