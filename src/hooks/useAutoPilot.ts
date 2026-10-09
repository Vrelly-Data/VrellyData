import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Cast until Supabase types are regenerated (same pattern as useAgent.ts).
const db = supabase as any;

/** Start of the current UTC day — Auto Pilot's daily cap resets at 00:00 UTC. */
export function utcDayStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Replies Auto Pilot has sent today. Counts exactly what the server's daily
 * cap counts (_shared/auto-pilot.ts → countAutoSendsToday): the senders' own
 * 'message_sent' activities marked metadata.sent_by = 'auto'.
 */
export function useAutoSendsToday(enabled = true) {
  return useQuery({
    queryKey: ['auto-sends-today'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;
      const { count, error } = await db
        .from('agent_activity')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('activity_type', 'message_sent')
        .eq('metadata->>sent_by', 'auto')
        .gte('created_at', utcDayStartIso());
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * When Auto Pilot sent messages on this lead: the timestamps of its
 * 'message_sent' activities. The senders append the outgoing message to
 * reply_thread without an "auto" marker (and they are not changed by Auto
 * Pilot), so the conversation view matches each sent message to one of these
 * by time — see isAutoSentMessage.
 */
export function useAutoSentTimes(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['auto-sent-times', leadId],
    enabled: !!leadId,
    queryFn: async (): Promise<number[]> => {
      const { data, error } = await db
        .from('agent_activity')
        .select('created_at')
        .eq('lead_id', leadId)
        .eq('activity_type', 'message_sent')
        .eq('metadata->>sent_by', 'auto');
      if (error) throw error;
      return (data ?? []).map((r: { created_at: string }) => Date.parse(r.created_at)).filter(Number.isFinite);
    },
  });
}

/**
 * A sent message counts as Auto Pilot's when an auto 'message_sent' activity
 * was written within 2 minutes of it — the sender appends the message and
 * logs the activity in the same request, seconds apart.
 */
export function isAutoSentMessage(messageTimestamp: string | null | undefined, autoTimes: number[] | undefined): boolean {
  if (!messageTimestamp || !autoTimes?.length) return false;
  const t = Date.parse(messageTimestamp);
  if (!Number.isFinite(t)) return false;
  return autoTimes.some((a) => Math.abs(a - t) <= 120_000);
}
