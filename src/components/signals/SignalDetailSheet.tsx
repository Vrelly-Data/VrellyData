import { ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { type SignalRow, type SignalStatus, VISIBILITY_LABEL, locationOf, verticalLabel } from '@/lib/signals';
import { ScoreBadge, StatusBadge } from './SignalsView';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2 break-words">{children}</span>
    </div>
  );
}

const EXCERPT_KEYS = ['reply_excerpt'];

/** Evidence drawer: the link, the who/where, and the raw payload. */
export function SignalDetailSheet({
  signal, onClose, onMark, busy,
}: {
  signal: SignalRow | null;
  onClose: () => void;
  onMark: (status: Exclude<SignalStatus, 'pushed'>) => void;
  busy: boolean;
}) {
  const s = signal;
  const excerpt = s ? EXCERPT_KEYS.map((k) => s.payload?.[k]).find((v) => typeof v === 'string') as string | undefined : undefined;
  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {s && (
          <>
            <SheetHeader>
              <SheetTitle className="text-base leading-snug pr-6">{s.title}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <ScoreBadge score={s.score} />
                <StatusBadge status={s.team_status} />
                <Badge variant="outline">{verticalLabel(s.vertical)}</Badge>
                <Badge variant="outline">{VISIBILITY_LABEL[s.visibility]}</Badge>
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap gap-2 py-4">
              {s.url && (
                <Button asChild size="sm" variant="outline" className="gap-1">
                  <a href={s.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open evidence</a>
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy || s.team_status === 'reviewed'} onClick={() => onMark('reviewed')}>Mark reviewed</Button>
              <Button size="sm" variant="outline" disabled={busy || s.team_status === 'dismissed'} onClick={() => onMark('dismissed')}>Dismiss</Button>
              {s.team_status !== 'new' && s.team_status !== 'pushed' && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMark('new')}>Reset to new</Button>
              )}
            </div>

            {excerpt && (
              <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground mb-4 whitespace-pre-line">{excerpt}</blockquote>
            )}

            <div className="divide-y">
              <Field label="When">{format(new Date(s.occurred_at), 'PPpp')}</Field>
              <Field label="Company">{s.company_name}</Field>
              <Field label="Domain">{s.company_domain}</Field>
              <Field label="Person">{s.person_name}</Field>
              <Field label="Title">{s.person_title}</Field>
              <Field label="Email">{s.person_email}</Field>
              <Field label="LinkedIn">
                {s.person_linkedin && <a className="underline" href={s.person_linkedin} target="_blank" rel="noopener noreferrer">{s.person_linkedin}</a>}
              </Field>
              <Field label="Location">{locationOf(s)}</Field>
              <Field label="Source">{s.source_key} · {s.signal_type}</Field>
            </div>

            <h4 className="text-sm font-medium mt-6 mb-2">Payload</h4>
            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(s.payload, null, 2)}</pre>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
