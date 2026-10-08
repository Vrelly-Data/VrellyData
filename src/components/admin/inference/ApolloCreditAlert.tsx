import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useApolloCreditAlerts } from '@/hooks/useInferenceInsights';

const REASON_LABELS: Record<string, string> = {
  apollo_insufficient_credits: 'Apollo is out of credits',
  monthly_cap: 'monthly Apollo credit cap reached',
};

// One row per client + reason whose Agent Audience runs stopped early in the
// last 7 days. Out-of-credits is listed first: it stops EVERY client on the
// shared key, while a monthly cap only stops one. Renders nothing when there
// are none, or when the admin-only function is unavailable (it ships with
// migration 20261008150000).
export function ApolloCreditAlert() {
  const { data, error } = useApolloCreditAlerts(7);
  if (error || !data || data.length === 0) return null;
  const rows = [...data].sort((a, b) =>
    (a.reason === 'apollo_insufficient_credits' ? 0 : 1) - (b.reason === 'apollo_insufficient_credits' ? 0 : 1));
  const outOfCredits = rows.some((r) => r.reason === 'apollo_insufficient_credits');

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2" role="alert">
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        {outOfCredits
          ? 'Apollo is out of credits — Agent Audience runs on Apollo are stopping'
          : 'Agent Audience runs stopped at the monthly Apollo credit cap'}
      </p>
      <ul className="space-y-1">
        {rows.map((a) => (
          <li key={`${a.user_id}:${a.reason}`} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{a.user_name ?? a.user_id}</span>
            {' · '}{REASON_LABELS[a.reason] ?? a.reason}
            {' · '}{a.runs} run{a.runs === 1 ? '' : 's'} across {a.audiences} audience{a.audiences === 1 ? '' : 's'}
            {' · '}last {formatDistanceToNow(new Date(a.last_at), { addSuffix: true })}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Top up the shared Apollo account, raise the client's agent_configs.apollo_monthly_credit_cap, or switch the
        audience to the Vrelly database (no credits).
      </p>
    </div>
  );
}
