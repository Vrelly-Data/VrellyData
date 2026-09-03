import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DialerEvent {
  call_id: string;
  occurred_at: string;
  disposition: string | null;
  connected: boolean | null;
  voicemail: boolean | null;
  duration_seconds: number | null;
  note: string | null;
  recording_url: string | null;
  phone_e164: string | null;
  pb_contact_id: string | null;
  source: string;
}

async function fetchDialerEventsForEmail(emailLower: string): Promise<DialerEvent[]> {
  // Query A: direct person_key match
  const { data: direct, error: directErr } = await supabase
    .from('dialer_events')
    .select('call_id, occurred_at, disposition, connected, voicemail, duration_seconds, note, recording_url, phone_e164, pb_contact_id, source')
    .eq('person_key', emailLower)
    .order('occurred_at', { ascending: true });
  if (directErr) throw directErr;
  const a = (direct ?? []) as unknown as DialerEvent[];

  // Query B: join via phoneburner_contacts by email (covers events where person_key is null)
  const { data: pbRows } = await supabase
    .from('phoneburner_contacts')
    .select('pb_contact_id')
    .or(`person_key.eq.${emailLower},email.eq.${emailLower}`)
    .limit(200);
  const ids = (pbRows ?? []).map((r: any) => r.pb_contact_id).filter(Boolean);
  let b: DialerEvent[] = [];
  if (ids.length > 0) {
    const { data: viaPb } = await supabase
      .from('dialer_events')
      .select('call_id, occurred_at, disposition, connected, voicemail, duration_seconds, note, recording_url, phone_e164, pb_contact_id, source')
      .in('pb_contact_id', ids)
      .order('occurred_at', { ascending: true });
    b = (viaPb ?? []) as unknown as DialerEvent[];
  }

  // Dedupe by call_id, prefer entries with a person_key (present in A)
  const byId = new Map<string, DialerEvent>();
  for (const ev of [...b, ...a]) {
    if (!byId.has(ev.call_id)) byId.set(ev.call_id, ev);
  }
  return Array.from(byId.values()).sort(
    (x, y) => new Date(x.occurred_at).getTime() - new Date(y.occurred_at).getTime(),
  );
}

export function useDialerEventsForEmail(email: string | null | undefined) {
  const key = (email ?? '').trim().toLowerCase();
  return useQuery<DialerEvent[]>({
    queryKey: ['dialer-events', key],
    queryFn: async () => {
      if (!key) return [];
      return await fetchDialerEventsForEmail(key);
    },
    enabled: !!key,
    staleTime: 15000,
    refetchInterval: 30000,
  });
}

