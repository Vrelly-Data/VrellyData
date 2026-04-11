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
      // Cron call — process all users
      filterUserId = null;
    } else if (authHeader?.startsWith('Bearer ')) {
      // JWT call — process only this user
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

    // Fetch active Reply.io integrations
    let query = supabase
      .from('outbound_integrations')
      .select('id, created_by, team_id, api_key_encrypted')
      .eq('is_active', true)
      .eq('platform', 'reply.io');

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

    console.log(`[poll-reply-inbox] Processing ${integrations?.length ?? 0} integrations`);

    let totalProcessed = 0;
    let totalNew = 0;

    for (const integration of integrations ?? []) {
      try {
        const apiKey = integration.api_key_encrypted;
        if (!apiKey) {
          console.warn(`[poll-reply-inbox] No API key for integration ${integration.id}`);
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
          console.log(`[poll-reply-inbox] No active agent config for user ${userId}, skipping`);
          continue;
        }

        // Paginate through replied people
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const apiUrl = `https://api.reply.io/v1/people?page=${page}&limit=100&status=replied`;
          const res = await fetch(apiUrl, {
            headers: { 'X-Api-Key': apiKey },
          });

          if (!res.ok) {
            console.error(`[poll-reply-inbox] Reply.io API error for integration ${integration.id}: ${res.status}`);
            break;
          }

          const data = await res.json();
          const people = data.people || data || [];

          if (!Array.isArray(people) || people.length === 0) {
            hasMore = false;
            break;
          }

          // Filter to last 7 days
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

          for (const person of people) {
            try {
              const lastReplyDate = person.lastReplyDate || null;

              // Skip if reply is older than 7 days
              if (lastReplyDate && lastReplyDate < sevenDaysAgo) {
                continue;
              }

              const externalId = String(person.id);

              // Check if we already processed this lead recently
              const { data: existingLead } = await supabase
                .from('agent_leads')
                .select('id, last_reply_at')
                .eq('user_id', userId)
                .eq('external_id', externalId)
                .maybeSingle();

              // Skip if we already have this lead and last_reply_at hasn't changed
              if (existingLead) {
                const existingReplyAt = existingLead.last_reply_at;
                if (existingReplyAt && lastReplyDate) {
                  const existingDate = new Date(existingReplyAt).getTime();
                  const newDate = new Date(lastReplyDate).getTime();
                  if (Math.abs(existingDate - newDate) < 60000) {
                    continue;
                  }
                }
              }

              totalProcessed++;

              const fullName = [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Unknown';
              const channel = person.linkedInProfile ? 'linkedin' : 'email';

              const { data: upsertedLead, error: upsertError } = await supabase
                .from('agent_leads')
                .upsert({
                  user_id: userId,
                  agent_config_id: agentConfig.id,
                  external_id: externalId,
                  full_name: fullName,
                  email: person.email || '',
                  linkedin_url: person.linkedInProfile || '',
                  company: person.companyName || '',
                  channel,
                  pipeline_stage: 'replied',
                  inbox_status: 'pending',
                  last_reply_at: lastReplyDate || new Date().toISOString(),
                  last_reply_text: '',
                }, {
                  onConflict: 'user_id,external_id',
                  ignoreDuplicates: false,
                })
                .select()
                .single();

              if (upsertError) {
                console.error(`[poll-reply-inbox] Upsert error for ${externalId}:`, upsertError.message);
                continue;
              }

              if (upsertedLead) {
                totalNew++;

                // Log activity
                await supabase.from('agent_activity').insert({
                  user_id: userId,
                  agent_config_id: agentConfig.id,
                  lead_id: upsertedLead.id,
                  lead_name: fullName,
                  lead_company: person.companyName || '',
                  activity_type: 'reply_received',
                  description: `${channel === 'linkedin' ? 'LinkedIn' : 'Email'} reply detected via polling from ${fullName}${person.companyName ? ' at ' + person.companyName : ''}`,
                  metadata: { channel, intent: 'pending', source: 'poll' },
                });

                // Backfill reply text from Reply.io email activities
                try {
                  const activitiesRes = await fetch(
                    `https://api.reply.io/v1/people/${externalId}/emailactivities`,
                    { headers: { 'X-Api-Key': apiKey } },
                  );

                  if (activitiesRes.ok) {
                    const activitiesData = await activitiesRes.json();
                    const activities = Array.isArray(activitiesData) ? activitiesData : activitiesData.emailActivities || [];

                    // Build thread from all reply activities, sorted chronologically
                    const replyActivities = activities
                      .filter((a: any) => a.type === 'reply' || a.type === 'incoming' || a.direction === 'incoming')
                      .sort((a: any, b: any) => new Date(a.date || a.createdAt || 0).getTime() - new Date(b.date || b.createdAt || 0).getTime());

                    if (replyActivities.length > 0) {
                      const latestReply = replyActivities[replyActivities.length - 1];
                      const replyText = latestReply.body || latestReply.text || latestReply.message || '';

                      // Build thread history from all activities (sent + received)
                      const threadMessages = activities
                        .filter((a: any) => a.body || a.text || a.message)
                        .sort((a: any, b: any) => new Date(a.date || a.createdAt || 0).getTime() - new Date(b.date || b.createdAt || 0).getTime())
                        .map((a: any) => ({
                          role: (a.type === 'reply' || a.type === 'incoming' || a.direction === 'incoming') ? 'prospect' : 'sender',
                          content: a.body || a.text || a.message || '',
                          timestamp: a.date || a.createdAt || new Date().toISOString(),
                          channel,
                        }));

                      if (replyText) {
                        await supabase
                          .from('agent_leads')
                          .update({
                            last_reply_text: replyText,
                            reply_thread: threadMessages.length > 0 ? threadMessages : undefined,
                          })
                          .eq('id', upsertedLead.id);

                        console.log(`[poll-reply-inbox] Backfilled reply text for ${externalId} (${replyText.length} chars, ${threadMessages.length} messages)`);
                      }
                    }
                  } else {
                    console.log(`[poll-reply-inbox] Email activities API returned ${activitiesRes.status} for ${externalId}`);
                  }
                } catch (activityErr) {
                  console.error(`[poll-reply-inbox] Failed to fetch email activities for ${externalId}:`, activityErr);
                }

              }
            } catch (personErr) {
              console.error(`[poll-reply-inbox] Error processing person ${person.id}:`, personErr);
            }
          }

          // Check for more pages
          if (people.length < 100) {
            hasMore = false;
          } else {
            page++;
          }
        }
      } catch (integrationErr) {
        console.error(`[poll-reply-inbox] Error processing integration ${integration.id}:`, integrationErr);
      }
    }

    console.log(`[poll-reply-inbox] Done. Processed: ${totalProcessed}, New leads: ${totalNew}`);

    return new Response(JSON.stringify({ success: true, processed: totalProcessed, new: totalNew }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[poll-reply-inbox] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
