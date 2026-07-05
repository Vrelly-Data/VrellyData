import { useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Copy, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface GenerateOnboardingLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Fires after a link is successfully minted (a new user was created), so the
  // caller can refresh the users list.
  onCreated?: () => void;
}

export function GenerateOnboardingLinkDialog({
  open,
  onOpenChange,
  onCreated,
}: GenerateOnboardingLinkDialogProps) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [company, setCompany] = useState('');
  const [alreadyPaid, setAlreadyPaid] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Once minted, we swap the form for a read-only link + copy button. The
  // link is the only time the admin sees the token, so it stays until close.
  const [mintedLink, setMintedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setEmail('');
    setDisplayName('');
    setCompany('');
    setAlreadyPaid(true);
    setMintedLink(null);
    setCopied(false);
  };

  const close = (o: boolean) => {
    if (submitting) return;
    if (!o) reset();
    onOpenChange(o);
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      toast.error('Email is required');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'admin-create-onboarding-link',
        {
          body: {
            email: trimmedEmail,
            displayName: displayName.trim(),
            company: company.trim(),
            alreadyPaid,
          },
        },
      );
      if (error) {
        toast.error(error.message || 'Failed to generate link');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const token = data?.token as string | undefined;
      if (!token) {
        toast.error('No token returned');
        return;
      }
      // Build the link against the admin's current origin so dev links point
      // at dev and prod links point at prod without any env config.
      setMintedLink(`${window.location.origin}/onboard/${token}`);
      toast.success('Onboarding link created');
      onCreated?.();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!mintedLink) return;
    try {
      await navigator.clipboard.writeText(mintedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select and copy manually');
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate onboarding link</DialogTitle>
          <DialogDescription>
            Creates the client&apos;s account and a unique onboarding link. Send
            the link to the client to fill out their agent questionnaire.
          </DialogDescription>
        </DialogHeader>

        {mintedLink ? (
          <div className="space-y-3 py-2">
            <Label>Onboarding link</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={mintedLink} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                title="Copy link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This is the only time the link is shown. The account is created;
              the client is not logged in. Handle their login separately.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ob-email">Client email</Label>
              <Input
                id="ob-email"
                type="email"
                placeholder="client@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-name">Display name</Label>
              <Input
                id="ob-name"
                placeholder="Jane Doe"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-company">Company</Label>
              <Input
                id="ob-company"
                placeholder="Acme Corp"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex items-start gap-2 pt-1">
              <Checkbox
                id="ob-paid"
                checked={alreadyPaid}
                onCheckedChange={(v) => setAlreadyPaid(v === true)}
                disabled={submitting}
                className="mt-0.5"
              />
              <label htmlFor="ob-paid" className="cursor-pointer">
                <div className="text-sm font-medium">Already paid</div>
                <div className="text-xs text-muted-foreground">
                  Client has paid outside Stripe — provisioning will create a
                  $0 agent subscription via the 100%-off coupon.
                </div>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          {mintedLink ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => close(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !email.trim()}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
