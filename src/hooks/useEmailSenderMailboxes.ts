import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Cast until types are regenerated after the email_sender_mailboxes migration.
const db = supabase as any;

export interface EmailSenderMailbox {
  id: string;
  mailbox_email: string;
  from_name: string | null;
  sender_name: string | null; // null = unmapped (needs operator review)
  updated_at: string;
}

// Whether the client has an active Smartlead integration — gates whether the
// mailbox-mapping section shows at all (independent of mailbox count, so the
// first Sync is reachable).
export function useHasSmartleadIntegration() {
  return useQuery<boolean>({
    queryKey: ['has-smartlead-integration'],
    queryFn: async () => {
      const { count, error } = await db
        .from('outbound_integrations')
        .select('id', { count: 'exact', head: true })
        .eq('platform', 'smartlead')
        .eq('is_active', true);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

export function useEmailSenderMailboxes() {
  return useQuery<EmailSenderMailbox[]>({
    queryKey: ['email-sender-mailboxes'],
    queryFn: async () => {
      const { data, error } = await db
        .from('email_sender_mailboxes')
        .select('id, mailbox_email, from_name, sender_name, updated_at')
        .order('sender_name', { ascending: true, nullsFirst: true })
        .order('from_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmailSenderMailbox[];
    },
  });
}

// Assign (or clear) the sender for one mailbox. Empty string → unmapped (null).
export function useUpdateMailboxSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, senderName }: { id: string; senderName: string | null }) => {
      const { error } = await db
        .from('email_sender_mailboxes')
        .update({ sender_name: senderName || null, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-sender-mailboxes'] }),
  });
}

// Trigger the Smartlead email-account sync (auto-map by from_name). Resolves
// the caller's Smartlead integration id first.
export function useSyncMailboxes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ total: number; mapped: number; unmapped: number }> => {
      const { data: integ, error: iErr } = await db
        .from('outbound_integrations')
        .select('id')
        .eq('platform', 'smartlead')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (iErr) throw new Error(iErr.message);
      if (!integ?.id) throw new Error('No active Smartlead integration found.');

      const { data, error } = await supabase.functions.invoke('sync-smartlead-email-accounts', {
        body: { integrationId: integ.id },
      });
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return data as { total: number; mapped: number; unmapped: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-sender-mailboxes'] }),
  });
}
