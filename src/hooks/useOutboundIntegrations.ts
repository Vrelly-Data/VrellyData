import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface OutboundIntegration {
  id: string;
  team_id: string;
  platform: string;
  name: string;
  is_active: boolean;
  sync_status: string | null;
  sync_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  reply_team_id?: string | null;
  webhook_status?: string | null;
  webhook_subscription_id?: string | null;
}

export function useOutboundIntegrations() {
  const queryClient = useQueryClient();

  const { data: integrations, isLoading, error } = useQuery({
    queryKey: ['outbound-integrations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('outbound_integrations')
        .select('id, team_id, platform, name, is_active, sync_status, sync_error, last_synced_at, created_at, updated_at, reply_team_id, webhook_status, webhook_subscription_id')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as OutboundIntegration[];
    },
  });

  const addIntegration = useMutation({
    mutationFn: async ({ platform, name, apiKey, replyTeamId }: { platform: string; name: string; apiKey: string; replyTeamId?: string }) => {
      // Get user's team_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) throw new Error('No team found');

      // Note: In production, API key should be encrypted server-side
      // For now, we'll store a placeholder - actual encryption will be in edge function
      const { data, error } = await supabase
        .from('outbound_integrations')
        .insert({
          team_id: membership.team_id,
          platform,
          name,
          api_key_encrypted: apiKey, // Will be encrypted by edge function
          created_by: user.id,
          is_active: true,
          sync_status: 'pending',
          reply_team_id: replyTeamId || null, // For agency accounts
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.success('Integration added successfully');
    },
    onError: (error) => {
      toast.error(`Failed to add integration: ${error.message}`);
    },
  });

  const deleteIntegration = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('outbound_integrations')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.success('Integration removed');
    },
    onError: (error) => {
      toast.error(`Failed to remove integration: ${error.message}`);
    },
  });

  const toggleIntegration = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('outbound_integrations')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
    },
    onError: (error) => {
      toast.error(`Failed to update integration: ${error.message}`);
    },
  });

  const syncIntegration = useMutation({
    mutationFn: async (integrationId: string) => {
      // Optimistically update status
      queryClient.setQueryData(['outbound-integrations'], (old: OutboundIntegration[] | undefined) => 
        old?.map(i => i.id === integrationId ? { ...i, sync_status: 'syncing' } : i)
      );

      const { data, error } = await supabase.functions.invoke('sync-reply-campaigns', {
        body: { integrationId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
      toast.success(`Synced ${data.campaigns} campaigns`);
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.error(`Sync failed: ${error.message}`);
    },
  });

  const setupWebhook = useMutation({
    mutationFn: async (integrationId: string) => {
      const { data, error } = await supabase.functions.invoke('setup-reply-webhook', {
        body: { integrationId },
      });

      if (error) {
        // Try to extract detailed error from response
        const errorData = data as { error?: string; details?: string; hint?: string; status?: number } | null;
        const details = errorData?.details || errorData?.error || error.message;
        const hint = errorData?.hint;
        const status = errorData?.status;
        
        const fullMessage = hint 
          ? `${details} (${hint})`
          : status 
            ? `Reply.io error ${status}: ${details}`
            : details;
        
        throw new Error(fullMessage);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.success('Webhook configured successfully - live updates enabled!');
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.error(`Failed to setup webhook: ${error.message}`);
    },
  });

  const resetSyncStatus = useMutation({
    mutationFn: async (integrationId: string) => {
      const { error } = await supabase
        .from('outbound_integrations')
        .update({ 
          sync_status: 'pending', 
          sync_error: null,
          updated_at: new Date().toISOString() 
        })
        .eq('id', integrationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.success('Sync status reset');
    },
    onError: (error) => {
      toast.error(`Failed to reset sync status: ${error.message}`);
    },
  });

  return {
    integrations: integrations ?? [],
    isLoading,
    error,
    addIntegration,
    deleteIntegration,
    toggleIntegration,
    syncIntegration,
    setupWebhook,
    resetSyncStatus,
  };
}
