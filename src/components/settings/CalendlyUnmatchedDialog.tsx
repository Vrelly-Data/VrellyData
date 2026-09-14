import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Row {
  id: string;
  invitee_uuid: string;
  event_name: string | null;
  start_time: string | null;
  email: string | null;
}

export function CalendlyUnmatchedDialog({ integrationId }: { integrationId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [attachEmail, setAttachEmail] = useState<Record<string, string>>({});

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('calendly_events')
      .select('id, invitee_uuid, event_name, start_time, email')
      .eq('integration_id', integrationId)
      .is('person_key', null)
      .order('start_time', { ascending: false, nullsFirst: false })
      .limit(50);
    setLoading(false);
    if (!error && Array.isArray(data)) setRows(data as Row[]);
  };

  useEffect(() => {
    if (open) void fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleAttach = async (rowId: string) => {
    const email = (attachEmail[rowId] || '').trim().toLowerCase();
    if (!email.includes('@')) return;
    // Verify a person exists for this team/email
    const { data: person } = await supabase
      .from('people')
      .select('person_key')
      .eq('person_key', email)
      .maybeSingle();
    if (!person?.person_key) {
      alert('No person found for that email on your team. Create the person first, then attach.');
      return;
    }
    const { error } = await supabase
      .from('calendly_events')
      .update({ person_key: email })
      .eq('id', rowId);
    if (!error) {
      setAttachEmail((s) => ({ ...s, [rowId]: '' }));
      void fetchRows();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">View unmatched bookings</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Unmatched Calendly bookings</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unmatched bookings found.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div key={r.id} className="border rounded-md p-2.5">
                  <div className="text-sm font-medium">{r.event_name || 'Meeting'}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.start_time ? new Date(r.start_time).toLocaleString() : 'TBD'} · {r.email || 'unknown email'}
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Attach to person (email)</Label>
                      <Input
                        value={attachEmail[r.id] || ''}
                        onChange={(e) => setAttachEmail((s) => ({ ...s, [r.id]: e.target.value }))}
                        placeholder="user@example.com"
                        className="h-8 text-sm"
                      />
                    </div>
                    <Button size="sm" onClick={() => handleAttach(r.id)}>Attach</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

