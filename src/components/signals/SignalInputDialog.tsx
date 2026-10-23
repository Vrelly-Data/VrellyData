import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { format } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TagInput } from '@/components/ui/tag-input';
import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';
import { useToast } from '@/hooks/use-toast';
import { COUNTRY_OPTIONS } from '@/lib/signalCatalog';
import {
  COMPANY_SIZE_OPTIONS, defaultFilters, FAMILY_INFO, FDA_SPECIALTIES, type GithubFilters, type HiringFilters, type HiringLocation,
  type InputFamily, type InputFilters, type InputPreview, locationLabel, MEDICAL_SOURCE_OPTIONS, type MedicalFilters, type SignalInput,
  US_STATE_NAMES,
} from '@/lib/signalInputs';
import { usePreviewSignalInput, useSaveSignalInput } from '@/hooks/useSignalInputs';

const DAY_OPTIONS = [7, 14, 30, 60, 90];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DaysSelect({ value, onChange, max = 90, label }: { value: number; onChange: (n: number) => void; max?: number; label: string }) {
  const opts = [...new Set([...DAY_OPTIONS.filter((d) => d <= max), ...(max > 90 ? [180, 365] : []), value])].sort((a, b) => a - b);
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="h-9 w-40" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{opts.map((d) => <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>)}</SelectContent>
    </Select>
  );
}

