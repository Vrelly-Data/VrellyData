import { ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { type SignalRow, type SignalStatus, VISIBILITY_LABEL, locationOf } from '@/lib/signals';
import { marketLabel, signalTypeLabel } from '@/lib/signalCatalog';
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

/**
 * Evidence drawer: the link, the who/where, and the payload. For High Intent a
 * client sees only who and where — never how the signal was found; the source
 * detail (reply excerpt, campaign, platform) exists only in the admin response
 * and is shown only to admins.
 */
export function SignalDetailSheet({
  signal, onClose, onMark, busy, admin = false,
}: {
  signal: SignalRow | null;
  onClose: () => void;
  onMark: (status: Exclude<SignalStatus, 'pushed'>) => void;
  busy: boolean;
  admin?: boolean;
}) {
  const s = signal;
  const d = (admin ? s?.admin_detail : null) ?? null;
  const excerpt = typeof d?.reply_excerpt === 'string' ? d.reply_excerpt : null;
  const filled = (s?.enrichment?.filled ?? null) as Record<string, string> | null;
  const showPayload = !!s && s.type !== 'high_intent' && Object.keys(s.payload ?? {}).length > 0;
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
                <Badge variant="outline">{signalTypeLabel(s.type)}</Badge>
                {(s.markets ?? []).map((m) => <Badge key={m} variant="outline">{marketLabel(m)}</Badge>)}
                {admin && s.visibility && <Badge variant="outline">{VISIBILITY_LABEL[s.visibility]}</Badge>}
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

            <div className="divide-y">
              <Field label="When">{format(new Date(s.occurred_at), 'PPpp')}</Field>
              <Field label="Company">{s.company_name}</Field>
              <Field label="Domain">{s.company_domain}</Field>
              <Field label="Industry">{s.industry}</Field>
              <Field label="Company size">{s.company_size}</Field>
              <Field label="Person">{s.person_name}</Field>
              <Field label="Title">{s.person_title}</Field>
              <Field label="Seniority">{s.seniority?.replace(/_/g, ' ')}</Field>
              <Field label="Email">{s.person_email}</Field>
              <Field label="LinkedIn">
                {s.person_linkedin && <a className="underline" href={s.person_linkedin} target="_blank" rel="noopener noreferrer">{s.person_linkedin}</a>}
              </Field>
              <Field label="Location">{locationOf(s)}</Field>
            </div>

            {admin && (
              <div className="mt-6 space-y-2 rounded-md border border-dashed p-3">
                <p className="text-xs font-medium text-muted-foreground">Admin only — never shown to clients</p>
                {excerpt && (
                  <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground whitespace-pre-line">{excerpt}</blockquote>
                )}
                <div className="divide-y">
                  <Field label="Source">{s.source_key} · {s.signal_type}</Field>
                  <Field label="Team">{s.team_name ?? (s.visibility === 'admin' ? 'none (admin only)' : null)}</Field>
                  <Field label="Platform">{d?.platform as string | undefined}</Field>
                  <Field label="Channel">{d?.channel as string | undefined}</Field>
                  <Field label="Campaign">{d?.campaign_name as string | undefined}</Field>
                  <Field label="Interested replies">{d?.interested_rows as number | undefined}</Field>
                  <Field label="Enriched">
                    {filled && Object.keys(filled).length > 0
                      ? Object.entries(filled).map(([k, v]) => `${k.replace(/_/g, ' ')} ← ${v.replace(/_/g, ' ')}`).join(', ')
                      : null}
                  </Field>
                  <Field label="Apollo">{s.enrichment?.apollo_status as string | undefined}</Field>
                </div>
              </div>
            )}

            {showPayload && (
              <>
                <h4 className="text-sm font-medium mt-6 mb-2">Details</h4>
                <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(s.payload, null, 2)}</pre>
              </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
