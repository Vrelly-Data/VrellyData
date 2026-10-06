import { Progress } from '@/components/ui/progress';
import { ChannelHealth, HEALTH_FIELDS, HealthField } from '@/hooks/useInferenceInsights';

const FIELD_LABELS: Record<HealthField, string> = {
  job_title: 'Job title',
  industry: 'Industry',
  company_size: 'Company size',
  city: 'City',
  campaign: 'Campaign',
  step: 'Sequence step',
};

const CHANNEL_LABELS = { email: 'Email', linkedin: 'LinkedIn' } as const;

function pctOf(n: number, total: number): number {
  return total > 0 ? (n / total) * 100 : 0;
}

// Health gauge of the moat: share of live replied / interested events that carry each field as
// written at capture; "with people" adds firmographics the enriched view joins from public.people.
export function DataCoverageCard({ data }: { data: ChannelHealth[] }) {
  return (
    <div className="space-y-4">
      {data.map((row) => (
        <div key={row.channel}>
          <p className="text-sm font-medium mb-2">
            {CHANNEL_LABELS[row.channel]}{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {row.total.toLocaleString()} replied + interested events
            </span>
          </p>
          {row.total === 0 ? (
            <p className="text-xs text-muted-foreground">No live events captured yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {HEALTH_FIELDS.map((field) => {
                const { captured, withPeople } = row.fields[field];
                const capturedPct = pctOf(captured, row.total);
                return (
                  <div key={field} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{FIELD_LABELS[field]}</p>
                    <p className="text-xl font-semibold mt-1">{capturedPct.toFixed(0)}%</p>
                    <Progress value={capturedPct} className="h-1.5 mt-2" />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {captured.toLocaleString()} of {row.total.toLocaleString()}
                      {withPeople !== null && ` · ${pctOf(withPeople, row.total).toFixed(0)}% with people`}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
