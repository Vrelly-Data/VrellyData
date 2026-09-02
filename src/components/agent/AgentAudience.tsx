import { useState } from 'react';
import { Plus, Loader2, Pencil, Trash2, AlertTriangle, Telescope, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TagInput } from '@/components/ui/tag-input';
import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';
import { useToast } from '@/hooks/use-toast';
import { AudiencePreviewDialog } from './AudiencePreviewDialog';
import { AudienceSourceSelect } from './AudienceSourceSelect';
import { getAudienceSource, DEFAULT_SOURCE } from '@/lib/audienceSources';
import {
  useAgentAudiences, useAudienceCampaigns, useCreateAudience, useUpdateAudience,
  useToggleAudienceActive, useDeleteAudience,
  type AgentAudience as Audience, type AudienceInput, type ApolloAudienceFilters,
} from '@/hooks/useAgentAudiences';

// Apollo's own vocabulary, verbatim — these strings go straight into the
// api_search body, so they must not be prettified.
const SENIORITIES = [
  'owner', 'founder', 'c_suite', 'partner', 'vp', 'head',
  'director', 'manager', 'senior', 'entry', 'intern',
];
const EMPLOYEE_RANGES = [
  '1,10', '11,20', '21,50', '51,100', '101,200',
  '201,500', '501,1000', '1001,2000', '2001,5000', '5001,10000', '10001,1000000',
];
// Only these three are real. Verified live: their counts sum to exactly the
// unfiltered baseline, so this is the COMPLETE set. Apollo's docs also list
// 'unverified' and 'likely_to_engage' — both are silently ignored, so offering
// them would be a dead option that looks like it did something.
const EMAIL_STATUSES = [
  { label: 'Verified', value: 'verified' },
  { label: 'Guessed', value: 'guessed' },
  { label: 'Unavailable', value: 'unavailable' },
];
const DEPARTMENTS = [
  'sales', 'marketing', 'engineering', 'finance',
  'human_resources', 'operations', 'information_technology', 'c_suite',
];

const EMPTY: AudienceInput = {
  name: '', default_platform: null, default_synced_campaign_id: null,
  cadence: 'manual', max_per_run: 25, max_total: null, filters: {},
  source: DEFAULT_SOURCE,
};

function statusBadge(a: Audience) {
  if (a.consecutive_failures >= 3) {
    return <Badge variant="destructive">Paused ({a.consecutive_failures} failures)</Badge>;
  }
  switch (a.last_run_status) {
    case 'success': return <Badge variant="secondary">Success</Badge>;
    case 'partial': return <Badge variant="outline">Partial</Badge>;
    case 'failed': return <Badge variant="destructive">Failed</Badge>;
    case 'running': return <Badge variant="outline">Running…</Badge>;
    default: return <Badge variant="outline">Never run</Badge>;
  }
}

