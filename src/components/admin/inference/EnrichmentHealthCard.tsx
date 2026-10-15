import { Loader2, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EnrichmentGroup, useEnrichmentHealth } from '@/hooks/useInferenceInsights';

const FIELDS: Array<{ key: keyof EnrichmentGroup; label: string }> = [
  { key: 'step', label: 'Step' },
  { key: 'industry', label: 'Industry' },
  { key: 'size', label: 'Size' },
  { key: 'title', label: 'Title' },
  { key: 'state', label: 'State' },
  { key: 'timezone', label: 'Time zone' },
];
const GROUP_LABEL: Record<EnrichmentGroup['grp'], string> = {
  interested: 'Interested',
  other: 'Other',
  not_interested: 'Not interested',
};

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

function Stat({ title, value, footnote }: { title: string; value: React.ReactNode; footnote: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{footnote}</p>
    </div>
  );
}

// Admin: is enrich-inference-events keeping up? Last 7 days of live replies.
export function EnrichmentHealthCard() {
  const { data: h, error, isLoading } = useEnrichmentHealth();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Enrichment health
          <span className="text-xs font-normal text-muted-foreground">live replies, last 7 days</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">Failed to load enrichment health: {(error as Error).message}</p>
        ) : isLoading || !h ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat
                title="Replies enriched"
                value={pct(h.enriched, h.replies)}
                footnote={`${h.enriched.toLocaleString()} of ${h.replies.toLocaleString()} replies`}
              />
              <Stat
                title="Still waiting"
                value={h.waiting.toLocaleString()}
                footnote={h.failed ? `last 30 days · ${h.failed.toLocaleString()} gave up after 5 tries` : 'last 30 days'}
              />
              <Stat title="Apollo credits today" value={h.apollo_credits_today.toLocaleString()} footnote="since 00:00 UTC" />
              <Stat
                title="Last run"
                value={h.last_run_at ? new Date(h.last_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                footnote={h.last_run_at ? new Date(h.last_run_at).toLocaleDateString() : 'not run yet'}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left font-normal py-1 pr-3">Fill rate</th>
                    <th className="text-right font-normal py-1 px-2">Replies</th>
                    {FIELDS.map((f) => (
                      <th key={f.key} className="text-right font-normal py-1 px-2">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {h.groups.map((g) => (
                    <tr key={g.grp} className="border-t">
                      <td className="py-1.5 pr-3">{GROUP_LABEL[g.grp]}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{g.n.toLocaleString()}</td>
                      {FIELDS.map((f) => (
                        <td key={f.key} className="py-1.5 px-2 text-right tabular-nums">
                          {pct(Number(g[f.key]), g.n)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
