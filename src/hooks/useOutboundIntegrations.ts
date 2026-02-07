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

  // Sync contacts per-campaign (separate backend function) to avoid long-running sync timeouts.
  const startContactsSync = (integrationId: string) => {
    void (async () => {
      try {
        const { data: campaigns, error } = await supabase
          .from('synced_campaigns')
          .select('id')
          .eq('integration_id', integrationId)
          .eq('is_linked', true);

        if (error) throw error;
        if (!campaigns?.length) return;

        for (const campaign of campaigns) {
          const { error: syncError } = await supabase.functions.invoke('sync-reply-contacts', {
            body: { campaignId: campaign.id, integrationId },
          });

          if (syncError) {
            console.warn('Contact sync failed:', syncError);
          }
        }

        queryClient.invalidateQueries({ queryKey: ['synced-contacts'] });
        queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
        queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
      } catch (err) {
        console.warn('Contacts auto-sync error:', err);
      }
    })();
  };

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

      // Create integration with 'syncing' status since we'll auto-sync
      const { data, error } = await supabase
        .from('outbound_integrations')
        .insert({
          team_id: membership.team_id,
          platform,
          name,
          api_key_encrypted: apiKey,
          created_by: user.id,
          is_active: true,
          sync_status: 'syncing', // Start as syncing since we auto-sync
          reply_team_id: replyTeamId || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.success('Integration added - syncing campaigns...');

      // Trigger automatic sync immediately
      if (data?.id) {
        try {
          const { error } = await supabase.functions.invoke('sync-reply-campaigns', {
            body: { integrationId: data.id },
          });

          if (error) {
            console.error('Auto-sync failed:', error);
            toast.error('Sync failed - you can try again manually');
          } else {
            queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
            queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
            queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });

            // Contacts + aggregate stats are synced per-campaign in the background
            startContactsSync(data.id);

            toast.success('Sync complete!');
          }
        } catch (err) {
          console.error('Auto-sync error:', err);
        }
      }
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
    onSuccess: (data, integrationId) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });

      // Contacts + aggregate stats are synced per-campaign in the background
      startContactsSync(integrationId);

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

      // Edge function returns 200 with success: false for failures
      if (error) {
        throw new Error(error.message || 'Failed to call webhook setup function');
      }
      
      // Check the success field in the response
      const result = data as { 
        success: boolean; 
        error?: string; 
        message?: string;
        usedFallback?: boolean;
        probe?: { status: number; ok: boolean };
        keyFingerprint?: string;
      } | null;
      
      if (!result?.success) {
        throw new Error(result?.error || 'Webhook setup failed with unknown error');
      }
      
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      const message = data?.usedFallback 
        ? 'Webhook configured (using account-level scope) - live updates enabled!'
        : 'Webhook configured successfully - live updates enabled!';
      toast.success(message);
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.error(error.message, { duration: 8000 });
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
