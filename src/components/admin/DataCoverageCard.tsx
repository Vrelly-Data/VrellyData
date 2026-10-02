import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Gauge } from 'lucide-react';
import { COVERAGE_FIELDS, CoverageField, useInferenceCoverage } from '@/hooks/useInferenceData';

const FIELD_LABELS: Record<CoverageField, string> = {
  job_title: 'Job title',
  industry: 'Industry',
  company_size: 'Company size',
  city: 'City',
  campaign: 'Campaign',
  sequence_step: 'Sequence step',
};

const CHANNEL_LABELS = { email: 'Email', linkedin: 'LinkedIn' } as const;

function pct(n: number, total: number): number {
  return total > 0 ? (n / total) * 100 : 0;
}

// Health gauge of the moat: how much segment context each replied / interested event carries.
// Headline % is what was written on the event at capture; "with people" adds the firmographics
// inference_events_enriched back-fills from public.people.
export function DataCoverageCard({ teamIds }: { teamIds?: string[] }) {
  const { data, isLoading, error } = useInferenceCoverage(teamIds);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Data coverage
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Share of replied + interested events that carry each field, as written at capture. "With people" includes
          firmographics joined from the people table.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">Failed to load data coverage: {(error as Error).message}</p>
        ) : isLoading || !data ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : (
          data.map((row) => (
            <div key={row.channel}>
              <p className="text-sm font-medium mb-2">
                {CHANNEL_LABELS[row.channel]}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  {row.total.toLocaleString()} replied + interested events
                </span>
              </p>
              {row.total === 0 ? (
                <p className="text-xs text-muted-foreground">No events captured yet.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  {COVERAGE_FIELDS.map((field) => {
                    const { captured, enriched } = row.fields[field];
                    const capturedPct = pct(captured, row.total);
                    return (
                      <Card key={field}>
                        <CardContent className="pt-6">
                          <p className="text-sm text-muted-foreground">{FIELD_LABELS[field]}</p>
                          <p className="text-2xl font-semibold mt-1">{capturedPct.toFixed(0)}%</p>
                          <Progress value={capturedPct} className="h-1.5 mt-2" />
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {captured.toLocaleString()} of {row.total.toLocaleString()}
                            {enriched !== null && ` · ${pct(enriched, row.total).toFixed(0)}% with people`}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
