import { useEffect, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Organization,
  effectiveSource,
  useUpdateOrganization,
} from '@/hooks/useOrganizations';

interface EditOrgDialogProps {
  org: Organization | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const centsToInput = (c: number | null | undefined) =>
  c == null ? '' : (c / 100).toString();
const fmtStripe = (c: number | null, at: string | null) =>
  c == null
    ? 'Never synced'
    : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` +
      (at ? ` (synced ${new Date(at).toLocaleDateString()})` : '');

export function EditOrgDialog({ org, open, onOpenChange }: EditOrgDialogProps) {
  const update = useUpdateOrganization();
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [manualDollars, setManualDollars] = useState('');

  useEffect(() => {
    if (!org) return;
    setName(org.name ?? '');
    setContactName(org.contact_name ?? '');
    setContactEmail(org.contact_email ?? '');
    setContactPhone(org.contact_phone ?? '');
    setNotes(org.notes ?? '');
    setIsActive(org.is_active);
    setManualDollars(centsToInput(org.manual_monthly_cents));
  }, [org]);

  if (!org) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Org name is required');
      return;
    }
    // Blank manual field → null (fall back to Stripe). A number → cents.
    let manualCents: number | null = null;
    const trimmed = manualDollars.trim();
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        toast.error('Manual monthly amount must be a non-negative number');
        return;
      }
      manualCents = Math.round(n * 100);
    }
    try {
      await update.mutateAsync({
        id: org.id,
        name: name.trim(),
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        notes: notes.trim() || null,
        is_active: isActive,
        manual_monthly_cents: manualCents,
      });
      toast.success('Organization updated');
      onOpenChange(false);
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit organization</DialogTitle>
          <DialogDescription>{org.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="Org name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Contact name">
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label="Contact email">
            <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </Field>
          <Field label="Contact phone">
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground">Counts toward MRR when on.</div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <Field label="Manual monthly amount ($)">
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 2500"
              value={manualDollars}
              onChange={(e) => setManualDollars(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Overrides the Stripe amount. Use this for clients who pay outside
              Stripe. Leave blank to use the Stripe figure.
            </p>
          </Field>

          <div className="rounded-md border p-3 bg-muted/30">
            <div className="text-xs font-medium text-muted-foreground">
              Stripe-synced amount (read-only)
            </div>
            <div className="text-sm mt-0.5">
              {fmtStripe(org.stripe_monthly_cents, org.stripe_synced_at)}
            </div>
            {effectiveSource(org) === 'stripe' && org.stripe_monthly_cents === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                Stripe reports $0 (likely a 100%-off coupon). Set a manual amount
                to record what they actually pay.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={update.isPending || !name.trim()}>
            {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