function LocationsEditor({ value, onChange }: { value: HiringLocation[]; onChange: (v: HiringLocation[]) => void }) {
  const [country, setCountry] = useState('US');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const countryLabel = COUNTRY_OPTIONS.find((c) => c.code === country)?.label ?? country;
  const add = () => {
    const loc: HiringLocation = { country: countryLabel, state: country === 'US' && state ? state : null, city: city.trim() || null };
    if (value.some((v) => locationLabel(v) === locationLabel(loc))) return;
    onChange([...value, loc]);
    setState('');
    setCity('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Select value={country} onValueChange={(v) => { setCountry(v); setState(''); }}>
          <SelectTrigger className="h-9 w-44" aria-label="Country"><SelectValue /></SelectTrigger>
          <SelectContent>{COUNTRY_OPTIONS.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
        {country === 'US' && (
          <Select value={state || 'any'} onValueChange={(v) => setState(v === 'any' ? '' : v)}>
            <SelectTrigger className="h-9 w-44" aria-label="State"><SelectValue placeholder="Any state" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="any">Any state</SelectItem>
              {US_STATE_NAMES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Input className="h-9 w-40" placeholder="City (optional)" value={city} onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1" onClick={add}><Plus className="h-3.5 w-3.5" /> Add</Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((l) => (
            <Badge key={locationLabel(l)} variant="secondary" className="gap-1 pr-1">
              {locationLabel(l)}
              <button type="button" aria-label={`Remove ${locationLabel(l)}`} onClick={() => onChange(value.filter((x) => x !== l))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function HiringForm({ f, set }: { f: HiringFilters; set: (p: Partial<HiringFilters>) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Job titles" hint="Press Enter after each. CMO also matches Chief Marketing Officer.">
        <TagInput value={f.job_titles} onChange={(v) => set({ job_titles: v })} placeholder="e.g. CMO, VP Marketing" maxTags={10} />
      </Field>
      <Field label="Job locations" hint="Where the role is based (not the company headquarters). Leave empty for anywhere.">
        <LocationsEditor value={f.locations} onChange={(v) => set({ locations: v })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Industries" hint="Keywords matched against the company's industry tags.">
          <TagInput value={f.industries} onChange={(v) => set({ industries: v })} placeholder="e.g. software, medical devices" maxTags={10} />
        </Field>
        <Field label="Company size (employees)">
          <MultiSelectDropdown options={COMPANY_SIZE_OPTIONS} selected={f.company_sizes} onChange={(v) => set({ company_sizes: v })} placeholder="Any size" />
        </Field>
      </div>
      <Field label="Posted within">
        <DaysSelect value={f.posted_within_days} onChange={(n) => set({ posted_within_days: n })} label="Posted within" />
      </Field>
    </div>
  );
}

function GithubForm({ f, set }: { f: GithubFilters; set: (p: Partial<GithubFilters>) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Keywords" hint="Matched in repository names, descriptions and READMEs. Any keyword can match.">
        <TagInput value={f.keywords} onChange={(v) => set({ keywords: v })} placeholder="e.g. clinical trial, EDC" maxTags={5} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Topics" hint="GitHub topics, e.g. clinical-trials.">
          <TagInput value={f.topics} onChange={(v) => set({ topics: v })} placeholder="e.g. healthcare" maxTags={5} />
        </Field>
        <Field label="Organizations" hint="GitHub org logins to watch.">
          <TagInput value={f.orgs} onChange={(v) => set({ orgs: v })} placeholder="e.g. medidata" maxTags={10} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Minimum stars">
          <Input type="number" min={0} className="h-9 w-28" value={f.min_stars}
            onChange={(e) => set({ min_stars: Math.max(0, Number(e.target.value) || 0) })} />
        </Field>
        <Field label="Activity">
          <Select value={f.activity} onValueChange={(v) => set({ activity: v as GithubFilters['activity'] })}>
            <SelectTrigger className="h-9 w-40" aria-label="Activity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created">New repositories</SelectItem>
              <SelectItem value="pushed">Recent commits</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Within">
          <DaysSelect value={f.within_days} onChange={(n) => set({ within_days: n })} max={365} label="Within" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={f.owner === 'org'} onCheckedChange={(c) => set({ owner: c ? 'org' : 'any' })} />
        Only repositories owned by organizations (skip personal accounts)
      </label>
    </div>
  );
}

function MedicalForm({ f, set }: { f: MedicalFilters; set: (p: Partial<MedicalFilters>) => void }) {
  const toggle = (s: MedicalFilters['sources'][number], on: boolean) =>
    set({ sources: on ? [...new Set([...f.sources, s])] : f.sources.filter((x) => x !== s) });
  return (
    <div className="space-y-4">
      <Field label="Sources">
        <div className="grid gap-2 sm:grid-cols-2">
          {MEDICAL_SOURCE_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <Checkbox className="mt-0.5" checked={f.sources.includes(o.value)} onCheckedChange={(c) => toggle(o.value, !!c)} />
              <span>{o.label}<span className="block text-[11px] text-muted-foreground">{o.hint}</span></span>
            </label>
          ))}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Specialty (FDA review panel)">
          <MultiSelectDropdown options={FDA_SPECIALTIES} selected={f.specialties} onChange={(v) => set({ specialties: v })} placeholder="Any specialty" />
        </Field>
        <Field label="Product codes" hint="3-letter FDA product codes, e.g. HRS.">
          <TagInput value={f.product_codes} onChange={(v) => set({ product_codes: v.map((x) => x.toUpperCase()) })} placeholder="e.g. HRS, MNI" maxTags={20} />
        </Field>
        <Field label="Device keywords">
          <TagInput value={f.device_keywords} onChange={(v) => set({ device_keywords: v })} placeholder="e.g. knee, spinal" maxTags={10} />
        </Field>
        <Field label="Companies">
          <TagInput value={f.companies} onChange={(v) => set({ companies: v })} placeholder="e.g. Stryker" maxTags={10} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <Field label="Within">
          <DaysSelect value={f.within_days} onChange={(n) => set({ within_days: n })} max={365} label="Within" />
        </Field>
        {f.sources.includes('clinical_trials') && (
          <label className="flex items-center gap-2 text-sm pb-2">
            <Checkbox checked={f.industry_sponsors_only} onCheckedChange={(c) => set({ industry_sponsors_only: !!c })} />
            Trials: company sponsors only
          </label>
        )}
      </div>
    </div>
  );
}

export function PreviewPanel({ preview, loading, onRefresh, family, error }: {
  preview: InputPreview | undefined; loading: boolean; onRefresh: () => void; family: InputFamily; error: string | null;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Preview</span>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : preview?.count != null && (
          <Badge variant="secondary" className="tabular-nums">{preview.count.toLocaleString()} matching now</Badge>
        )}
        {preview?.apollo_credits ? <span className="text-[11px] text-muted-foreground">used {preview.apollo_credits} Apollo credit</span> : null}
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={onRefresh} disabled={loading}>
          <RefreshCw className="h-3 w-3" /> {family === 'hiring' ? 'Check count (1 credit)' : 'Refresh'}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {preview?.missing && <p className="text-xs text-muted-foreground">To preview: {preview.missing}.</p>}
      {preview?.error && <p className="text-xs text-amber-600 dark:text-amber-400">{preview.error}</p>}
      {preview && Object.keys(preview.by_source ?? {}).length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          {Object.entries(preview.by_source).map(([k, v]) => `${MEDICAL_SOURCE_OPTIONS.find((o) => o.value === k)?.label ?? k}: ${Number(v).toLocaleString()}`).join(' · ')}
        </p>
      )}
      {(preview?.sample ?? []).length > 0 && (
        <ul className="space-y-1">
          {preview!.sample.map((s, i) => (
            <li key={i} className="text-xs flex items-start gap-2">
              <span className="text-muted-foreground tabular-nums w-16 shrink-0">{s.occurred_at ? format(new Date(s.occurred_at), 'MMM d') : '—'}</span>
              <span className="min-w-0 flex-1 truncate" title={s.title}>{s.title}</span>
              {s.detail && <span className="text-muted-foreground shrink-0">{s.detail}</span>}
              {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Open"><ExternalLink className="h-3 w-3" /></a>}
            </li>
          ))}
        </ul>
      )}
      {preview && preview.count === 0 && !preview.missing && <p className="text-xs text-muted-foreground">Nothing matches right now — try a wider window or fewer filters.</p>}
    </div>
  );
}

/** Create or edit one Signal Input. */
export function SignalInputDialog({ open, onOpenChange, family, existing, teamId, isAdmin, teams }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  family: InputFamily;
  existing?: SignalInput | null;
  teamId: string | null;
  isAdmin: boolean;
  teams?: Array<{ team_id: string; name: string }>;
}) {
  const { toast } = useToast();
  const save = useSaveSignalInput();
  const preview = usePreviewSignalInput();
  const [name, setName] = useState('');
  const [filters, setFilters] = useState<InputFilters>(defaultFilters(family));
  const [allClients, setAllClients] = useState(false);
  const [team, setTeam] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setFilters({ ...defaultFilters(family), ...(existing?.filters ?? {}) } as InputFilters);
    setAllClients(existing?.all_clients ?? false);
    setTeam(existing?.team_id ?? teamId ?? '');
    preview.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, family]);

  const set = (p: Partial<InputFilters>) => setFilters((f) => ({ ...f, ...p }) as InputFilters);
  const runPreview = () => preview.mutate({ family, filters, input_id: existing?.id });

  // Free sources preview as you type; hiring (Apollo credits) only on request.
  const key = useMemo(() => JSON.stringify(filters), [filters]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!open || family === 'hiring') return;
    clearTimeout(timer.current);
    timer.current = setTimeout(runPreview, 700);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open, family]);

  const submit = () =>
    save.mutate({
      id: existing?.id, team_id: team, source_key: family, name: name.trim(), filters,
      ...(isAdmin ? { all_clients: allClients } : {}),
    }, {
      onSuccess: () => { toast({ title: existing ? 'Signal Input saved' : 'Signal Input created', description: 'It runs daily; use Run now to fetch immediately.' }); onOpenChange(false); },
      onError: (e) => toast({ title: 'Could not save', description: (e as Error).message, variant: 'destructive' }),
    });

  const info = FAMILY_INFO[family];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit' : 'New'} Signal Input: {info.label}</DialogTitle>
          <DialogDescription>{info.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hiring CMO in California" maxLength={120} />
          </Field>
          {isAdmin && !existing && teams && teams.length > 0 && (
            <Field label="Team" hint="Signals from this input are visible to this team.">
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger className="h-9" aria-label="Team"><SelectValue placeholder="Choose a team" /></SelectTrigger>
                <SelectContent className="max-h-72">{teams.map((t) => <SelectItem key={t.team_id} value={t.team_id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {family === 'hiring' && <HiringForm f={filters as HiringFilters} set={set} />}
          {family === 'github' && <GithubForm f={filters as GithubFilters} set={set} />}
          {family === 'medical' && <MedicalForm f={filters as MedicalFilters} set={set} />}
          {info.costNote && <Alert><AlertDescription className="text-xs">{info.costNote}</AlertDescription></Alert>}
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={allClients} onCheckedChange={setAllClients} aria-label="Share with all clients" />
              Share signals from this input with all clients (admin only)
            </label>
          )}
          <PreviewPanel preview={preview.data} loading={preview.isPending} onRefresh={runPreview} family={family}
            error={preview.error ? (preview.error as Error).message : null} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || !team || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} {existing ? 'Save' : 'Create Signal Input'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
