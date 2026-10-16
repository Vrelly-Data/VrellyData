import { useState } from 'react';
import {
  Activity, Building2, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Github, Globe, Loader2, Pencil, Play, Plus, ShieldAlert,
  Stethoscope, Trash2,
} from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { pixelSnippet } from '@/lib/signals';
import { signalTypeLabel } from '@/lib/signalCatalog';
import {
  FAMILY_INFO, filterSummary, type InputFamily, lastRunTotals, type SignalInput, VISITOR_PRIVACY_NOTICE,
} from '@/lib/signalInputs';
import {
  useDeleteSignalInput, useRunSignalInput, useSignalInputResults, useSignalInputs, useSiteStatus, useToggleSignalInput,
} from '@/hooks/useSignalInputs';
import { useRegisterSite, useSignalSettings, useTeamSignalSettings } from '@/hooks/useSignals';
import { SignalInputDialog } from './SignalInputDialog';

const FAMILY_ICON: Record<InputFamily, typeof Activity> = { hiring: Building2, github: Github, medical: Stethoscope };
const WRITER_LABEL: Record<string, string> = {
  input_hiring: 'Hiring', input_github: 'GitHub', input_fda_clearance: 'FDA clearances', input_fda_recall: 'Recalls',
  input_fda_registration: 'Listings', input_clinical_trial: 'Trials',
};

function StatusBadge({ status }: { status: SignalInput['last_run_status'] }) {
  if (!status) return <Badge variant="outline" className="text-[10px]">not run yet</Badge>;
  const tone = status === 'success' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
    : status === 'partial' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    : status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' : '';
  return <Badge variant="secondary" className={cn('text-[10px]', tone)}>{status}</Badge>;
}

