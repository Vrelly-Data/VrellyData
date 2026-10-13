import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BreakdownItem, SignalBreakdown } from '@/lib/signals';

export type BreakdownKey = 'industry' | 'seniority' | 'title' | 'state' | 'country' | 'company_size' | 'platform' | 'campaign';

const DIMENSIONS: Array<{ key: BreakdownKey; label: string; adminOnly?: boolean }> = [
  { key: 'industry', label: 'Industry' },
  { key: 'seniority', label: 'Seniority' },
  { key: 'title', label: 'Title' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'company_size', label: 'Company size' },
  { key: 'platform', label: 'Platform', adminOnly: true },
  { key: 'campaign', label: 'Campaign', adminOnly: true },
];

const UNKNOWN = '(unknown)';

function display(key: BreakdownKey, v: string): string {
  if (v === UNKNOWN) return 'Unknown';
  if (key === 'seniority') return v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  if (key === 'title') return v.replace(/\b\w/g, (c) => c.toUpperCase());
  return v;
}

/**
 * Who the signals in view are: counts by industry, seniority, title, state,
 * country and company size (admins also by platform and campaign), from
 * signals_breakdown over the same filters as the table. Click a row to filter
 * the table to it; click again to clear.
 */
export function BreakdownPanel({
  data, loading, selected, onPick, admin,
}: {
  data: SignalBreakdown | null;
  loading: boolean;
  selected: Partial<Record<BreakdownKey, string>>;
  onPick: (key: BreakdownKey, value: string) => void;
  admin: boolean;
}) {
  const dims = DIMENSIONS.filter((d) => admin || !d.adminOnly);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          Breakdown
          <span className="text-xs font-normal text-muted-foreground">
            {loading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : `${(data?.total ?? 0).toLocaleString()} signals · click to filter`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
          {dims.map((d) => (
            <Dimension
              key={d.key}
              label={d.label}
              items={(data?.[d.key] as BreakdownItem[] | undefined) ?? []}
              selected={selected[d.key]}
              render={(v) => display(d.key, v)}
              onPick={(v) => onPick(d.key, v)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Dimension({
  label, items, selected, render, onPick,
}: {
  label: string;
  items: BreakdownItem[];
  selected?: string;
  render: (v: string) => string;
  onPick: (v: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground mb-1.5">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-0.5">
          {items.slice(0, 8).map((i) => {
            const on = selected === i.value;
            return (
              <li key={i.value}>
                <button
                  type="button"
                  onClick={() => onPick(i.value)}
                  aria-pressed={on}
                  title={`${render(i.value)}: ${i.count.toLocaleString()}`}
                  className={cn(
                    'group w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted',
                    on && 'bg-muted ring-1 ring-primary',
                  )}
                >
                  <span className="relative min-w-0">
                    <span
                      className={cn('absolute inset-y-0 left-0 rounded-sm bg-primary/15', on && 'bg-primary/30')}
                      style={{ width: `${(i.count / max) * 100}%` }}
                      aria-hidden
                    />
                    <span className={cn('relative block truncate pl-1', i.value === UNKNOWN && 'italic text-muted-foreground')}>
                      {render(i.value)}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">{i.count.toLocaleString()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
