import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, PhoneCall } from 'lucide-react';

interface CallEvent {
  occurred_at: string;
  disposition: string | null;
  connected: boolean | null;
  voicemail: boolean | null;
  duration_seconds: number | null;
  note: string | null;
  recording_url: string | null;
  phone_e164: string | null;
}

export function CallHistoryDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | null;
}) {
  const personKey = useMemo(() => (email ? email.toLowerCase() : null), [email]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CallEvent[]>([]);

  useEffect(() => {
    if (!open || !personKey) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('dialer_events')
          .select('occurred_at, disposition, connected, voicemail, duration_seconds, note, recording_url, phone_e164')
          .eq('person_key', personKey)
          .order('occurred_at', { ascending: false })
          .limit(200);
        if (!cancelled) {
          if (error) {
            console.warn('dialer_events fetch failed:', error.message);
            setRows([]);
          } else {
            setRows((data ?? []) as unknown as CallEvent[]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, personKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4" />
            Call History
          </DialogTitle>
        </DialogHeader>
        {!personKey ? (
          <p className="text-sm text-muted-foreground">No email available for this contact.</p>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading calls…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls found for {email}.</p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <ul className="space-y-3 pr-2">
              {rows.map((ev, idx) => (
                <li key={idx} className="p-3 border rounded-md">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">
                      {new Date(ev.occurred_at).toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {ev.connected ? (
                        <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">Connected</Badge>
                      ) : ev.voicemail ? (
                        <Badge variant="secondary" className="text-xs">Voicemail</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Attempted</Badge>
                      )}
                      {ev.duration_seconds != null && ev.duration_seconds >= 0 && (
                        <span className="text-xs text-muted-foreground">{Math.round(ev.duration_seconds)}s</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-sm">
                    <span className="text-muted-foreground">Disposition:</span>{' '}
                    <span className="capitalize">{ev.disposition || '—'}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {ev.phone_e164 || 'No phone'}
                  </div>
                  {ev.note && <div className="mt-2 text-sm">{ev.note}</div>}
                  {ev.recording_url && (
                    <div className="mt-2">
                      <a
                        className="text-xs text-blue-600 hover:underline"
                        href={ev.recording_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View recording
                      </a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

