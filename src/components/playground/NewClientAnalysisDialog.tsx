import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

interface NewClientAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (clientId: string) => void;
}

// "Acme Corp" -> "acme-corp"; append 6 random base36 chars to avoid collisions.
// Phase 2 will surface the slug as the public URL; the random suffix means
// slug is opaque (not a name-disclosure vector) without sacrificing readability.
function buildSlug(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(36))
    .join('')
    .slice(0, 6);
  return `${base || 'client'}-${suffix}`;
}

// Comma-separated input -> trimmed unique array. Empty entries dropped.
function parseList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

function parseIntList(input: string): { ok: number[]; bad: string[] } {
  const parts = parseList(input);
  const ok: number[] = [];
  const bad: string[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (Number.isFinite(n) && Number.isInteger(n) && n > 0) ok.push(n);
    else bad.push(p);
  }
  return { ok, bad };
}

export function NewClientAnalysisDialog({
  open,
  onOpenChange,
  onCreated,
}: NewClientAnalysisDialogProps) {
  const { user } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [heyreachInput, setHeyreachInput] = useState('');
  const [smartleadInput, setSmartleadInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const slugPreview = useMemo(
    () => (displayName.trim() ? buildSlug(displayName) : ''),
    // Intentionally NOT re-running on every keystroke for the suffix — but
    // useMemo with displayName key DOES re-run on every change, regenerating
    // the suffix. That's fine for a preview; the real slug is committed
    // server-side at submit time below (one fresh call) so the preview and
    // the stored value are independent.
    [displayName],
  );

  const reset = () => {
    setDisplayName('');
    setHeyreachInput('');
    setSmartleadInput('');
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error('Not signed in');
      return;
    }
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      toast.error('Display name is required');
      return;
    }

    const { ok: heyreachIds, bad: badHeyreach } = parseIntList(heyreachInput);
    if (badHeyreach.length > 0) {
      toast.error(
        `HeyReach account IDs must be positive integers (bad: ${badHeyreach.join(', ')})`,
      );
      return;
    }
    const smartleadIds = parseList(smartleadInput);

    setSubmitting(true);
    try {
      const slug = buildSlug(trimmedName);
      const { data, error } = await supabase
        .from('client_analysis')
        .insert({
          user_id: user.id,
          display_name: trimmedName,
          slug,
          heyreach_account_ids: heyreachIds,
          smartlead_campaign_ids: smartleadIds,
          synced_campaign_ids: [],
        })
        .select('id')
        .single();

      if (error) {
        // 23505 = unique_violation; almost certainly the slug. Surface plainly
        // so the user can retry (which generates a new suffix).
        if ((error as { code?: string }).code === '23505') {
          toast.error('Slug collision — try again (a new suffix is generated each attempt).');
        } else {
          toast.error(`Create failed: ${error.message}`);
        }
        return;
      }

      toast.success(`Client "${trimmedName}" created`);
      reset();
      onOpenChange(false);
      onCreated?.(data.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!submitting) {
          if (!o) reset();
          onOpenChange(o);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New client analysis</DialogTitle>
          <DialogDescription>
            Phase 1: list the HeyReach accounts and Smartlead campaigns that belong
            to this client. IDs come from HeyReach/Smartlead dashboards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              placeholder="Acme Corp"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
              autoFocus
            />
            {slugPreview && (
              <p className="text-xs text-muted-foreground">
                Slug (for Phase 2 public link, unused now):{' '}
                <code className="font-mono">{slugPreview}</code>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="heyreach-ids">HeyReach account IDs</Label>
            <Input
              id="heyreach-ids"
              placeholder="12345, 67890"
              value={heyreachInput}
              onChange={(e) => setHeyreachInput(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated positive integers. Leave blank if Smartlead-only.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="smartlead-ids">Smartlead campaign IDs</Label>
            <Input
              id="smartlead-ids"
              placeholder="11111, 22222"
              value={smartleadInput}
              onChange={(e) => setSmartleadInput(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Leave blank if HeyReach-only.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !displayName.trim()}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