function InputResults({ inputId }: { inputId: string }) {
  const res = useSignalInputResults(inputId);
  if (res.isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading results…</div>;
  if (res.error) return <p className="text-xs text-destructive">{(res.error as Error).message}</p>;
  const rows = res.data?.rows ?? [];
  if (!rows.length) return <p className="text-xs text-muted-foreground">No signals from this input yet. Use Run now, or wait for the daily run.</p>;
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{res.data!.total.toLocaleString()} signals in total · {res.data!.d7.toLocaleString()} new in the last 7 days</p>
      <ul className="divide-y rounded-md border">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-3 py-2 text-xs">
            <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{format(new Date(r.occurred_at), 'MMM d')}</span>
            <Badge variant="outline" className="shrink-0 text-[10px]">{signalTypeLabel(r.type)}</Badge>
            <span className="min-w-0 flex-1">{r.title}</span>
            {r.url && <a href={r.url} target="_blank" rel="noreferrer" aria-label="Open source" className="shrink-0 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" /></a>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InputCard({ input, onEdit, teamName, isAdmin }: { input: SignalInput; onEdit: () => void; teamName?: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const run = useRunSignalInput();
  const toggle = useToggleSignalInput();
  const del = useDeleteSignalInput();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const Icon = FAMILY_ICON[input.source_key];
  const totals = lastRunTotals(input);

  const runNow = () => run.mutate(input.id, {
    onSuccess: (d) => {
      const ins = d.results.reduce((a, r) => a + (r.inserted ?? 0), 0);
      const errs = d.results.filter((r) => r.error).map((r) => r.error);
      toast({ title: `Run finished: ${ins} new signal${ins === 1 ? '' : 's'}`, description: errs.join('; ') || undefined, variant: errs.length ? 'destructive' : undefined });
      setOpen(true);
    },
    onError: (e) => toast({ title: 'Run failed', description: (e as Error).message, variant: 'destructive' }),
  });

  return (
    <Card className={cn(!input.is_active && 'opacity-70')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="rounded-md bg-muted p-2"><Icon className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{input.name}</span>
              <Badge variant="outline" className="text-[10px]">{FAMILY_INFO[input.source_key].label}</Badge>
              {input.all_clients && <Badge className="text-[10px]">all clients</Badge>}
              {isAdmin && teamName && <Badge variant="secondary" className="text-[10px]">{teamName}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{filterSummary(input.source_key, input.filters)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch checked={input.is_active} aria-label="Active" onCheckedChange={(v) => toggle.mutate({ id: input.id, patch: { is_active: v } })} />
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={runNow} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run now
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete" onClick={() => setConfirm(true)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">Preview (matching now)</div>
            <div className="text-base font-semibold tabular-nums">{input.preview_count != null ? input.preview_count.toLocaleString() : '—'}</div>
            {input.preview_at && <div className="text-[11px] text-muted-foreground">checked {formatDistanceToNowStrict(new Date(input.preview_at))} ago</div>}
          </div>
          <div className="rounded-md border p-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">Last run <StatusBadge status={input.last_run_status} /></div>
            <div className="text-base font-semibold tabular-nums">{input.last_run_at ? `${totals.matched.toLocaleString()} found` : '—'}</div>
            {input.last_run_at && (
              <div className="text-[11px] text-muted-foreground">
                {formatDistanceToNowStrict(new Date(input.last_run_at))} ago{totals.credits ? ` · ${totals.credits} Apollo credits` : ''}
              </div>
            )}
          </div>
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">By source</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(input.last_run ?? {}).length === 0 && <span className="text-muted-foreground">—</span>}
              {Object.entries(input.last_run ?? {}).map(([w, r]) => (
                <Badge key={w} variant="outline" className="text-[10px] tabular-nums" title={r.error ?? undefined}>
                  {WRITER_LABEL[w] ?? w}: {Number(r.matched ?? 0).toLocaleString()}{r.status === 'failed' ? ' ⚠' : ''}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        {totals.errors.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{totals.errors[0]}</p>}

        <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Signals from this input
        </button>
        {open && <InputResults inputId={input.id} />}
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{input.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The input stops running. Signals it already found stay in your Signals tabs.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate(input.id, {
              onError: (e) => toast({ title: 'Could not delete', description: (e as Error).message, variant: 'destructive' }),
            })}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function WebsiteVisitorsInput({ isAdmin, teamNames }: { isAdmin: boolean; teamNames: Record<string, string> }) {
  const { toast } = useToast();
  const sites = useSiteStatus();
  const register = useRegisterSite();
  const [domain, setDomain] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ title: 'Copy failed — select the text and copy it manually', variant: 'destructive' });
    }
  };
  const add = () => register.mutate({ domain, teamId: null }, {
    onSuccess: (s) => { toast({ title: `Site added: ${s.domain}`, description: 'Copy the snippet below onto your site.' }); setDomain(''); },
    onError: (e) => toast({ title: 'Could not add site', description: (e as Error).message, variant: 'destructive' }),
  });
  // signals_site_status returns only what the caller may see (own team; admins every team).
  const mine = sites.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" /> Website visitors</CardTitle>
        <p className="text-xs text-muted-foreground">
          Add your site to get a snippet. Each visitor becomes a Website visit signal (one per visitor per day) that only your team sees.
          Identifying which company is visiting is not switched on yet.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input className="h-9 w-72" placeholder="yourcompany.com" value={domain} onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && domain.trim()) add(); }} aria-label="Your site's domain" />
          <Button size="sm" className="h-9 gap-1" disabled={!domain.trim() || register.isPending} onClick={add}><Plus className="h-3.5 w-3.5" /> Add your site</Button>
        </div>

        {mine.length === 0 && !sites.isLoading && <p className="text-sm text-muted-foreground">No site yet.</p>}
        {mine.map((s) => {
          const snippet = pixelSnippet(s.site_key);
          const live = s.last_hit_at && Date.now() - Date.parse(s.last_hit_at) < 7 * 86_400_000;
          return (
            <div key={s.site_key} className="rounded-md border p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{s.domain}</span>
                {isAdmin && <Badge variant="outline" className="text-[10px]">{teamNames[s.team_id] ?? s.team_id}</Badge>}
                {!s.is_active && <Badge variant="outline" className="text-[10px]">paused</Badge>}
                <span className={cn('flex items-center gap-1 text-xs', live ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                  <span className={cn('h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                  {s.last_hit_at ? `Last hit received ${formatDistanceToNowStrict(new Date(s.last_hit_at))} ago · ${Number(s.hits_7d).toLocaleString()} in 7 days` : 'No hits received yet'}
                </span>
                <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" onClick={() => copy(s.site_key, snippet)}>
                  {copied === s.site_key ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy snippet
                </Button>
              </div>
              <pre className="text-[11px] bg-muted rounded p-2 overflow-x-auto whitespace-pre">{snippet}</pre>
              <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-0.5">
                <li>Paste the snippet just before <code>&lt;/head&gt;</code> on every page (or add it as a Custom HTML tag in Google Tag Manager, firing on All Pages).</li>
                <li>Publish, then open any page of {s.domain} in a browser.</li>
                <li>Come back here: “Last hit received” updates within a minute when it works.</li>
              </ol>
            </div>
          );
        })}

        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle className="text-sm">Add this to your privacy policy</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-xs">
              The snippet stores a random visitor id in the browser and sends the page address, referrer and browser type to Vrelly; IP addresses are
              hashed and never stored. Where required (for example for EU/UK visitors) also show a cookie/consent banner. Suggested wording — not legal advice:
            </p>
            <blockquote className="border-l-2 pl-3 text-xs italic">{VISITOR_PRIVACY_NOTICE}</blockquote>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => copy('privacy', VISITOR_PRIVACY_NOTICE)}>
              {copied === 'privacy' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy privacy text
            </Button>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

/** Signals → "Signal Inputs": the team's own inputs (admins: every team's). */
export function SignalInputsPanel({ mode }: { mode: 'admin' | 'client' }) {
  const settings = useSignalSettings();
  const isAdmin = mode === 'admin';
  const inputs = useSignalInputs();
  const teams = useTeamSignalSettings(isAdmin);
  const teamNames = Object.fromEntries((teams.data ?? []).map((t) => [t.team_id, t.name]));
  const [dialog, setDialog] = useState<{ family: InputFamily; existing?: SignalInput | null } | null>(null);
  const teamId = settings.data?.team_id ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Signal Inputs</h3>
          <p className="text-sm text-muted-foreground">
            Tell Vrelly what to watch for. Each Signal Input runs daily and adds what it finds to your Signals tabs; only your team sees them.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-1" disabled={!isAdmin && !teamId}><Plus className="h-4 w-4" /> New Signal Input</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {(Object.keys(FAMILY_INFO) as InputFamily[]).map((f) => {
              const Icon = FAMILY_ICON[f];
              return (
                <DropdownMenuItem key={f} className="items-start gap-2 py-2" onSelect={() => setDialog({ family: f })}>
                  <Icon className="h-4 w-4 mt-0.5" />
                  <span><span className="font-medium">{FAMILY_INFO[f].label}</span><span className="block text-xs text-muted-foreground">{FAMILY_INFO[f].description}</span></span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {inputs.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Signal Inputs…</div>
      ) : inputs.error ? (
        <p className="text-sm text-destructive">Could not load Signal Inputs: {(inputs.error as Error).message}</p>
      ) : (inputs.data ?? []).length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No Signal Inputs yet. Create one for hiring, GitHub or medical/FDA activity.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {(inputs.data ?? []).map((i) => (
            <InputCard key={i.id} input={i} isAdmin={isAdmin} teamName={teamNames[i.team_id]} onEdit={() => setDialog({ family: i.source_key, existing: i })} />
          ))}
        </div>
      )}

      <WebsiteVisitorsInput isAdmin={isAdmin} teamNames={teamNames} />

      {dialog && (
        <SignalInputDialog
          open={!!dialog}
          onOpenChange={(o) => { if (!o) setDialog(null); }}
          family={dialog.family}
          existing={dialog.existing}
          teamId={teamId}
          isAdmin={isAdmin}
          teams={(teams.data ?? []).map((t) => ({ team_id: t.team_id, name: t.name }))}
        />
      )}
    </div>
  );
}
