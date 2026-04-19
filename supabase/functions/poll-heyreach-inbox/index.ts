/*
-- Required schema changes:
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_conversation_id TEXT;
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_account_id INTEGER;
ALTER TABLE public.synced_campaigns ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'reply_io';
*/

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Auth: x-agent-key for cron, or JWT for manual trigger
    const agentKey = req.headers.get('x-agent-key');
    const expectedKey = Deno.env.get('AGENT_API_KEY');
    const authHeader = req.headers.get('authorization');

    let filterUserId: string | null = null;

    if (agentKey && agentKey === expectedKey) {
      filterUserId = null;
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
      filterUserId = user.id;
    } else {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch active HeyReach integrations
    let query = supabase
      .from('outbound_integrations')
      .select('id, created_by, api_key_encrypted')
      .eq('is_active', true)
      .eq('platform', 'heyreach');

    if (filterUserId) {
      query = query.eq('created_by', filterUserId);
    }

    const { data: integrations, error: intError } = await query;

    if (intError) {
      console.error('Failed to fetch integrations:', intError.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch integrations' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[poll-heyreach-inbox] Processing ${integrations?.length ?? 0} integrations`);

    let totalPolled = 0;
    let totalNew = 0;

    for (const integration of integrations ?? []) {
      try {
        const apiKey = integration.api_key_encrypted;
        if (!apiKey) {
          console.warn(`[poll-heyreach-inbox] No API key for integration ${integration.id}`);
          continue;
        }

        const userId = integration.created_by;

        // Check for active agent config
        const { data: agentConfig } = await supabase
          .from('agent_configs')
          .select('*')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();

        if (!agentConfig) {
          console.log(`[poll-heyreach-inbox] No active agent config for user ${userId}, skipping`);
          continue;
        }

        // Paginate through conversations using POST /inbox/GetConversationsV2
        let offset = 0;
        const limit = 100;
        let hasMore = true;

        while (hasMore) {
          const res = await fetch(`${HEYREACH_API}/inbox/GetConversationsV2`, {
            method: 'POST',
            headers: {
              'X-API-KEY': apiKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              filters: {
                linkedInAccountIds: [],
                campaignIds: [],
                searchString: '',
              },
              offset,
              limit,
            }),
          });

          if (!res.ok) {
            console.error(`[poll-heyreach-inbox] HeyReach API error for integration ${integration.id}: ${res.status}`);
            break;
          }

          const data = await res.json();
          const conversations = data.items || [];
          const totalCount = data.totalCount || 0;

          console.log(`[poll-heyreach-inbox] Fetched ${conversations.length} conversations (offset=${offset}, total=${totalCount})`);

          for (const convo of conversations) {
            try {
              const conversationId = convo.id;
              const linkedInAccountId = convo.linkedInAccountId;
              const lastMessageText = convo.lastMessageText || '';

              // Skip if no reply text
              if (!lastMessageText) continue;

              // Skip if last message was sent by us
              if (convo.lastMessageSender === 'ME') continue;

              const profile = convo.correspondentProfile || {};
              const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unknown';
              const linkedinUrl = profile.profileUrl || '';
              const externalId = conversationId;

              // Check if we already have this lead with the same last_reply_text
              const { data: existingLead } = await supabase
                .from('agent_leads')
                .select('id, last_reply_text')
                .eq('user_id', userId)
                .eq('external_id', externalId)
                .maybeSingle();

              // Skip if last_reply_text hasn't changed
              if (existingLead && existingLead.last_reply_text === lastMessageText) {
                continue;
              }

              totalPolled++;

              // Fetch full chatroom messages
              let replyThread: { role: string; content: string; timestamp: string; channel: string }[] = [];
              try {
                const chatroomRes = await fetch(
                  `${HEYREACH_API}/inbox/GetChatroom/${linkedInAccountId}/${conversationId}`,
                  {
                    headers: {
                      'X-API-KEY': apiKey,
                      'Accept': 'application/json',
                    },
                  },
                );

                if (chatroomRes.ok) {
                  const chatroom = await chatroomRes.json();
                  const messages = chatroom.messages || [];

                  replyThread = messages.map((msg: { sender?: string; body?: string; createdAt?: string }) => ({
                    role: msg.sender === 'ME' ? 'sender' : 'prospect',
                    content: msg.body || '',
                    timestamp: msg.createdAt || new Date().toISOString(),
                    channel: 'linkedin',
                  }));
                } else {
                  console.warn(`[poll-heyreach-inbox] GetChatroom ${res.status} for ${conversationId}`);
                }
              } catch (chatroomErr) {
                console.error(`[poll-heyreach-inbox] Failed to fetch chatroom for ${conversationId}:`, chatroomErr);
              }

              // Build upsert payload. Only tag lead_category on NEW leads:
              // HeyReach's GetConversationsV2 doesn't expose campaignId per conversation,
              // so polling can't reliably distinguish campaign replies from inbound.
              // Defaulting new polled leads to 'campaign_reply' matches the historical
              // behavior (polling was built for campaign follow-ups). For existing leads,
              // omitting the field preserves whatever the webhook already set — critical
              // so a later polling run can't overwrite an 'inbound_lead' tag.
              const upsertPayload: Record<string, unknown> = {
                user_id: userId,
                agent_config_id: agentConfig.id,
                external_id: externalId,
                full_name: fullName,
                linkedin_url: linkedinUrl,
                last_reply_text: lastMessageText,
                reply_thread: replyThread.length > 0 ? replyThread : undefined,
                inbox_status: 'pending',
                channel: 'linkedin',
                heyreach_conversation_id: conversationId,
                heyreach_account_id: linkedInAccountId,
              };

              if (!existingLead) {
                upsertPayload.lead_category = 'campaign_reply';
              }

              const { data: upsertedLead, error: upsertError } = await supabase
                .from('agent_leads')
                .upsert(upsertPayload, {
                  onConflict: 'user_id,external_id',
                  ignoreDuplicates: false,
                })
                .select()
                .single();

              if (upsertError) {
                console.error(`[poll-heyreach-inbox] Upsert error for ${externalId}:`, upsertError.message);
                continue;
              }

              if (upsertedLead && !existingLead) {
                totalNew++;

                // Log activity
                await supabase.from('agent_activity').insert({
                  user_id: userId,
                  agent_config_id: agentConfig.id,
                  lead_id: upsertedLead.id,
                  lead_name: fullName,
                  lead_company: profile.companyName || '',
                  activity_type: 'reply_received',
                  description: `LinkedIn reply detected via HeyReach polling from ${fullName}${profile.companyName ? ' at ' + profile.companyName : ''}`,
                  metadata: { channel: 'linkedin', intent: 'pending', source: 'heyreach_poll' },
                });
              }

              // Rate limit between chatroom fetches
              await new Promise(resolve => setTimeout(resolve, 200));

            } catch (convoErr) {
              console.error(`[poll-heyreach-inbox] Error processing conversation ${convo.id}:`, convoErr);
            }
          }

          offset += conversations.length;
          hasMore = conversations.length === limit && offset < totalCount;

          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      } catch (integrationErr) {
        console.error(`[poll-heyreach-inbox] Error processing integration ${integration.id}:`, integrationErr);
      }
    }

    console.log(`[poll-heyreach-inbox] Done. Polled: ${totalPolled}, New: ${totalNew}`);

    return new Response(JSON.stringify({ success: true, polled: totalPolled, new: totalNew }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[poll-heyreach-inbox] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
