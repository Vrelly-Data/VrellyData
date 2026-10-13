import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TagInput } from '@/components/ui/tag-input';
import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';
import { useToast } from '@/hooks/use-toast';
import { VRELLY_SENIORITY_OPTIONS } from '@/lib/vrellyAudienceFilters';
import { filtersFromSelection } from '@/lib/signalAudienceFilters';
import type { SignalRow } from '@/lib/signals';
import { useAgentAudiences, useCreateAudience, type AgentAudience } from '@/hooks/useAgentAudiences';
import { SignalsPreviewDialog } from '@/components/agent/SignalsPreviewDialog';

/**
 * Signals → "Build audience from these". The picked signals go either into an
 * existing Signals audience, or into a new one prefilled from them (their signal
 * types, a date window covering the oldest one) plus who to reach. Either way
 * the preview opens limited to exactly these signals — Vrelly first, Apollo
 * only where nobody was found — and nothing is pushed until it is confirmed.
 */
export function BuildAudienceDialog(
  { open, onOpenChange, signals }:
  { open: boolean; onOpenChange: (v: boolean) => void; signals: SignalRow[] },
) {
  const { toast } = useToast();
  const { data: audiences = [] } = useAgentAudiences();
  const createAudience = useCreateAudience();
  const signalAudiences = audiences.filter((a) => a.source === 'signals');

  const [tab, setTab] = useState<'existing' | 'new'>('new');
  const [existingId, setExistingId] = useState<string>('');
  const [name, setName] = useState('');
  const [titles, setTitles] = useState<string[]>(['CEO', 'Founder', 'President']);
  const [exclude, setExclude] = useState<string[]>(['Assistant', 'Vice President']);
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [perCompany, setPerCompany] = useState(2);
  const [previewing, setPreviewing] = useState<AgentAudience | null>(null);
  // Pinned when the preview opens: the caller's selection may change under it.
  const [previewIds, setPreviewIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTab(signalAudiences.length ? 'existing' : 'new');
    setExistingId(signalAudiences[0]?.id ?? '');
    setName(`Signals — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const go = async () => {
    setPreviewIds(signals.map((s) => s.id));
    try {
      if (tab === 'existing') {
        const a = signalAudiences.find((x) => x.id === existingId);
        if (!a) return;
        onOpenChange(false);
        setPreviewing(a);
        return;
      }
      const a = await createAudience.mutateAsync({
        name: name.trim(), source: 'signals', cadence: 'manual', max_per_run: 25, max_total: null,
        default_platform: null, default_synced_campaign_id: null,
        filters: {
          ...filtersFromSelection(signals),
          max_per_company: perCompany,
          persona: {
            ...(titles.length ? { job_titles: titles } : {}),
            ...(exclude.length ? { exclude_job_titles: exclude } : {}),
            ...(seniorities.length ? { seniorities } : {}),
          },
        },
      });
      toast({ title: 'Audience created', description: 'Edit its filters any time in Agent → Audience.' });
      onOpenChange(false);
      setPreviewing(a);
    } catch (e) {
      toast({ title: 'Could not create the audience', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const canGo = tab === 'existing' ? !!existingId : !!name.trim() && (titles.length > 0 || seniorities.length > 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Build audience from {signals.length} signal{signals.length === 1 ? '' : 's'}</DialogTitle>
            <DialogDescription>
              Find people at these companies and push them to a campaign. You&rsquo;ll see who was found, and the
              estimated Apollo credits, before anything is pushed.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'existing' | 'new')}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="new">New audience</TabsTrigger>
              <TabsTrigger value="existing" disabled={!signalAudiences.length}>Existing audience</TabsTrigger>
            </TabsList>
            <TabsContent value="new" className="space-y-3 pt-2">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>Who to reach — job titles</Label>
                <TagInput value={titles} onChange={setTitles} placeholder="CEO, VP Regulatory — Enter to add" />
              </div>
              <div>
                <Label>Exclude job titles</Label>
                <TagInput value={exclude} onChange={setExclude} placeholder="Assistant" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Seniority</Label>
                  <MultiSelectDropdown options={VRELLY_SENIORITY_OPTIONS} selected={seniorities} onChange={setSeniorities} placeholder="Any seniority" />
                </div>
                <div>
                  <Label>Max people per company</Label>
                  <Input type="number" min={1} max={10} value={perCompany} onChange={(e) => setPerCompany(Math.max(1, Math.min(10, Number(e.target.value) || 2)))} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Prefilled with these signals&rsquo; types and dates. Change anything later in Agent → Audience.
              </p>
            </TabsContent>
            <TabsContent value="existing" className="space-y-2 pt-2">
              <Label>Signals audience</Label>
              <Select value={existingId} onValueChange={setExistingId}>
                <SelectTrigger><SelectValue placeholder="Choose an audience" /></SelectTrigger>
                <SelectContent>
                  {signalAudiences.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Uses that audience&rsquo;s people filters on just these signals.
              </p>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => void go()} disabled={!canGo || createAudience.isPending}>
              {createAudience.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Find people
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignalsPreviewDialog
        audience={previewing}
        open={!!previewing}
        onOpenChange={(v) => { if (!v) setPreviewing(null); }}
        signalIds={previewIds}
      />
    </>
  );
}
