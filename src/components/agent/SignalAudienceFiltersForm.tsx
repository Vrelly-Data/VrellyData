import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TagInput } from '@/components/ui/tag-input';
import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';
import { VRELLY_DEPARTMENT_OPTIONS, VRELLY_SENIORITY_OPTIONS } from '@/lib/vrellyAudienceFilters';
import { SIGNAL_VERTICAL_OPTIONS, type SignalAudienceFilters } from '@/lib/signalAudienceFilters';

/**
 * Filters for a Signals-source audience: WHICH signals (top), then WHO to reach
 * at each signal's company (persona). The server validates and compiles both
 * (supabase/functions/_shared/signal-audience.ts); a vertical the user may not
 * see simply yields no signals — visibility is enforced in SQL, not here.
 */
export function SignalAudienceFiltersForm(
  { value, onChange, isAdmin = false }:
  { value: SignalAudienceFilters; onChange: (v: SignalAudienceFilters) => void; isAdmin?: boolean },
) {
  const set = <K extends keyof SignalAudienceFilters>(k: K, v: SignalAudienceFilters[K]) => onChange({ ...value, [k]: v });
  const persona = value.persona ?? {};
  const setPersona = (k: keyof NonNullable<SignalAudienceFilters['persona']>, v: string[]) => set('persona', { ...persona, [k]: v });
  const verticals = value.verticals ?? [];
  const shows = (v: string) => verticals.length === 0 || verticals.includes(v);
  const num = (s: string, def: number) => (s.trim() === '' ? def : Number(s));

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <p className="text-sm font-medium">Which signals</p>
        <div>
          <Label>Signal types</Label>
          <MultiSelectDropdown
            options={SIGNAL_VERTICAL_OPTIONS.filter((o) => isAdmin || o.value !== 'private_equity')}
            selected={verticals}
            onChange={(v) => set('verticals', v)}
            placeholder="All signals you can see"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Signals from the last (days)</Label>
            <Input type="number" min={1} max={365} value={value.recency_days ?? 30}
              onChange={(e) => set('recency_days', num(e.target.value, 30))} />
          </div>
          <div>
            <Label>Minimum score</Label>
            <Input type="number" min={0} max={100} value={value.min_score ?? 0}
              onChange={(e) => set('min_score', num(e.target.value, 0))} />
          </div>
        </div>

        {shows('medical_device') && (
          <div className="rounded-md border p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">510(k) clearances</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Product codes</Label>
                <TagInput value={value.fda?.product_codes ?? []} placeholder="LLZ, QAS"
                  onChange={(v) => set('fda', { ...value.fda, product_codes: v })} />
              </div>
              <div>
                <Label>Applicant state</Label>
                <TagInput value={value.fda?.states ?? []} placeholder="CA or California"
                  onChange={(v) => set('fda', { ...value.fda, states: v })} />
              </div>
            </div>
            <div>
              <Label>Device keywords</Label>
              <TagInput value={value.fda?.device_keywords ?? []} placeholder="catheter, implant — whole words"
                onChange={(v) => set('fda', { ...value.fda, device_keywords: v })} />
            </div>
          </div>
        )}
        {shows('saas_hiring') && (
          <div className="rounded-md border p-3">
            <Label>Hiring: role keywords</Label>
            <TagInput value={value.hiring?.role_keywords ?? []} placeholder="SDR, Account Executive — whole words"
              onChange={(v) => set('hiring', { role_keywords: v })} />
          </div>
        )}
        {shows('github') && (
          <div className="rounded-md border p-3">
            <Label>GitHub: repo topics</Label>
            <TagInput value={value.github?.topics ?? []} placeholder="kubernetes, llm"
              onChange={(v) => set('github', { topics: v })} />
          </div>
        )}
      </section>

      <section className="space-y-3 border-t pt-4">
        <div>
          <p className="text-sm font-medium">Who to reach at each company</p>
          <p className="text-xs text-muted-foreground">
            Titles match whole words: &ldquo;President&rdquo; also matches &ldquo;Vice President&rdquo;; exclude what you don&rsquo;t want.
          </p>
        </div>
        <div>
          <Label>Job titles</Label>
          <TagInput value={persona.job_titles ?? []} placeholder="CEO, VP Regulatory — Enter to add"
            onChange={(v) => setPersona('job_titles', v)} />
        </div>
        <div>
          <Label>Exclude job titles</Label>
          <TagInput value={persona.exclude_job_titles ?? []} placeholder="Assistant, Intern"
            onChange={(v) => setPersona('exclude_job_titles', v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Seniority</Label>
            <MultiSelectDropdown options={VRELLY_SENIORITY_OPTIONS} selected={persona.seniorities ?? []}
              onChange={(v) => setPersona('seniorities', v)} placeholder="Any seniority" />
          </div>
          <div>
            <Label>Department</Label>
            <MultiSelectDropdown options={VRELLY_DEPARTMENT_OPTIONS} selected={persona.departments ?? []}
              onChange={(v) => setPersona('departments', v)} placeholder="Any department" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <Label>Max people per company</Label>
            <Input type="number" min={1} max={10} value={value.max_per_company ?? 2}
              onChange={(e) => set('max_per_company', num(e.target.value, 2))} />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={value.use_apollo === true} onCheckedChange={(v) => set('use_apollo', v)} />
              Apollo fallback (paid, off by default)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={value.us_only !== false} onCheckedChange={(v) => set('us_only', v)} />
              US contacts only
            </label>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Vrelly database first (free), then the person named on the signal. With the Apollo fallback on, Apollo is used
          only for companies where nobody was found, needs a job title or seniority, and counts against your monthly
          Apollo credit cap.
        </p>
      </section>
    </div>
  );
}
