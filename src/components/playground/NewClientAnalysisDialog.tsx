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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Linkedin, Mail, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { PLATFORM, SOURCE } from '@/lib/platforms';

// Sentinel used by the Reply.io Select to represent "no Reply.io workspace
// linked to this client". Radix Select requires non-empty string values, so
// we map "none" ↔ null at the boundary.
const REPLY_IO_NONE = 'none';

// Shape of the pre-fill data the dialog needs when reopened in edit mode.
// Provided by DataAnalysisTab's detail view.
export interface ClientAnalysisEditingState {
  clientId: string;
  displayName: string;
  heyreachAccountIds: number[];
  smartleadCampaignIds: string[];
  // Step 3b: optional single Reply.io workspace FK. Null = client has no
  // Reply.io. Unlike HR/SL which are arrays of account/campaign IDs,
  // Reply.io is workspace-scoped (one workspace = one key = one
  // outbound_integrations row), so the picker stores one FK.
  replyIoIntegrationId: string | null;
  // Per-client EXCLUDE list (external_campaign_id[]) of Reply.io campaigns
  // hidden from the client's shared report. Absent/empty = all shown.
  excludedReplyIoCampaignIds: string[];
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

interface ReplyIoCampaignRow {
  id: string;
  name: string;
  external_campaign_id: string;
  status: string | null;
  // 'linkedin' | 'email' | null — drives the per-row channel icon.
  channel: string | null;
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
  const [replyIoIntegrationId, setReplyIoIntegrationId] = useState<string | null>(null);
  // EXCLUDE set: external_campaign_ids the admin has unchecked. A reply_io
  // campaign is INCLUDED unless its id is in here, so campaigns synced later
  // default to shown. Scoped to the selected workspace — reset on change.
  const [replyIoExcluded, setReplyIoExcluded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill on (re)open when in edit mode. Reset to blank when transitioning
  // back to create mode or when the dialog is closed.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDisplayName(editing.displayName);
      setHeyreachSelected(new Set(editing.heyreachAccountIds));
      setSmartleadSelected(new Set(editing.smartleadCampaignIds));
      setReplyIoIntegrationId(editing.replyIoIntegrationId);
      setReplyIoExcluded(new Set(editing.excludedReplyIoCampaignIds));
    } else {
      setDisplayName('');
      setHeyreachSelected(new Set());
      setSmartleadSelected(new Set());
      setReplyIoIntegrationId(null);
      setReplyIoExcluded(new Set());
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

  // Reply.io is workspace-scoped — one workspace ⇄ one API key ⇄ one
  // outbound_integrations row (enforced by the partial unique index in the
  // 20260619120000 migration). So the picker lists active reply.io
  // integration rows and writes the chosen one's id to
  // client_analysis.reply_io_integration_id.
  const replyIoIntegrationsQuery = useQuery({
    queryKey: ['client-analysis-options', 'reply-io-integrations'],
    queryFn: async (): Promise<{ id: string; name: string | null }[]> => {
      const { data, error } = await supabase
        .from('outbound_integrations')
        .select('id, name')
        .eq('platform', PLATFORM.REPLY_IO)
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string | null }[];
    },
    enabled: open,
    staleTime: 60_000,
  });

  // Per-campaign reply_io list for the selected workspace. Only these can be
  // shown/hidden; the query is disabled until a workspace is picked. Mirrors
  // generate-client-analysis's scope (source='reply_io', is_linked=true,
  // integration_id = picker selection) so the checkboxes match what the
  // report would include.
  const replyIoCampaignsQuery = useQuery({
    queryKey: ['client-analysis-options', 'reply-io-campaigns', replyIoIntegrationId],
    queryFn: async (): Promise<ReplyIoCampaignRow[]> => {
      const { data, error } = await supabase
        .from('synced_campaigns')
        .select('id, name, external_campaign_id, status, channel')
        .eq('source', SOURCE.REPLY_IO)
        .eq('is_linked', true)
        .eq('integration_id', replyIoIntegrationId!);
      if (error) throw error;
      return (data ?? []) as ReplyIoCampaignRow[];
    },
    enabled: open && !!replyIoIntegrationId,
    staleTime: 60_000,
  });

