import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BookingEvent {
  invitee_uuid: string;
  scheduled_event_uuid: string;
  event_name: string | null;
  status: 'scheduled' | 'canceled' | 'completed';
  start_time: string | null;
  end_time: string | null;
  source: string;
}

async function fetchBookingEventsForEmail(emailLower: string): Promise<BookingEvent[]> {
  // Prefer matched person_key (emailLower). Also allow direct email match to surface unmatched rows.
  // Order ascending to interleave naturally with the message thread chronology.
  const client: any = supabase as any;
  const { data: direct, error: directErr } = await client
    .from('calendly_events')
    .select('invitee_uuid, scheduled_event_uuid, event_name, status, start_time, end_time, source, person_key, email')
    .or(`person_key.eq.${emailLower},email.eq.${emailLower}`)
    .order('start_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true }); // tiebreaker when no start_time
  if (directErr) throw directErr;
  const rows = Array.isArray(direct) ? direct : [];
  return rows.map((r: any) => ({
    invitee_uuid: r.invitee_uuid,
    scheduled_event_uuid: r.scheduled_event_uuid,
    event_name: r.event_name ?? null,
    status: (r.status as 'scheduled' | 'canceled' | 'completed') ?? 'scheduled',
    start_time: r.start_time ?? null,
    end_time: r.end_time ?? null,
    source: r.source ?? 'poll',
  })) as BookingEvent[];
}

export function useBookingEventsForEmail(email: string | null | undefined) {
  const key = (email ?? '').trim().toLowerCase();
  return useQuery<BookingEvent[]>({
    queryKey: ['booking-events', key],
    queryFn: async () => {
      if (!key) return [];
      return await fetchBookingEventsForEmail(key);
    },
    enabled: !!key,
    staleTime: 15000,
    refetchInterval: 30000,
  });
}

