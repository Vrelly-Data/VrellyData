import { format, formatDistanceToNow } from 'date-fns';
import { Check, Linkedin, Mail, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmtHours } from '@/lib/inferenceAnalytics';
import { COMPLETENESS_FIELDS, COMPLETENESS_LABELS, LiveCard } from '@/lib/liveFeed';

function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent) return <Badge variant="outline" className="text-muted-foreground">unclassified</Badge>;
  const label = intent.replace(/_/g, ' ');
  if (intent === 'interested') return <Badge>{label}</Badge>;
  if (intent === 'not_interested') return <Badge variant="secondary">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{children}</span>;
}

export function LiveEventCard({ card }: { card: LiveCard }) {
  const at = new Date(card.occurredAt);
  const location = [card.city, card.state].filter(Boolean).join(', ');
  const chips = [card.industry, card.companySize && `${card.companySize} employees`, location, card.seniority].filter(
    Boolean,
  ) as string[];
  const copy = [card.campaign, card.step !== null ? `Step ${card.step}` : null, card.subject ?? (card.variant && `Variant ${card.variant.slice(0, 10)}`)]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground" title={format(at, 'PPpp')}>
            {formatDistanceToNow(at, { addSuffix: true })}
          </span>
          <Badge variant="outline" className="gap-1">
            {card.channel === 'linkedin' ? <Linkedin className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
            {card.channel}
          </Badge>
          <IntentBadge intent={card.intent} />
          {card.kind === 'classification' && (
            <span className="text-[11px] text-muted-foreground">classification (no reply event in view)</span>
          )}
          {card.hoursToReply !== null && (
            <span className="ml-auto text-muted-foreground">replied in {fmtHours(card.hoursToReply)}</span>
          )}
        </div>

        <p className="text-sm">
          <span className="font-medium">{card.name ?? 'Unknown person'}</span>
          {(card.title || card.company) && (
            <span className="text-muted-foreground">
              {' — '}
              {[card.title, card.company].filter(Boolean).join(' @ ')}
            </span>
          )}
        </p>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
        )}

        {copy && <p className="text-xs text-muted-foreground">{copy}</p>}

        {card.snippet && (
          <p className="text-sm border-l-2 pl-3 text-muted-foreground line-clamp-2">“{card.snippet.slice(0, 280)}”</p>
        )}

        {/* Data completeness: which segment fields capture delivered for this reply */}
        <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Data completeness">
          {COMPLETENESS_FIELDS.map((f) => {
            const ok = card.completeness[f];
            return (
              <span
                key={f}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
                  ok ? 'bg-muted text-foreground' : 'border border-dashed text-muted-foreground',
                )}
              >
                {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {COMPLETENESS_LABELS[f]}
                <span className="sr-only">{ok ? 'captured' : 'missing'}</span>
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