export function AgentAudience() {
  const { toast } = useToast();
  const { data: audiences = [], isLoading } = useAgentAudiences();
  const createAudience = useCreateAudience();
  const updateAudience = useUpdateAudience();
  const toggleActive = useToggleAudienceActive();
  const deleteAudience = useDeleteAudience();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Audience | null>(null);
  const [previewing, setPreviewing] = useState<Audience | null>(null);
  const [form, setForm] = useState<AudienceInput>(EMPTY);
  const { data: campaigns = [] } = useAudienceCampaigns(form.default_platform ?? undefined);

  const setFilter = <K extends keyof ApolloAudienceFilters>(
    key: K, value: ApolloAudienceFilters[K],
  ) => setForm((f) => ({ ...f, filters: { ...f.filters, [key]: value } }));

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (a: Audience) => {
    setEditing(a);
    setForm({
      name: a.name,
      default_platform: a.default_platform,
      default_synced_campaign_id: a.default_synced_campaign_id,
      cadence: a.cadence, max_per_run: a.max_per_run, max_total: a.max_total,
      filters: a.filters ?? {},
      // Carried through unchanged, and the selector is locked while editing.
      source: a.source ?? DEFAULT_SOURCE,
    });
    setOpen(true);
  };

  // An "effective" filter, matching what buildSearchBody will actually send.
  // The object case is load-bearing: revenue_range with both bounds cleared is
  // {min: undefined, max: undefined}, and a plain truthiness test says that is a
  // filter. It is not — buildSearchBody omits it — so Save would enable and the
  // run would then fail at search with "At least one search filter is required".
  const isSet = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return Object.values(v).some((x) => x !== undefined && x !== null && x !== '');
    return v !== undefined && v !== null && v !== '';
  };
  const hasFilter = Object.values(form.filters).some(isSet);

  const save = async () => {
    try {
      if (editing) await updateAudience.mutateAsync({ id: editing.id, updates: form });
      else await createAudience.mutateAsync(form);
      toast({ title: editing ? 'Audience updated' : 'Audience created' });
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Could not save', description: e?.message, variant: 'destructive' });
    }
  };

  // The DB trigger owns the activation rule. Surface its message rather than
  // duplicating the rule here, where it would drift.
  const onToggle = async (a: Audience, next: boolean) => {
    try {
      await toggleActive.mutateAsync({ id: a.id, is_active: next });
      toast({ title: next ? 'Audience armed' : 'Audience paused' });
    } catch (e: any) {
      toast({
        title: next ? "Can't arm this audience yet" : 'Could not pause',
        description: e?.message ?? 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const campaignName = (a: Audience) =>
    campaigns.find((c) => c.id === a.default_synced_campaign_id)?.name ?? null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Telescope className="h-5 w-5" /> Agent Audience
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Saved searches that feed contacts into a campaign.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New audience</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : audiences.length === 0 ? (
        <div className="border rounded-lg py-16 text-center text-muted-foreground">
          <Telescope className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No audiences yet</p>
          <p className="text-sm mt-1">Create one to preview matching contacts before pushing any.</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead className="text-right">Pushed</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="w-56" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {audiences.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>
                    {/* Read through the registry, so a row written before the
                        source column existed shows 'Apollo' rather than blank. */}
                    <Badge variant="outline">{getAudienceSource(a.source).label}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {a.default_platform ? (
                      <>
                        <span className="capitalize">{a.default_platform}</span>
                        <span className="text-muted-foreground">
                          {' · '}{campaignName(a) ?? '(campaign unavailable)'}
                        </span>
                      </>
                    ) : (
                      // Not a fault: an audience with no default is valid and
                      // fully usable manually. It just cannot be scheduled.
                      <span className="text-muted-foreground">Chosen at push time</span>
                    )}
                  </TableCell>
                  <TableCell className="capitalize text-sm">{a.cadence}</TableCell>
                  <TableCell className="text-right text-sm">
                    {a.total_pushed}{a.max_total ? ` / ${a.max_total}` : ''}
                  </TableCell>
                  <TableCell>{statusBadge(a)}</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={a.is_active}
                      onCheckedChange={(v) => onToggle(a, v)}
                      disabled={toggleActive.isPending}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      {/* The only way to produce a run. The activation guard
                          refuses to arm an audience until one has succeeded, so
                          this is also the path to arming — it must not be a bare
                          icon the operator has to guess at. */}
                      <Button variant="outline" size="sm" onClick={() => setPreviewing(a)}>
                        <Rocket className="h-4 w-4 mr-2" />Preview &amp; run
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        onClick={async () => {
                          if (!confirm(`Delete "${a.name}"? Its run history and push log go too.`)) return;
                          await deleteAudience.mutateAsync(a.id);
                          toast({ title: 'Audience deleted' });
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit audience' : 'New audience'}</DialogTitle>
            <DialogDescription>
              Filters are sent to the source as-is. Nothing is pushed until you preview and confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Locked while editing. The filters below are stored in the
                selected source's own vocabulary, so switching source under
                saved filters would reinterpret them as a language they are not
                written in — and Apollo's api_search drops unknown keys without
                erroring, which makes that loss silent. Changing source means
                making a new audience. */}
            <AudienceSourceSelect
              value={form.source ?? DEFAULT_SOURCE}
              onChange={(v) => setForm({ ...form, source: v })}
              locked={!!editing}
            />

            <div>
              <Label>Name</Label>
              <Input
                value={form.name} placeholder="CEOs in healthcare"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="border-t pt-4 space-y-3">
              <div>
                <p className="text-sm font-medium">Default destination</p>
                <p className="text-xs text-muted-foreground">
                  Optional. Manual pushes pick a destination each time — this is only
                  used by scheduled runs, and is required before an audience can be armed.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Platform</Label>
                  <Select
                    value={form.default_platform ?? ''}
                    onValueChange={(v: 'smartlead' | 'reply.io') =>
                      // Campaigns are platform-specific, so switching platform must
                      // clear the link rather than leave a mismatched one — the
                      // server rejects a platform/source mismatch outright.
                      setForm({ ...form, default_platform: v, default_synced_campaign_id: null })}
                  >
                    <SelectTrigger><SelectValue placeholder="None (manual only)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reply.io">Reply.io</SelectItem>
                      <SelectItem value="smartlead">Smartlead</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Campaign</Label>
                  <Select
                    value={form.default_synced_campaign_id ?? ''}
                    onValueChange={(v) => setForm({ ...form, default_synced_campaign_id: v })}
                    disabled={!form.default_platform}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={form.default_platform ? 'Select a campaign' : 'Pick a platform first'} />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.cadence !== 'manual' && !form.default_synced_campaign_id && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  A {form.cadence} audience needs a default destination before it can be armed.
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Cadence</Label>
                <Select
                  value={form.cadence}
                  onValueChange={(v: 'manual' | 'daily' | 'weekly') => setForm({ ...form, cadence: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual only</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Max per run</Label>
                <Input
                  type="number" min={1} max={100} value={form.max_per_run}
                  onChange={(e) => setForm({ ...form, max_per_run: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Lifetime cap</Label>
                <Input
                  type="number" min={1} placeholder="none"
                  value={form.max_total ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, max_total: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <p className="text-sm font-medium">
                {getAudienceSource(form.source).label} filters
              </p>

              <div>
                <Label>Job titles</Label>
                <TagInput
                  value={form.filters.person_titles ?? []}
                  onChange={(v) => setFilter('person_titles', v)}
                  placeholder="CEO, VP Sales — Enter to add"
                />
              </div>

              <div>
                <Label>Seniority</Label>
                <MultiSelectDropdown
                  options={SENIORITIES}
                  selected={form.filters.person_seniorities ?? []}
                  onChange={(v) => setFilter('person_seniorities', v)}
                  placeholder="Any seniority"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Person location</Label>
                  <TagInput
                    value={form.filters.person_locations ?? []}
                    onChange={(v) => setFilter('person_locations', v)}
                    placeholder="California, US"
                  />
                </div>
                <div>
                  <Label>Company HQ location</Label>
                  <TagInput
                    value={form.filters.organization_locations ?? []}
                    onChange={(v) => setFilter('organization_locations', v)}
                    placeholder="United States"
                  />
                </div>
              </div>

              <div>
                <Label>Company size</Label>
                <MultiSelectDropdown
                  options={EMPLOYEE_RANGES.map((r) => ({ label: r.replace(',', '–'), value: r }))}
                  selected={form.filters.organization_num_employees_ranges ?? []}
                  onChange={(v) => setFilter('organization_num_employees_ranges', v)}
                  placeholder="Any size"
                />
              </div>

              <div>
                <Label>Keywords</Label>
                <Input
                  value={form.filters.q_keywords ?? ''}
                  placeholder="healthcare"
                  onChange={(e) => setFilter('q_keywords', e.target.value)}
                />
              </div>

              <div>
                <Label>Industry / company keywords</Label>
                <TagInput
                  value={form.filters.q_organization_keyword_tags ?? []}
                  onChange={(v) => setFilter('q_organization_keyword_tags', v)}
                  placeholder="saas, logistics — Enter to add"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Apollo has no true industry filter on this endpoint; these tags are the
                  closest equivalent.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email status</Label>
                  <MultiSelectDropdown
                    options={EMAIL_STATUSES}
                    selected={form.filters.contact_email_status ?? []}
                    onChange={(v) => setFilter('contact_email_status', v)}
                    placeholder="Any"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Restricting to Verified reduces wasted enrichment credits and bounces.
                  </p>
                </div>
                <div>
                  <Label>Department</Label>
                  <MultiSelectDropdown
                    options={DEPARTMENTS}
                    selected={form.filters.person_department_or_subdepartments ?? []}
                    onChange={(v) => setFilter('person_department_or_subdepartments', v)}
                    placeholder="Any department"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Company revenue (min)</Label>
                  <Input
                    type="number" min={0} placeholder="no minimum"
                    value={form.filters.revenue_range?.min ?? ''}
                    onChange={(e) => setFilter('revenue_range', {
                      ...form.filters.revenue_range,
                      min: e.target.value ? Number(e.target.value) : undefined,
                    })}
                  />
                </div>
                <div>
                  <Label>Company revenue (max)</Label>
                  <Input
                    type="number" min={0} placeholder="no maximum"
                    value={form.filters.revenue_range?.max ?? ''}
                    onChange={(e) => setFilter('revenue_range', {
                      ...form.filters.revenue_range,
                      max: e.target.value ? Number(e.target.value) : undefined,
                    })}
                  />
                </div>
              </div>

              <div>
                <Label>Company domains</Label>
                <TagInput
                  value={form.filters.q_organization_domains_list ?? []}
                  onChange={(v) => setFilter('q_organization_domains_list', v)}
                  placeholder="acme.com — Enter to add"
                />
              </div>

              {!hasFilter && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  At least one filter is required — {getAudienceSource(form.source).label}
                  {' '}refuses an unfiltered search.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={save}
              disabled={!form.name || !hasFilter || createAudience.isPending || updateAudience.isPending}
            >
              {(createAudience.isPending || updateAudience.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editing ? 'Save changes' : 'Create audience'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AudiencePreviewDialog
        audience={previewing}
        open={!!previewing}
        onOpenChange={(v) => { if (!v) setPreviewing(null); }}
      />
    </div>
  );
}
