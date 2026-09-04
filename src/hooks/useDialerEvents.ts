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
  // Query: direct person_key match (match-only path)
  const { data: direct, error: directErr } = await supabase
    .from('dialer_events')
    .select('call_id, occurred_at, disposition, connected, voicemail, duration_seconds, note, recording_url, phone_e164, pb_contact_id, source')
    .eq('person_key', emailLower)
    .order('occurred_at', { ascending: true });
  if (directErr) throw directErr;
  return ((direct ?? []) as unknown as DialerEvent[]).sort(
    (x, y) => new Date(x.occurred_at).getTime() - new Date(y.occurred_at).getTime()
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

