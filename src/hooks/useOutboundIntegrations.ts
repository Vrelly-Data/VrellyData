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
          return;
        }
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
        const platform = (data as any).platform?.toLowerCase() || '';

        if (platform === 'heyreach') {
          // HeyReach sync chain
          try {
            // Step 1: Sync HeyReach campaigns
            const { error } = await supabase.functions.invoke('sync-heyreach-campaigns', {
              body: { integrationId: data.id },
            });

            if (error) {
              console.error('HeyReach campaign sync failed:', error);
              toast.error('Campaign sync failed - you can try again manually');
            } else {
              queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
              queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
              queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
              toast.success('HeyReach campaigns synced');
            }

            // Step 2: DISABLED — do not poll the HeyReach inbox on connect.
            //
            // poll-heyreach-inbox requests
            //   filters: { linkedInAccountIds: [], campaignIds: [], searchString: '' }
            // i.e. EVERY conversation in the account, and nothing scopes it:
            // heyreach_account_ids lives on client_analysis and is read only by
            // get-client-report / generate-client-analysis for REPORTING — no
            // capture path consults it. There is also no account-selection step
            // in the connect dialog. So polling here would ingest a client's
            // entire HeyReach inbox as 'pending' agent_leads within seconds of
            // connecting, for every end-client in that account.
            //
            // Campaign sync above is unaffected, so the integration still
            // appears configured. Capture is enabled deliberately once account
            // scoping exists (or on-demand), rather than implicitly at connect.
            // Reply.io and Smartlead connect behaviour is untouched.
            console.log(
              '[heyreach] connect-time inbox poll intentionally skipped — capture is ' +
              'enabled separately once account scoping is in place.',
            );
          } catch (err) {
            console.error('HeyReach auto-sync error:', err);
          }
        } else if (platform === 'smartlead') {
          // Smartlead post-add: campaign sync only. Webhook registration is
          // configured manually by the user in the Smartlead dashboard
          // (current model — no auto-register endpoint), so no equivalent of
          // Reply.io's setup-reply-webhook step here.
          try {
            const { error } = await supabase.functions.invoke('sync-smartlead-campaigns', {
              body: { integrationId: data.id },
            });

            if (error) {
              console.error('Smartlead campaign sync failed:', error);
              toast.error('Campaign sync failed - you can try again manually');
            } else {
              queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
              queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
              queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
              toast.success('Smartlead campaigns synced');
            }
          } catch (err) {
            console.error('Smartlead auto-sync error:', err);
          }
        } else if (platform === 'phoneburner') {
          // PhoneBurner: dialer integration. No campaign concept. On connect,
          // seed a contacts pull and a recent calls poll (both additive).
          try {
            const { error: cErr } = await supabase.functions.invoke('sync-phoneburner-contacts', {
              body: { integrationId: data.id },
            });
            if (cErr) {
              console.warn('PhoneBurner contacts sync failed (non-fatal):', cErr);
            }
          } catch (e) {
            console.warn('PhoneBurner contacts sync error (non-fatal):', e);
          }
          try {
            const { error: pErr } = await supabase.functions.invoke('poll-phoneburner-calls', {
              body: { integrationId: data.id, lookbackDays: 2 },
            });
            if (pErr) {
              console.warn('PhoneBurner calls poll failed (non-fatal):', pErr);
            }
          } catch (e) {
            console.warn('PhoneBurner calls poll error (non-fatal):', e);
          }
        } else if (platform === 'reply.io' || platform === 'replyio') {
          // Reply.io sync chain
          try {
            // Step 1: Fetch available campaigns with AUTO-LINK enabled for first sync
            try {
              const { data: fetchResult, error: availableError } = await supabase.functions.invoke('fetch-available-campaigns', {
                body: { integrationId: data.id, autoLinkOnFirstSync: true },
              });

              if (availableError) {
                console.warn('fetch-available-campaigns error (continuing):', availableError);
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

            // Step 3: Auto-register Reply.io webhooks
            try {
              const { data: webhookResult } = await supabase
                .functions.invoke('setup-reply-webhook', {
                  body: { integrationId: data.id },
                });

              if (webhookResult?.success) {
                console.log('Webhooks registered successfully');
              } else {
                console.warn('Webhook registration failed:', webhookResult?.error);
              }
            } catch (err) {
              console.warn('Webhook setup error (non-fatal):', err);
            }
          } catch (err) {
            console.error('Auto-sync error:', err);
          }
        } else {
          // Throwing here would surface as an unhandled rejection (the
          // mutation's onError only catches mutationFn errors, not
          // onSuccess errors), so we toast directly to keep the UX intent.
          const message = `No add-integration handler configured for platform "${platform || 'unknown'}"`;
          console.error(message);
          toast.error(message);
        }
      }
    },
    onError: (error) => {
      toast.error(`Failed to add integration: ${error.message}`);
    },
  });

  const deleteIntegration = useMutation({
    mutationFn: async (id: string) => {
      // client_analysis.reply_io_integration_id is ON DELETE SET NULL, so
      // deleting an integration SILENTLY unlinks every client pointing at it —
      // their weekly stats then read as zero with no error anywhere. That is
      // exactly how QAlified broke. Refuse rather than blank the pointer; the
      // operator must repoint or unlink the client first.
      const { data: dependents, error: depErr } = await supabase
        .from('client_analysis')
        .select('id, display_name')
        .eq('reply_io_integration_id', id);
      if (depErr) throw depErr;
      if (dependents && dependents.length > 0) {
        const names = dependents.map((d) => d.display_name ?? d.id).join(', ');
        throw new Error(
          `${dependents.length} client analysis row(s) still point at this integration (${names}). ` +
            `Repoint them at the replacement integration first — deleting now would silently zero their stats.`,
        );
      }

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

      // Look up platform for this integration
      const current = (queryClient.getQueryData(['outbound-integrations']) as OutboundIntegration[] | undefined)
        ?.find(i => i.id === integrationId);
      const platform = current?.platform?.toLowerCase() || '';

      if (platform === 'heyreach') {
        const { data, error } = await supabase.functions.invoke('sync-heyreach-campaigns', {
          body: { integrationId },
        });

        if (error) throw error;
        return data;
      }

      if (platform === 'smartlead') {
        const { data, error } = await supabase.functions.invoke('sync-smartlead-campaigns', {
          body: { integrationId },
        });

        if (error) throw error;
        return data;
      }

      if (platform === 'phoneburner') {
        // No campaigns — run contacts + recent calls. Both are additive and safe to call on demand.
        const results: Record<string, unknown> = {};
        const { data: cData, error: cErr } = await supabase.functions.invoke('sync-phoneburner-contacts', {
          body: { integrationId },
        });
        if (cErr) throw cErr;
        results.contacts = cData ?? null;
        const { data: pData, error: pErr } = await supabase.functions.invoke('poll-phoneburner-calls', {
          body: { integrationId, lookbackDays: 2 },
        });
        if (pErr) throw pErr;
        results.calls = pData ?? null;
        return results;
      }

      if (platform === 'reply.io' || platform === 'replyio') {
        // Step 1: Call fetch-available-campaigns FIRST with auto-link enabled
        try {
          const { data: fetchResult, error: availableError } = await supabase.functions.invoke('fetch-available-campaigns', {
            body: { integrationId, autoLinkOnFirstSync: true },
          });
          if (availableError) {
            console.warn('fetch-available-campaigns failed (peopleCount may be 0):', availableError);
          } else {
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
      }

      throw new Error(
        `No sync handler configured for platform "${platform || 'unknown'}"`,
      );
    },
    onSuccess: (data, integrationId) => {
      queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });

      const current = (queryClient.getQueryData(['outbound-integrations']) as OutboundIntegration[] | undefined)
        ?.find(i => i.id === integrationId);
      const platform = current?.platform?.toLowerCase() || '';
      const isReplyIo = platform === 'reply.io' || platform === 'replyio';

      if (isReplyIo) {
        // Background contact sync for linked campaigns is Reply.io-only —
        // HeyReach and Smartlead don't have an equivalent.
        startContactsSync(integrationId);
      }

      // Each sync function uses a slightly different result shape:
      // sync-reply-campaigns returns { campaigns: N }, sync-heyreach-campaigns
      // and sync-smartlead-campaigns return { synced: N }.
      const count = data?.synced ?? data?.campaigns ?? 'unknown';
      toast.success(`Synced ${count} campaigns${isReplyIo ? ' - syncing contacts...' : ''}`);
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
