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
  useCreateOrganization,
  useUpdateOrganization,
} from '@/hooks/useOrganizations';

interface EditOrgDialogProps {
  /**
   * The organization to edit, or NULL to create a new one. Create and edit
   * share this dialog deliberately: the field list, the dollars->cents parsing
   * and the required-name rule are identical, and a second form would be a
   * second place for them to drift.
   */
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
  const create = useCreateOrganization();
  const isCreate = org === null;
  const pending = update.isPending || create.isPending;

  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [domain, setDomain] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [billingDate, setBillingDate] = useState('');
  const [manualDollars, setManualDollars] = useState('');

  // Reset on every open so a create form never inherits the last edited org's
  // values, and re-opening an edit always reflects current data.
  useEffect(() => {
    if (!open) return;
    setName(org?.name ?? '');
    setContactName(org?.contact_name ?? '');
    setContactEmail(org?.contact_email ?? '');
    setContactPhone(org?.contact_phone ?? '');
    setFirstName(org?.first_name ?? '');
    setLastName(org?.last_name ?? '');
    setLinkedinUrl(org?.linkedin_url ?? '');
    setDomain(org?.domain ?? '');
    setNotes(org?.notes ?? '');
    setIsActive(org?.is_active ?? true);
    setBillingDate(org?.billing_date ?? '');
    setManualDollars(centsToInput(org?.manual_monthly_cents));
  }, [org, open]);

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
    const fields = {
      name: name.trim(),
      contact_name: contactName.trim() || null,
      contact_email: contactEmail.trim() || null,
      contact_phone: contactPhone.trim() || null,
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      linkedin_url: linkedinUrl.trim() || null,
      domain: domain.trim() || null,
      notes: notes.trim() || null,
      is_active: isActive,
      // Empty input -> null, never ''. Postgres rejects '' for a DATE, and an
      // unset billing date means unknown.
      billing_date: billingDate.trim() || null,
      manual_monthly_cents: manualCents,
    };

    try {
      if (isCreate) {
        await create.mutateAsync(fields);
        toast.success('Organization created');
      } else {
        await update.mutateAsync({ id: org.id, ...fields });
        toast.success('Organization updated');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(`${isCreate ? 'Create' : 'Update'} failed: ${(e as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreate ? 'Add organization' : 'Edit organization'}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? 'Creates a CRM record. Linking it to a platform account is optional and can happen later.'
              : org.name}
          </DialogDescription>
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

          {/* Split name fields — populated when the source data already has them
              separated. Independent of contact_name, which stays the display
              field in the table; neither is derived from the other. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Last name">
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
          </div>
          <Field label="LinkedIn URL">
            <Input
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/in/..."
            />
          </Field>
          <Field label="Domain">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
            />
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

          {/* Grouped with the monthly amount — both answer "what do they pay
              and when", and the operator sets them together. */}
          <Field label="Billing date">
            <Input
              type="date"
              value={billingDate}
              onChange={(e) => setBillingDate(e.target.value)}
            />
          </Field>

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

          {/* Stripe figures exist only once a customer id has been linked and
              synced, so there is nothing to show on a fresh record. */}
          {org && (
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
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending || !name.trim()}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isCreate ? 'Create' : 'Save'}
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
