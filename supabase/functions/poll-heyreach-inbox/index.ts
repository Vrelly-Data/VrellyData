/*
-- Required schema changes:
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_conversation_id TEXT;
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_account_id INTEGER;
ALTER TABLE public.synced_campaigns ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'reply_io';
*/

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { shouldResurface, fireClassifyReply } from '../_shared/inbox-reply.ts';
import { cleanReplyPreview } from '../_shared/reply-text.ts';

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

  console.log(`[poll-heyreach-inbox] START method=${req.method}`);

  try {
    // Auth: x-agent-key for cron, or JWT for manual trigger
    const agentKey = req.headers.get('x-agent-key');
    const expectedKey = Deno.env.get('AGENT_API_KEY');
    const authHeader = req.headers.get('authorization');

    let filterUserId: string | null = null;

    if (agentKey && agentKey === expectedKey) {
      console.log('[poll-heyreach-inbox] auth=agent_key (cron path), filterUserId=null');
      filterUserId = null;
    } else if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        console.warn('[poll-heyreach-inbox] auth=bearer but getUser returned null → 401');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      filterUserId = user.id;
      console.log(`[poll-heyreach-inbox] auth=bearer, filterUserId=${filterUserId}`);
    } else {
      console.warn(
        `[poll-heyreach-inbox] auth=missing → 401. agentKey_present=${!!agentKey} agentKey_match=${!!agentKey && agentKey === expectedKey} expectedKey_present=${!!expectedKey} authHeader_present=${!!authHeader}`,
      );
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

    console.log(
      `[poll-heyreach-inbox] Found ${integrations?.length ?? 0} active heyreach integrations` +
        (integrations && integrations.length > 0
          ? ` (ids: ${integrations.map((i) => i.id).join(',')})`
          : ''),
    );

    let totalPolled = 0;
    let totalNew = 0;
    let totalConversationsSeen = 0;
    let skippedNoText = 0;
    let skippedSenderMe = 0;
    let skippedSameText = 0;
    let integrationsSkippedNoKey = 0;
    let integrationsSkippedAllDisabled = 0;
    let integrationsSkippedNoAgentConfig = 0;

    for (const integration of integrations ?? []) {
      try {
        const apiKey = integration.api_key_encrypted;
        if (!apiKey) {
          console.warn(`[poll-heyreach-inbox] No API key for integration ${integration.id}`);
          integrationsSkippedNoKey++;
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
          integrationsSkippedNoAgentConfig++;
          continue;
        }

        // === Capture Scope gate ==============================================
        // Enforcement point 4 of 4, and the reason HeyReach needed its own
        // stage. This poller is a lead-CREATING path that bypasses points 1-3
        // entirely: it reads the whole inbox rather than reacting to a webhook.
        //
        // It also has no attribution to filter on after the fact — verified
        // against the live API, a GetConversationsV2 conversation carries
        // id/read/groupChat/lastMessage*/linkedInAccountId/correspondentProfile
        // and NO campaign field whatsoever. So the scope must be applied at the
        // REQUEST, via the campaignIds filter. Confirmed additive against prod:
        // 518402 alone = 49, 508828 alone = 39, both = 88; all three with
        // 507230 = 129. It is a true multi-value allow-list, not first-id-wins.
        //
        // THE TRAP: campaignIds: [] means "every campaign", so "nothing is
        // enabled" and "nothing is synced yet" must not produce the same
        // request. They are handled as three distinct cases below.
        const { data: scopeRows, error: scopeErr } = await supabase
          .from('synced_campaigns')
          .select('external_campaign_id, capture_enabled')
          .eq('integration_id', integration.id);

        let campaignIdFilter: number[] = [];
        if (scopeErr) {
          // Fail open — a transient lookup failure must not silently stop
          // capture for a whole integration.
          console.warn(
            `[poll-heyreach-inbox] capture scope lookup failed for integration ` +
            `${integration.id} (${scopeErr.message}) — polling unfiltered (fail-open)`,
          );
        } else if (!scopeRows || scopeRows.length === 0) {
          // Case A: campaigns have never been synced for this integration.
          // Filtering on an empty allow-list would mean "all" anyway, and this
          // is indistinguishable from a brand-new integration, so poll
          // unfiltered exactly as before.
          console.log(
            `[poll-heyreach-inbox] No synced campaigns for integration ${integration.id} — ` +
            `polling unfiltered (run sync-heyreach-campaigns to enable scoping)`,
          );
        } else {
          const enabled = scopeRows
            .filter((r) => r.capture_enabled === true)
            .map((r) => Number(r.external_campaign_id))
            .filter((n) => Number.isFinite(n));

          if (enabled.length === 0) {
            // Case C: campaigns exist and the operator has disabled ALL of
            // them. Passing [] here would poll everything — the exact opposite
            // of what was asked for. Skip the integration instead.
            console.log(
              `[poll-heyreach-inbox] All ${scopeRows.length} campaign(s) have capture disabled ` +
              `for integration ${integration.id} — skipping entirely`,
            );
            integrationsSkippedAllDisabled++;
            continue;
          }
          // Case B: scope to the enabled campaigns.
          campaignIdFilter = enabled;
          console.log(
            `[poll-heyreach-inbox] Scoping to ${enabled.length} of ${scopeRows.length} ` +
            `campaign(s) with capture enabled for integration ${integration.id}`,
          );
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
                // Capture Scope: [] means "all campaigns". Populated only in
                // case B above; cases A and the fail-open path deliberately
                // leave it empty, and case C never reaches this call.
                campaignIds: campaignIdFilter,
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

          totalConversationsSeen += conversations.length;

          for (const convo of conversations) {
            try {
              const conversationId = convo.id;
              const linkedInAccountId = convo.linkedInAccountId;
              const lastMessageText = convo.lastMessageText || '';

              if (!lastMessageText) {
                skippedNoText++;
                continue;
              }

              if (convo.lastMessageSender === 'ME') {
                skippedSenderMe++;
                continue;
              }

              const profile = convo.correspondentProfile || {};
              const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unknown';
              const linkedinUrlRaw = profile.profileUrl || '';
              const linkedinUrl = linkedinUrlRaw.trim() || null;
              const externalId = conversationId;

              // Without a linkedin_url we have no dedup key (the unique
              // index would let every poll create a new row). Skip and
              // log so we can investigate malformed correspondentProfile
              // payloads in the field.
              if (!linkedinUrl) {
                console.warn(
                  `[poll-heyreach-inbox] Skipping conversation ${conversationId} — no profileUrl on correspondentProfile`,
                );
                continue;
              }

              // Existing-lead lookup on (user_id, linkedin_url) — matches the
              // unique-index dedup key. If linkedin_url is missing we fall back
              // to external_id so legacy rows still resolve.
              let existingLead: {
                id: string;
                last_reply_text: string | null;
                disposition_tag: string | null;
                last_surfaced_reply_at: string | null;
              } | null = null;
              if (linkedinUrl) {
                const { data } = await supabase
                  .from('agent_leads')
                  .select('id, last_reply_text, disposition_tag, last_surfaced_reply_at')
                  .eq('user_id', userId)
                  .eq('linkedin_url', linkedinUrl)
                  .maybeSingle();
                existingLead = data ?? null;
              }
              if (!existingLead && externalId) {
                const { data } = await supabase
                  .from('agent_leads')
                  .select('id, last_reply_text, disposition_tag, last_surfaced_reply_at')
                  .eq('user_id', userId)
                  .eq('external_id', externalId)
                  .maybeSingle();
                existingLead = data ?? null;
              }

              if (existingLead && existingLead.last_reply_text === lastMessageText) {
                skippedSameText++;
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

              // ---- Surface gate -------------------------------------------
              // This upsert used to hard-code inbox_status:'pending', so EVERY
              // conversation it wrote became actionable — including history it
              // was seeing for the first time. When the poller's stale-key 401
              // was fixed it ingested 257 previously-invisible conversations for
              // one client, 204 of them over 90 days old and the oldest from
              // 2024, straight into Pending Approval. Backfilled history is not
              // work to do today.
              //
              // Mirrors poll-reply-inbox exactly (shared shouldResurface for the
              // existing-lead case, a 24h recency gate for first sight) so the
              // two pollers agree on what "actionable" means:
              //   existing lead → resurface only on a genuinely NEW inbound that
              //                   is newer than the surface watermark and not
              //                   suppressed by disposition; otherwise LEAVE THE
              //                   STATUS ALONE (omitted from the payload, so a
              //                   dismissal sticks).
              //   new lead      → 'pending' only if the newest message is an
              //                   inbound reply from the last 24h; else
              //                   'mirrored' (in neither inbox tab, still fully
              //                   readable and still resurfaceable later).
              const newest = replyThread.length > 0
                ? replyThread.reduce((a, b) =>
                    Date.parse(b.timestamp || '') > Date.parse(a.timestamp || '') ? b : a)
                : null;
              const newestRole = newest?.role ?? null;
              const newestMs = newest ? Date.parse(newest.timestamp || '') : NaN;
              const priorMs = existingLead?.last_surfaced_reply_at
                ? Date.parse(existingLead.last_surfaced_reply_at)
                : 0;
              const newerThanPrior = Number.isFinite(newestMs) && newestMs > priorMs;
              const isRecent = Number.isFinite(newestMs)
                ? newestMs >= Date.now() - 24 * 60 * 60 * 1000
                : false;

              const surface = existingLead
                ? shouldResurface({
                    dispositionTag: existingLead.disposition_tag,
                    newestRole,
                    newerThanPrior,
                  })
                : (newestRole === 'prospect' && isRecent);

              const upsertPayload: Record<string, unknown> = {
                user_id: userId,
                agent_config_id: agentConfig.id,
                external_id: externalId,
                full_name: fullName,
                linkedin_url: linkedinUrl,
                last_reply_text: cleanReplyPreview(lastMessageText),
                reply_thread: replyThread.length > 0 ? replyThread : undefined,
                // Omitted entirely for an existing lead we are not surfacing —
                // an omitted column is preserved on conflict, so a dismissal is
                // not silently undone. A brand-new lead needs an explicit value.
                ...(surface
                  ? { inbox_status: 'pending', last_surfaced_reply_at: newest?.timestamp ?? null }
                  : existingLead ? {} : { inbox_status: 'mirrored' }),
                channel: 'linkedin',
                source: 'heyreach',
                heyreach_conversation_id: conversationId,
                heyreach_account_id: linkedInAccountId,
              };

              const { data: upsertedLead, error: upsertError } = await supabase
                .from('agent_leads')
                .upsert(upsertPayload, {
                  onConflict: 'user_id,linkedin_url',
                  ignoreDuplicates: false,
                })
                .select()
                .single();

              if (upsertError) {
                console.error(`[poll-heyreach-inbox] Upsert error for ${externalId}:`, upsertError.message);
                continue;
              }

              // Trigger a draft, exactly as poll-reply-inbox does — same shared
              // helper, same gate. This poller previously NEVER drafted, so a
              // reply the webhook missed surfaced to Pending Approval with an
              // empty draft.
              //
              // Gated on `surface`, which is what makes this safe against
              // double-drafting alongside heyreach-webhook. Both paths write
              // last_surfaced_reply_at now, so for a reply the webhook already
              // handled the gate computes newestMs > priorMs with the two equal
              // → false → no second call. The skippedSameText guard above is
              // NOT the interlock: it compares our stored text against
              // GetConversationsV2's lastMessageText, and misses whenever a
              // sibling conversation for the same profile holds different text
              // (73 such profiles in prod — see the collision note).
              if (surface && upsertedLead) {
                fireClassifyReply({
                  supabaseUrl,
                  agentKey: expectedKey || '',
                  leadId: upsertedLead.id,
                  replyText: lastMessageText,
                  threadHistory: replyThread,
                  agentConfig,
                  channel: 'linkedin',
                  userId,
                });
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

    console.log(
      `[poll-heyreach-inbox] Done. polled=${totalPolled} new=${totalNew} seen=${totalConversationsSeen} ` +
        `skippedNoText=${skippedNoText} skippedSenderMe=${skippedSenderMe} skippedSameText=${skippedSameText} ` +
        `intSkipNoKey=${integrationsSkippedNoKey} intSkipNoAgentConfig=${integrationsSkippedNoAgentConfig}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        polled: totalPolled,
        new: totalNew,
        seen: totalConversationsSeen,
        integrations: integrations?.length ?? 0,
        skipped: {
          noText: skippedNoText,
          senderMe: skippedSenderMe,
          sameText: skippedSameText,
          integrationsNoKey: integrationsSkippedNoKey,
          integrationsNoAgentConfig: integrationsSkippedNoAgentConfig,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('[poll-heyreach-inbox] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
