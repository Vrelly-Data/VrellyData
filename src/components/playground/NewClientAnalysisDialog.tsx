import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Linkedin, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

// Shape of the pre-fill data the dialog needs when reopened in edit mode.
// Provided by DataAnalysisTab's detail view.
export interface ClientAnalysisEditingState {
  clientId: string;
  displayName: string;
  heyreachAccountIds: number[];
  smartleadCampaignIds: string[];
}

interface NewClientAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Optional. When present, the dialog runs in edit mode: pre-checks the
  // listed IDs, hides the slug preview (slug isn't regenerated on edit),
  // and UPDATEs the existing client_analysis row instead of INSERTing.
  editing?: ClientAnalysisEditingState;
  // Fires after a successful create OR update. Caller decides whether to
  // refresh the list, jump to the new row, etc.
  onSaved?: (clientId: string) => void;
}

interface HeyReachAccount {
  id: number;
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
  profileUrl: string | null;
}

interface SyncedCampaignRow {
  id: string;
  name: string;
  external_campaign_id: string;
  status: string | null;
}

// "Acme Corp" -> "acme-corp"; append 6 random base36 chars to avoid collisions.
// Phase 2 will surface the slug as the public URL; the random suffix means
// slug is opaque (not a name-disclosure vector) without sacrificing readability.
// Only used on create — edit mode leaves the existing slug untouched.
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

function accountDisplayName(a: HeyReachAccount): string {
  const fn = (a.firstName ?? '').trim();
  const ln = (a.lastName ?? '').trim();
  const joined = [fn, ln].filter(Boolean).join(' ');
  return joined || a.emailAddress || `LinkedIn account`;
}

