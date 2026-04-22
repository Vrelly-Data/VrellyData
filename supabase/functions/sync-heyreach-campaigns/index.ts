import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = [
  'https://vrelly.com',
  'https://www.vrelly.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-key',
  };
}

const HEYREACH_API = 'https://api.heyreach.io/api/public';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: x-agent-key for cron, or JWT for manual trigger
    const agentKey = req.headers.get('x-agent-key');
    const expectedKey = Deno.env.get('AGENT_API_KEY');
    const authHeader = req.headers.get('authorization');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    let userId: string | null = null;

    if (agentKey && agentKey === expectedKey) {
      // Cron call — userId must come from request body
    } else if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    } else {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get HeyReach integration
    let query = supabase
      .from('outbound_integrations')
      .select('id, team_id, created_by, api_key_encrypted')
      .eq('is_active', true)
      .eq('platform', 'heyreach');

    if (userId) {
      query = query.eq('created_by', userId);
    }

    const { data: integrations, error: intError } = await query;

    if (intError) {
      console.error('Failed to fetch integrations:', intError.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch integrations' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalSynced = 0;

    for (const integration of integrations ?? []) {
      const apiKey = integration.api_key_encrypted;
      if (!apiKey) {
        console.warn(`[sync-heyreach-campaigns] No API key for integration ${integration.id}`);
        continue;
      }

      await supabase
        .from('outbound_integrations')
        .update({ sync_status: 'syncing', sync_error: null })
        .eq('id', integration.id);

      try {
        // Paginate through all campaigns using POST /campaign/GetAll
        let offset = 0;
        const limit = 100;
        let hasMore = true;
        let integrationSynced = 0;

        while (hasMore) {
          const res = await fetch(`${HEYREACH_API}/campaign/GetAll`, {
            method: 'POST',
            headers: {
              'X-API-KEY': apiKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              offset,
              limit,
              statuses: ['DRAFT', 'IN_PROGRESS', 'PAUSED', 'FINISHED', 'CANCELED', 'FAILED', 'STARTING', 'SCHEDULED'],
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HeyReach API error (${res.status}): ${errText}`);
          }

          const data = await res.json();
          const campaigns = data.items || [];
          const totalCount = data.totalCount || 0;

          console.log(`[sync-heyreach-campaigns] Fetched ${campaigns.length} campaigns (offset=${offset}, total=${totalCount})`);

          for (const campaign of campaigns) {
            const externalId = String(campaign.id);
            const name = campaign.name || 'Unnamed Campaign';
            const status = campaign.status || 'unknown';

            // Stats come exclusively from progressStats embedded in the
            // /campaign/GetAll response — no extra API call. Per-campaign
            // POST /stats/GetOverallStats was causing EarlyDrop timeouts;
            // messages/replies metrics will stay 0 for HeyReach until a
            // bulk stats endpoint or background enrichment job is added.
            const progressStats = campaign.progressStats ?? {};
            const stats: Record<string, unknown> = {
              peopleCount: progressStats.totalUsers ?? 0,
              peopleFinished: progressStats.totalUsersFinished ?? 0,
              progressStats,
            };

            // Auto-link HeyReach campaigns so they appear in the Data Playground
            // without manual linking (HeyReach has no "Manage Campaigns" UI).
            // team_id is required by schema (NOT NULL) and RLS filters all
            // synced_campaigns SELECTs by team_id, so without it the row is
            // invisible to the frontend even if the insert succeeds.
            const { error: upsertError } = await supabase
              .from('synced_campaigns')
              .upsert({
                external_campaign_id: externalId,
                name,
                status: status.toLowerCase(),
                integration_id: integration.id,
                team_id: integration.team_id,
                stats,
                raw_data: campaign,
                is_linked: true,
              }, {
                onConflict: 'integration_id,external_campaign_id',
              });

            if (upsertError) {
              console.error(`[sync-heyreach-campaigns] Upsert error for campaign ${externalId}:`, upsertError.message);
              continue;
            }

            integrationSynced++;
          }

          offset += campaigns.length;
          hasMore = campaigns.length === limit && offset < totalCount;

          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        // Update integration status on success
        await supabase
          .from('outbound_integrations')
          .update({
            sync_status: 'synced',
            sync_error: null,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.id);

        totalSynced += integrationSynced;
        console.log(`[sync-heyreach-campaigns] Integration ${integration.id}: synced ${integrationSynced} campaigns`);

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[sync-heyreach-campaigns] Error for integration ${integration.id}:`, errorMessage);

        await supabase
          .from('outbound_integrations')
          .update({
            sync_status: 'error',
            sync_error: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.id);
      }
    }

    console.log(`[sync-heyreach-campaigns] Done. Synced: ${totalSynced}`);

    return new Response(JSON.stringify({ success: true, synced: totalSynced }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[sync-heyreach-campaigns] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
