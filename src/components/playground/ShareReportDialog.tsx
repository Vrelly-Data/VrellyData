// Admin-side dialog for managing a client's public report-link tokens.
//
// On open: queries report_tokens for active (non-revoked) tokens that the
// caller owns AND that point at this client. Lists each as a copyable URL
// with a Revoke button. If there are none, surfaces a "Create share link"
// button that calls the create-report-token edge function (action='create')
// and refreshes the list.
//
// Revocation is also via create-report-token (action='revoke'); the dialog
// optimistically updates the local list and falls back to a re-query on
// error.
//
// Security note: RLS on report_tokens scopes the SELECT to created_by =
// auth.uid() (the same admin who minted it) + the is_platform_admin
// check, so a non-admin or cross-admin caller sees an empty list even
// before the function-level check kicks in.

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Copy, Trash2, Plus, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ShareReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientDisplayName: string;
}

interface TokenRow {
  id: string;
  token: string;
  created_at: string;
  revoked: boolean;
}

function reportUrl(token: string): string {
  // The token IS the secret; building from window.origin keeps it tied to
  // whatever environment the admin is viewing from (localhost / preview /
  // prod) without hardcoding.
  return `${window.location.origin}/r/${token}`;
}

export function ShareReportDialog({
  open,
  onOpenChange,
  clientId,
  clientDisplayName,
}: ShareReportDialogProps) {
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const tokensQuery = useQuery({
    queryKey: ['report_tokens', clientId],
    queryFn: async (): Promise<TokenRow[]> => {
      const { data, error } = await supabase
        .from('report_tokens')
        .select('id, token, created_at, revoked')
        .eq('client_id', clientId)
        .eq('revoked', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as TokenRow[];
    },
    enabled: open,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async (): Promise<{ token: string }> => {
      const { data, error } = await supabase.functions.invoke(
        'create-report-token',
        { body: { action: 'create', clientId } },
      );
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
      return data as { token: string };
    },
    onSuccess: () => {
      toast.success('Share link created');
      queryClient.invalidateQueries({ queryKey: ['report_tokens', clientId] });
    },
    onError: (err: Error) => toast.error(`Create failed: ${err.message}`),
  });

  const revokeMutation = useMutation({
    mutationFn: async (token: string): Promise<void> => {
      const { data, error } = await supabase.functions.invoke(
        'create-report-token',
        { body: { action: 'revoke', token } },
      );
      if (error) throw new Error(error.message);
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
    },
    onSuccess: () => {
      toast.success('Share link revoked');
      queryClient.invalidateQueries({ queryKey: ['report_tokens', clientId] });
    },
    onError: (err: Error) => toast.error(`Revoke failed: ${err.message}`),
  });

  const tokens = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data]);

  const handleCopy = async (id: string, token: string) => {
    try {
      await navigator.clipboard.writeText(reportUrl(token));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share report — {clientDisplayName}</DialogTitle>
          <DialogDescription>
            Public read-only links for this client's report. Anyone with the
            URL can view; revoking deactivates that specific link without
            affecting the others.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {tokensQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tokensQuery.error ? (
            <p className="text-sm text-destructive">
              Failed to load: {(tokensQuery.error as Error).message}
            </p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded">
              No active share links yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 border rounded p-2"
                >
                  <Input
                    value={reportUrl(t.token)}
                    readOnly
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-8 text-xs font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 shrink-0"
                    onClick={() => handleCopy(t.id, t.token)}
                    title="Copy link"
                  >
                    {copiedId === t.id ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => revokeMutation.mutate(t.token)}
                    disabled={revokeMutation.isPending}
                    title="Revoke link"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {tokens.length === 0 ? 'Create share link' : 'Create another link'}
          </Button>

          <p className="text-xs text-muted-foreground">
            Multiple active links are harmless — each resolves to the same
            client. Revoke any link you've shared externally and want to
            invalidate.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