export function NewClientAnalysisDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: NewClientAnalysisDialogProps) {
  const { user } = useAuthStore();
  const isEditMode = !!editing;
  const [displayName, setDisplayName] = useState('');
  const [heyreachSelected, setHeyreachSelected] = useState<Set<number>>(new Set());
  const [smartleadSelected, setSmartleadSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill on (re)open when in edit mode. Reset to blank when transitioning
  // back to create mode or when the dialog is closed.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDisplayName(editing.displayName);
      setHeyreachSelected(new Set(editing.heyreachAccountIds));
      setSmartleadSelected(new Set(editing.smartleadCampaignIds));
    } else {
      setDisplayName('');
      setHeyreachSelected(new Set());
      setSmartleadSelected(new Set());
    }
  }, [open, editing]);

  // Fetch only while dialog is open. Re-fetch each open gives the admin
  // fresh data without a refresh button.
  const heyreachAccountsQuery = useQuery({
    queryKey: ['heyreach-accounts'],
    queryFn: async (): Promise<HeyReachAccount[]> => {
      const { data, error } = await supabase.functions.invoke('fetch-heyreach-accounts');
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return ((data as { accounts?: HeyReachAccount[] })?.accounts ?? []);
    },
    enabled: open,
    staleTime: 60_000,
  });

  // Smartlead campaigns come straight from the synced_campaigns table — the
  // same data the Playground reads. No live API call needed because names +
  // external IDs are already populated by sync-smartlead-campaigns.
  const smartleadCampaignsQuery = useQuery({
    queryKey: ['client-analysis-options', 'smartlead-campaigns'],
    queryFn: async (): Promise<SyncedCampaignRow[]> => {
      const { data, error } = await supabase
        .from('synced_campaigns')
        .select('id, name, external_campaign_id, status')
        .eq('source', 'smartlead')
        .eq('is_linked', true);
      if (error) throw error;
      return (data ?? []) as SyncedCampaignRow[];
    },
    enabled: open,
    staleTime: 60_000,
  });

  const smartleadCampaigns = useMemo(
    () =>
      (smartleadCampaignsQuery.data ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [smartleadCampaignsQuery.data],
  );

  const heyreachAccounts = useMemo(
    () =>
      (heyreachAccountsQuery.data ?? [])
        .slice()
        .sort((a, b) => accountDisplayName(a).localeCompare(accountDisplayName(b))),
    [heyreachAccountsQuery.data],
  );

  // Slug preview only shown on create — edit doesn't regenerate it.
  const slugPreview = useMemo(
    () => (!isEditMode && displayName.trim() ? buildSlug(displayName) : ''),
    [displayName, isEditMode],
  );

  const toggleHeyreach = (id: number) => {
    setHeyreachSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSmartlead = (externalId: string) => {
    setSmartleadSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
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
    if (heyreachSelected.size === 0 && smartleadSelected.size === 0) {
      toast.error('Pick at least one LinkedIn account or email campaign');
      return;
    }

    setSubmitting(true);
    try {
      if (isEditMode) {
        const { error } = await supabase
          .from('client_analysis')
          .update({
            display_name: trimmedName,
            heyreach_account_ids: Array.from(heyreachSelected),
            smartlead_campaign_ids: Array.from(smartleadSelected),
          })
          .eq('id', editing!.clientId);
        if (error) {
          toast.error(`Update failed: ${error.message}`);
          return;
        }
        toast.success('Client updated');
        onOpenChange(false);
        onSaved?.(editing!.clientId);
      } else {
        const slug = buildSlug(trimmedName);
        const { data, error } = await supabase
          .from('client_analysis')
          .insert({
            user_id: user.id,
            display_name: trimmedName,
            slug,
            heyreach_account_ids: Array.from(heyreachSelected),
            smartlead_campaign_ids: Array.from(smartleadSelected),
            synced_campaign_ids: [],
          })
          .select('id')
          .single();
        if (error) {
          if ((error as { code?: string }).code === '23505') {
            toast.error('Slug collision — try again (a new suffix is generated each attempt).');
          } else {
            toast.error(`Create failed: ${error.message}`);
          }
          return;
        }
        toast.success(`Client "${trimmedName}" created`);
        onOpenChange(false);
        onSaved?.(data.id);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const optionsLoading =
    heyreachAccountsQuery.isLoading || smartleadCampaignsQuery.isLoading;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!submitting) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit campaigns' : 'New client analysis'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Adjust which LinkedIn accounts and email campaigns belong to this client. The next Generate will use the updated scope.'
              : 'Pick which LinkedIn accounts and email campaigns belong to this client. The generate function will scope stats to your selections.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 py-2 pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              placeholder="Acme Corp"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
              autoFocus={!isEditMode}
            />
            {slugPreview && (
              <p className="text-xs text-muted-foreground">
                Slug (for Phase 2 public link, unused now):{' '}
                <code className="font-mono">{slugPreview}</code>
              </p>
            )}
          </div>

          {/* LinkedIn (HeyReach) — sender accounts */}
          <Section
            icon={<Linkedin className="h-4 w-4" />}
            title="LinkedIn (HeyReach)"
            selectedCount={heyreachSelected.size}
            totalCount={heyreachAccounts.length}
            loading={heyreachAccountsQuery.isLoading}
            error={heyreachAccountsQuery.error as Error | null}
            emptyMessage={
              !heyreachAccountsQuery.isLoading && heyreachAccounts.length === 0
                ? 'No LinkedIn accounts found (or no HeyReach integration configured).'
                : null
            }
          >
            {heyreachAccounts.map((a) => (
              <CheckboxRow
                key={`hr-${a.id}`}
                id={`hr-${a.id}`}
                checked={heyreachSelected.has(a.id)}
                onCheckedChange={() => toggleHeyreach(a.id)}
                disabled={submitting}
                title={accountDisplayName(a)}
                subtitle={a.emailAddress ?? undefined}
              />
            ))}
          </Section>

          {/* Email (Smartlead) — campaigns */}
          <Section
            icon={<Mail className="h-4 w-4" />}
            title="Email (Smartlead)"
            selectedCount={smartleadSelected.size}
            totalCount={smartleadCampaigns.length}
            loading={smartleadCampaignsQuery.isLoading}
            error={smartleadCampaignsQuery.error as Error | null}
            emptyMessage={
              !smartleadCampaignsQuery.isLoading && smartleadCampaigns.length === 0
                ? 'No Smartlead campaigns synced. Sync your Smartlead integration first.'
                : null
            }
          >
            {smartleadCampaigns.map((c) => (
              <CheckboxRow
                key={`sl-${c.id}`}
                id={`sl-${c.id}`}
                checked={smartleadSelected.has(c.external_campaign_id)}
                onCheckedChange={() => toggleSmartlead(c.external_campaign_id)}
                disabled={submitting}
                title={c.name}
                subtitle={c.status ?? undefined}
              />
            ))}
          </Section>
        </div>

        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              submitting ||
              !displayName.trim() ||
              optionsLoading ||
              (heyreachSelected.size === 0 && smartleadSelected.size === 0)
            }
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Local subcomponents — only meaningful inside this dialog. Pulled out for
// readability of the main component, not for reuse.
// ----------------------------------------------------------------------------

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  selectedCount: number;
  totalCount: number;
  loading: boolean;
  error: Error | null;
  emptyMessage: string | null;
  children: React.ReactNode;
}

function Section({
  icon,
  title,
  selectedCount,
  totalCount,
  loading,
  error,
  emptyMessage,
  children,
}: SectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </Label>
        {totalCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {selectedCount} of {totalCount} selected
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6 border rounded-md bg-muted/30">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-xs text-destructive border rounded-md p-3 bg-destructive/5">
          Failed to load: {error.message}
        </p>
      ) : emptyMessage ? (
        <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
          {emptyMessage}
        </p>
      ) : (
        <ScrollArea className="h-48 border rounded-md">
          <div className="p-2 space-y-1">{children}</div>
        </ScrollArea>
      )}
    </div>
  );
}

interface CheckboxRowProps {
  id: string;
  checked: boolean;
  onCheckedChange: () => void;
  disabled?: boolean;
  title: string;
  subtitle?: string;
}

function CheckboxRow({
  id,
  checked,
  onCheckedChange,
  disabled,
  title,
  subtitle,
}: CheckboxRowProps) {
  return (
    <div className="flex items-start gap-2 p-2 rounded hover:bg-accent/40 transition-colors">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
        <div className="text-sm font-medium truncate">{title}</div>
        {subtitle && (
          <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
        )}
      </label>
    </div>
  );
}