  const replyIoCampaigns = useMemo(
    () =>
      (replyIoCampaignsQuery.data ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [replyIoCampaignsQuery.data],
  );

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

  const replyIoIntegrations = useMemo(
    () => replyIoIntegrationsQuery.data ?? [],
    [replyIoIntegrationsQuery.data],
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

  // Checkbox reflects INCLUDED state (checked = shown). Unchecking adds the
  // id to the exclude set; re-checking removes it.
  const toggleReplyIoCampaign = (externalId: string) => {
    setReplyIoExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  // Switching or clearing the workspace invalidates the exclude set — those
  // ids belong to the previous workspace's campaigns. Reset to "all shown".
  const changeReplyIoIntegration = (next: string | null) => {
    setReplyIoIntegrationId(next);
    setReplyIoExcluded(new Set());
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
    if (
      heyreachSelected.size === 0 &&
      smartleadSelected.size === 0 &&
      !replyIoIntegrationId
    ) {
      toast.error(
        'Pick at least one LinkedIn account, email campaign, or Reply.io workspace',
      );
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
            reply_io_integration_id: replyIoIntegrationId,
            excluded_reply_io_campaign_ids: replyIoIntegrationId
              ? Array.from(replyIoExcluded)
              : [],
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
            reply_io_integration_id: replyIoIntegrationId,
            excluded_reply_io_campaign_ids: replyIoIntegrationId
              ? Array.from(replyIoExcluded)
              : [],
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
    heyreachAccountsQuery.isLoading ||
    smartleadCampaignsQuery.isLoading ||
    replyIoIntegrationsQuery.isLoading;

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

          {/* Reply.io workspace — single Select (one workspace per client).
              Unlike HR/SL multi-pick, Reply.io's scope IS the workspace, so
              the picker is just "which workspace is this client?" + a None
              option. Selecting None unlinks any prior workspace. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="h-4 w-4" />
                Reply.io workspace
              </Label>
              {replyIoIntegrations.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {replyIoIntegrationId ? '1 selected' : 'none selected'}
                </span>
              )}
            </div>

            {replyIoIntegrationsQuery.isLoading ? (
              <div className="flex justify-center py-4 border rounded-md bg-muted/30">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : replyIoIntegrationsQuery.error ? (
              <p className="text-xs text-destructive border rounded-md p-3 bg-destructive/5">
                Failed to load: {(replyIoIntegrationsQuery.error as Error).message}
              </p>
            ) : replyIoIntegrations.length === 0 ? (
              <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                No active Reply.io integrations. Add one via the Integrations
                tab first if this client uses Reply.io.
              </p>
            ) : (
              <Select
                value={replyIoIntegrationId ?? REPLY_IO_NONE}
                onValueChange={(v) =>
                  changeReplyIoIntegration(v === REPLY_IO_NONE ? null : v)
                }
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={REPLY_IO_NONE}>None (no Reply.io)</SelectItem>
                  {replyIoIntegrations.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name ?? `Workspace ${i.id.slice(0, 8)}…`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Per-campaign show/hide for the selected workspace. Checked =
                shown in the client's report. Unchecking adds the campaign to
                the EXCLUDE list; campaigns synced later stay checked (shown)
                by default. Only rendered once a workspace is picked. */}
            {replyIoIntegrationId && (
              <Section
                icon={<MessageSquare className="h-4 w-4" />}
                title="Campaigns shown to client"
                selectedCount={
                  replyIoCampaigns.filter(
                    (c) => !replyIoExcluded.has(c.external_campaign_id),
                  ).length
                }
                totalCount={replyIoCampaigns.length}
                loading={replyIoCampaignsQuery.isLoading}
                error={replyIoCampaignsQuery.error as Error | null}
                emptyMessage={
                  !replyIoCampaignsQuery.isLoading &&
                  replyIoCampaigns.length === 0
                    ? 'No linked Reply.io campaigns for this workspace yet. Newly synced campaigns appear here and are shown by default.'
                    : null
                }
              >
                {replyIoCampaigns.map((c) => (
                  <CheckboxRow
                    key={`rio-${c.id}`}
                    id={`rio-${c.id}`}
                    checked={!replyIoExcluded.has(c.external_campaign_id)}
                    onCheckedChange={() =>
                      toggleReplyIoCampaign(c.external_campaign_id)
                    }
                    disabled={submitting}
                    icon={
                      c.channel === 'linkedin' ? (
                        <Linkedin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : c.channel === 'email' ? (
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : undefined
                    }
                    title={c.name}
                    subtitle={c.status ?? undefined}
                  />
                ))}
              </Section>
            )}
          </div>
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
              (heyreachSelected.size === 0 &&
                smartleadSelected.size === 0 &&
                !replyIoIntegrationId)
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
  // Optional leading icon (e.g. per-row channel indicator).
  icon?: React.ReactNode;
}

function CheckboxRow({
  id,
  checked,
  onCheckedChange,
  disabled,
  title,
  subtitle,
  icon,
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
        <div className="flex items-center gap-1.5 text-sm font-medium truncate">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
        )}
      </label>
    </div>
  );
}
