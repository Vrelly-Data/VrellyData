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
  links_initialized?: boolean;
}

export function useOutboundIntegrations() {
  const queryClient = useQueryClient();

  // Sync contacts per-campaign with retry logic
  const startContactsSync = (integrationId: string) => {
    void (async () => {
      try {
        const { data: campaigns, error } = await supabase
          .from('synced_campaigns')
          .select('id, name')
          .eq('integration_id', integrationId)
          .eq('is_linked', true);

        if (error) throw error;
        if (!campaigns?.length) {
          console.log('No linked campaigns found for contact sync');
          return;
        }

        console.log(`Starting contact sync for ${campaigns.length} linked campaigns`);
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000;
        let successCount = 0;
        let failCount = 0;

        for (const campaign of campaigns) {
          let success = false;
          
          for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
            try {
              const { error: syncError } = await supabase.functions.invoke('sync-reply-contacts', {
                body: { campaignId: campaign.id, integrationId },
              });

              if (syncError) {
                console.warn(`Contact sync attempt ${attempt}/${MAX_RETRIES} failed for campaign ${campaign.name}:`, syncError);
                if (attempt < MAX_RETRIES) {
                  await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
                }
              } else {
                success = true;
                successCount++;
                console.log(`Contact sync succeeded for campaign ${campaign.name}`);
              }
            } catch (err) {
              console.warn(`Contact sync error attempt ${attempt}/${MAX_RETRIES}:`, err);
              if (attempt < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
              }
            }
          }

          if (!success) {
            failCount++;
          }

          // Invalidate after EACH campaign to show progressive updates
          queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
          queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
        }

        // Final invalidation for contacts list
        queryClient.invalidateQueries({ queryKey: ['synced-contacts'] });
        
        if (failCount > 0) {
          toast.warning(`Contact sync: ${successCount} succeeded, ${failCount} failed`);
        }
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
        .select('id, team_id, platform, name, is_active, sync_status, sync_error, last_synced_at, created_at, updated_at, reply_team_id, webhook_status, webhook_subscription_id, links_initialized')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as OutboundIntegration[];
    },
  });

  const addIntegration = useMutation({
    mutationFn: async ({ platform, name, apiKey, replyTeamId }: { platform: string; name: string; apiKey: string; replyTeamId?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) throw new Error('No team found');

      const { data, error } = await supabase
        .from('outbound_integrations')
        .insert({
          team_id: membership.team_id,
          platform,
          name,
          api_key_encrypted: apiKey,
          created_by: user.id,
          is_active: true,
          sync_status: 'syncing',
          reply_team_id: replyTeamId || null,
          links_initialized: false,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      toast.success('Integration added - syncing campaigns...');

      if (data?.id) {
        try {
          // Step 1: Fetch available campaigns with AUTO-LINK enabled for first sync
          try {
            const { data: fetchResult, error: availableError } = await supabase.functions.invoke('fetch-available-campaigns', {
              body: { integrationId: data.id, autoLinkOnFirstSync: true },
            });
            
            if (availableError) {
              console.warn('fetch-available-campaigns error (continuing):', availableError);
            } else {
              console.log('fetch-available-campaigns result:', fetchResult);
            }
          } catch (err) {
            console.warn('fetch-available-campaigns error (continuing):', err);
          }

          // Step 2: Run main sync (preserves the linked status we just set)
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

            // Start background contact sync for linked campaigns
            startContactsSync(data.id);

            toast.success('Campaigns synced - contacts syncing in background...');
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

      // Step 1: Call fetch-available-campaigns FIRST with auto-link enabled
      // This populates peopleCount AND auto-links campaigns on first sync
      try {
        const { data: fetchResult, error: availableError } = await supabase.functions.invoke('fetch-available-campaigns', {
          body: { integrationId, autoLinkOnFirstSync: true },
        });
        if (availableError) {
          console.warn('fetch-available-campaigns failed (peopleCount may be 0):', availableError);
        } else {
          console.log('fetch-available-campaigns result:', fetchResult);
          if (fetchResult?.autoLinked) {
            toast.info(`Auto-linked ${fetchResult.linkedCount} campaigns`);
          }
        }
      } catch (err) {
        console.warn('fetch-available-campaigns error:', err);
      }

      // Step 2: Run the main V3 sync for status/name consistency
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

      // Start background contact sync for linked campaigns
      startContactsSync(integrationId);

      toast.success(`Synced ${data.campaigns} campaigns - syncing contacts...`);
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
        throw new Error(error.message || 'Failed to call webhook setup function');
      }
      
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

  // Link all campaigns for an integration (recovery action)
  const linkAllCampaigns = useMutation({
    mutationFn: async (integrationId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) throw new Error('No team found');

      // Update all campaigns for this integration to is_linked = true
      const { data, error } = await supabase
        .from('synced_campaigns')
        .update({ is_linked: true })
        .eq('integration_id', integrationId)
        .eq('team_id', membership.team_id)
        .select('id');

      if (error) throw error;
      return { linkedCount: data?.length || 0, integrationId };
    },
    onSuccess: ({ linkedCount, integrationId }) => {
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
      queryClient.invalidateQueries({ queryKey: ['available-campaigns'] });
      
      toast.success(`Linked ${linkedCount} campaigns`);
      
      // Trigger contact sync for the newly linked campaigns
      startContactsSync(integrationId);
    },
    onError: (error) => {
      toast.error(`Failed to link campaigns: ${error.message}`);
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
    // setupWebhook - kept internally but not exposed to UI
    resetSyncStatus,
    linkAllCampaigns,
    startContactsSync,
  };
}
