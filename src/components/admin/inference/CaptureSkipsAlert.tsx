import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useCaptureSkipAlerts } from '@/hooks/useInferenceInsights';

const PLATFORM_LABELS: Record<string, string> = { 'reply.io': 'Reply.io', smartlead: 'Smartlead', heyreach: 'HeyReach' };

// One alert row per team + integration that had replies skipped by Capture
// Scope in the last 24h. Renders nothing when there are none, or when the
// alert function is unavailable (it is admin-only and ships with migration
// 20261007210000).
export function CaptureSkipsAlert() {
  const { data, error } = useCaptureSkipAlerts(24);
  if (error || !data || data.length === 0) return null;
  const total = data.reduce((n, a) => n + a.skipped, 0);

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2" role="alert">
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        {total} repl{total === 1 ? 'y' : 'ies'} skipped by Capture Scope in the last 24h — campaign not capturing
      </p>
      <ul className="space-y-1">
        {data.map((a) => (
          <li key={`${a.team_id}:${a.integration_id}`} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{a.team_name ?? a.team_id}</span>
            {' · '}
            {a.integration_name ?? a.integration_id} ({PLATFORM_LABELS[a.platform] ?? a.platform})
            {': '}
            {a.skipped} repl{a.skipped === 1 ? 'y' : 'ies'} across {a.campaigns} campaign{a.campaigns === 1 ? '' : 's'}
            {a.last_detected_at && <> · detected {formatDistanceToNow(new Date(a.last_detected_at), { addSuffix: true })}</>}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Fix in the team's Playground → Capture Scope: the campaign shows a "replies skipped" badge with Enable &amp; recapture.
      </p>
    </div>
  );
}
