import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, RefreshCw, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useSenderProfiles } from '@/hooks/useSenderProfiles';
import {
  useEmailSenderMailboxes,
  useUpdateMailboxSender,
  useSyncMailboxes,
} from '@/hooks/useEmailSenderMailboxes';

const UNMAPPED = '__unmapped__';

// Email sender ↔ mailbox review. One sender can own many mailboxes; auto-mapped
// by from_name == sender name on sync. Unmapped mailboxes surface here for the
// operator to assign. Only relevant for email-heavy (Smartlead) clients.
export function EmailMailboxMapping() {
  const { data: mailboxes = [], isLoading } = useEmailSenderMailboxes();
  const { data: senders = [] } = useSenderProfiles();
  const updateSender = useUpdateMailboxSender();
  const syncMailboxes = useSyncMailboxes();

  const senderNames = useMemo(
    () => [...new Set(senders.map((s) => s.sender_name).filter(Boolean))].sort(),
    [senders],
  );
  const unmappedCount = mailboxes.filter((m) => !m.sender_name).length;

  // Don't render for clients with no mailboxes synced (LinkedIn-only, etc.).
  if (!isLoading && mailboxes.length === 0) return null;

  const assign = async (id: string, value: string) => {
    try {
      await updateSender.mutateAsync({ id, senderName: value === UNMAPPED ? null : value });
    } catch (e) {
      toast.error(`Couldn't update: ${(e as Error).message}`);
    }
  };

  const sync = async () => {
    try {
      const r = await syncMailboxes.mutateAsync();
      toast.success(`Synced ${r.total} mailboxes — ${r.mapped} mapped, ${r.unmapped} unmapped`);
    } catch (e) {
      toast.error(`Sync failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email sender mailboxes
          </h3>
          <p className="text-xs text-muted-foreground">
            One sender can own many mailboxes. Auto-mapped by sending name; assign any
            unmapped ones below.
            {unmappedCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {' '}
                {unmappedCount} unmapped.
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={sync} disabled={syncMailboxes.isPending}>
          {syncMailboxes.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Sync mailboxes
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-md border divide-y max-h-96 overflow-y-auto">
          {mailboxes.map((m) => (
            <div key={m.id} className="flex items-center gap-3 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{m.mailbox_email}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.from_name || '(no sending name)'}
                </div>
              </div>
              {!m.sender_name && (
                <Badge variant="outline" className="text-amber-600 border-amber-400 text-[10px]">
                  Unmapped
                </Badge>
              )}
              <Select
                value={m.sender_name ?? UNMAPPED}
                onValueChange={(v) => assign(m.id, v)}
                disabled={updateSender.isPending}
              >
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue placeholder="Assign sender…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>Unmapped</SelectItem>
                  {senderNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
      {senderNames.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add sender profiles above first, then map mailboxes to them.
        </p>
      )}
    </div>
  );
}
