/*
-- Required schema changes:
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_conversation_id TEXT;
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_account_id INTEGER;
ALTER TABLE public.synced_campaigns ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'reply_io';
*/

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { shouldResurface } from '../_shared/inbox-reply.ts';
import { cleanReplyPreview } from '../_shared/reply-text.ts';
import { sanitizeLinkedinUrlForStorage } from '../_shared/normalize.ts';
import { findLeadByNormalizedLinkedIn } from '../_shared/agent-leads-lookup.ts';
import { isStaleProspectMessage } from '../_shared/stale.ts';
import { decideSurfaceAndClassify, buildSurfaceUpdateFields } from '../_shared/surface.ts';
import { walkWithState, type StopReason, type WalkState, DEFAULT_PAGER_OPTIONS } from './paging.ts';

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

    // Fetch active HeyReach integrations (include persistent state)
    let query = supabase
      .from('outbound_integrations')
      .select('id, created_by, api_key_encrypted, heyreach_poll_state')
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

    // Order integrations by lastTick.at ascending, nulls first
    const ordered = (integrations ?? []).slice().sort((a: any, b: any) => {
      const aAt = Date.parse((a?.heyreach_poll_state?.lastTick?.at as string) || '');
      const bAt = Date.parse((b?.heyreach_poll_state?.lastTick?.at as string) || '');
      const aVal = Number.isFinite(aAt) ? aAt : Number.NEGATIVE_INFINITY;
      const bVal = Number.isFinite(bAt) ? bAt : Number.NEGATIVE_INFINITY;
      return aVal - bVal;
    });

    const startedAtMs = Date.now();
    const deadline = startedAtMs + DEFAULT_PAGER_OPTIONS.runBudgetMs;
    const remaining = () => Math.max(0, deadline - Date.now());

    type PerIntegrationSummary = {
      integrationId: string;
      stopReason: StopReason;
      pagesFetched: number;
      conversationsProcessed: number;
      failures: number;
      walkStartedAt: string | null;
      walkOffset: number | null;
      baselineStartedAt: string | null;
    };
    const perIntegration: PerIntegrationSummary[] = [];
    let overallStop: StopReason | null = null;

    for (const integration of ordered) {
      try {
        const apiKey = integration.api_key_encrypted;
        if (!apiKey) {
          console.warn(`[poll-heyreach-inbox] No API key for integration ${integration.id}`);
          integrationsSkippedNoKey++;
          continue;
        }

        const userId = integration.created_by;
        // Skip starting when not enough remaining budget
        if (remaining() < DEFAULT_PAGER_OPTIONS.minRemainingForNextPageMs) {
          perIntegration.push({
            integrationId: integration.id,
            stopReason: 'time_budget',
            pagesFetched: 0,
            conversationsProcessed: 0,
            failures: 0,
            walkStartedAt: (integration?.heyreach_poll_state?.walk?.startedAt as string) ?? null,
            walkOffset: (integration?.heyreach_poll_state?.walk?.offset as number) ?? null,
            baselineStartedAt: (integration?.heyreach_poll_state?.baselineStartedAt as string) ?? null,
          });
          continue;
        }

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

        // ==== Budgeted walk with persistent state ============================
        const rawState = (integration?.heyreach_poll_state as WalkState) ?? {};
        const stateIn: WalkState = (rawState && typeof rawState === 'object' && 'version' in rawState)
          ? rawState as WalkState
          : { version: 1, baselineStartedAt: null, walk: null };
        const walker = await walkWithState<any>(
          {
            async fetchPage(offset, limit, signal) {
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
                    campaignIds: campaignIdFilter,
                    searchString: '',
                  },
                  offset,
                  limit,
                }),
                signal: AbortSignal.timeout(Math.max(1_000, Math.min(DEFAULT_PAGER_OPTIONS.pageFetchTimeoutMs, Math.max(0, remaining() - 5_000)))),
              });
              if (!res.ok) {
                const t = await res.text().catch(() => '');
                console.error(`[poll-heyreach-inbox] HeyReach API error for integration ${integration.id}: ${res.status} ${t.slice(0, 160)}`);
                throw new Error(`fetch_error_${res.status}`);
              }
              const data = await res.json();
              const conversations = Array.isArray(data?.items) ? data.items : [];
              const totalCount = Number.isFinite(Number(data?.totalCount)) ? Number(data.totalCount) : 0;
              console.log(`[poll-heyreach-inbox] Fetched ${conversations.length} conversations (offset=${offset}, total=${totalCount})`);
              totalConversationsSeen += conversations.length;
              return { items: conversations, totalCount };
            },
            async processItem(convo: any, signal) {
              try {
                const conversationId = convo.id;
                const linkedInAccountId = convo.linkedInAccountId;
                const lastMessageText = convo.lastMessageText || '';

                if (!lastMessageText) {
                  skippedNoText++;
                  return;
                }

                if (convo.lastMessageSender === 'ME') {
                  skippedSenderMe++;
                  return;
                }

                const profile = convo.correspondentProfile || {};
                const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unknown';
                const linkedinUrlRaw = profile.profileUrl || '';
                const linkedinUrl = sanitizeLinkedinUrlForStorage(linkedinUrlRaw);
                const externalId = conversationId;

                // Without a linkedin_url we have no dedup key (the unique
                // index would let every poll create a new row). Skip and
                // log so we can investigate malformed correspondentProfile
                // payloads in the field.
                if (!linkedinUrl) {
                  console.warn(
                    `[poll-heyreach-inbox] Skipping conversation ${conversationId} — no profileUrl on correspondentProfile`,
                  );
                  return;
                }

                // Existing-lead lookup on (user_id, normalized linkedin_url).
                // If linkedin_url is missing we fall back to external_id so legacy rows still resolve.
                let existingLead: {
                  id: string;
                  last_reply_text: string | null;
                  disposition_tag: string | null;
                  last_surfaced_reply_at: string | null;
                  inbox_status?: string | null;
                } | null = null;
                if (linkedinUrl) {
                  const found = await findLeadByNormalizedLinkedIn(supabase, userId, linkedinUrl);
                  existingLead = found
                    ? {
                        id: found.id,
                        last_reply_text: found.last_reply_text ?? null,
                        disposition_tag: found.disposition_tag,
                        last_surfaced_reply_at: found.last_surfaced_reply_at,
                        // @ts-ignore extend shape locally for pending-check
                        inbox_status: (found as any).inbox_status ?? null,
                      } as any
                    : null;
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
                  return;
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
                      signal: AbortSignal.timeout(DEFAULT_PAGER_OPTIONS.itemFetchTimeoutMs),
                    },
                  );

                  if (chatroomRes.ok) {
                    const chatroom = await chatroomRes.json();
                    const messages = chatroom.messages || [];

                    replyThread = messages.map((msg: { sender?: string; body?: string; createdAt?: string }) => ({
                      role: msg.sender === 'ME' ? 'sender' : 'prospect',
                      content: msg.body || '',
                      // Keep raw timestamp; missing stays empty (treated as stale in gate)
                      timestamp: msg.createdAt || '',
                      channel: 'linkedin',
                    }));
                  } else {
                    // Deviation from main: If GetChatroom fails, abort this item by throwing
                    // so the walker counts a failure and the baseline will NOT advance.
                    // This avoids writing last_reply_text with an empty thread and then
                    // skipping on same-text in later runs.
                    throw new Error(`getchatroom_${chatroomRes.status}`);
                  }
                } catch (chatroomErr) {
                  console.error(`[poll-heyreach-inbox] Failed to fetch chatroom for ${conversationId}:`, chatroomErr);
                  // Abort this item for the same reason as above.
                  throw chatroomErr;
                }

                // ---- Surface gate (VERBATIM from main) ---------------------
                // Newest PROSPECT message timestamp (raw, no fallback to now)
                const newestProspect = replyThread
                  .filter((e) => e.role === 'prospect')
                  .reduce<{ timestamp: string | null } | null>(
                    (a, b) => {
                      const bt = b?.timestamp ? Date.parse(b.timestamp) : NaN;
                      if (!Number.isFinite(bt)) return a;
                      if (!a) return { timestamp: b.timestamp };
                      const at = a.timestamp ? Date.parse(a.timestamp) : NaN;
                      return (!Number.isFinite(at) || bt > at) ? { timestamp: b.timestamp } : a;
                    },
                    null
                  );
                const newestProspectTs = newestProspect?.timestamp ?? null;
                const newestMs = newestProspectTs ? Date.parse(newestProspectTs) : NaN;
                const priorMs = existingLead?.last_surfaced_reply_at
                  ? Date.parse(existingLead.last_surfaced_reply_at)
                  : 0;
                const newerThanPrior = Number.isFinite(newestMs) && newestMs > priorMs;
                // Surface/classify decision (centralized)
                const decision = decideSurfaceAndClassify({
                  dispositionTag: existingLead?.disposition_tag ?? null,
                  isExistingLead: !!existingLead,
                  newestProspectTimestamp: newestProspectTs,
                  priorWatermark: existingLead?.last_surfaced_reply_at ?? null,
                  nowMs: Date.now(),
                });
                const surface = decision.surface;
                const stale = decision.isStale;

                const surfaceFields = buildSurfaceUpdateFields(decision, {
                  isExistingLead: !!existingLead,
                  alreadyPending: existingLead?.inbox_status === 'pending',
                });

                const upsertPayload: Record<string, unknown> = {
                  user_id: userId,
                  agent_config_id: agentConfig.id,
                  external_id: externalId,
                  full_name: fullName,
                  linkedin_url: linkedinUrl,
                  last_reply_text: cleanReplyPreview(lastMessageText),
                  ...(newestProspectTs ? { last_reply_at: newestProspectTs } : {}),
                  reply_thread: replyThread.length > 0 ? replyThread : undefined,
                  ...surfaceFields,
                  channel: 'linkedin',
                  source: 'heyreach',
                  heyreach_conversation_id: conversationId,
                  heyreach_account_id: linkedInAccountId,
                };

                // Deterministic save: update-or-insert with 23505 retry
                let savedRow: Record<string, unknown> | null = null;
                if (existingLead?.id) {
                  const { data: updated, error: updateErr } = await supabase
                    .from('agent_leads')
                    .update(upsertPayload)
                    .eq('id', existingLead.id)
                    .select()
                    .single();
                  if (updateErr) {
                    console.error(`[poll-heyreach-inbox] UPDATE error for ${externalId}:`, updateErr.message);
                    return;
                  }
                  savedRow = updated as Record<string, unknown>;
                } else {
                  const { data: inserted, error: insertErr } = await supabase
                    .from('agent_leads')
                    .insert(upsertPayload)
                    .select()
                    .single();
                  if (insertErr && (insertErr as { code?: string }).code === '23505') {
                    // Race: another writer created the row — reselect and update
                    const raced = await findLeadByNormalizedLinkedIn(supabase, userId, linkedinUrl);
                    if (raced?.id) {
                      const { data: updated2, error: updateErr2 } = await supabase
                        .from('agent_leads')
                        .update(upsertPayload)
                        .eq('id', raced.id)
                        .select()
                        .single();
                      if (updateErr2) {
                        console.error(`[poll-heyreach-inbox] UPDATE-after-23505 failed for ${externalId}:`, updateErr2.message);
                        return;
                      }
                      savedRow = updated2 as Record<string, unknown>;
                    } else {
                      console.error(`[poll-heyreach-inbox] 23505 on INSERT but reselect found no row for ${externalId}`);
                      return;
                    }
                  } else if (insertErr) {
                    console.error(`[poll-heyreach-inbox] INSERT error for ${externalId}:`, insertErr.message);
                    return;
                  } else {
                    savedRow = inserted as Record<string, unknown>;
                  }
                }

                // Log the gate decision for observability
                console.log(`[poll-heyreach-inbox] gate: stale=${stale} ts=${newestProspectTs ?? 'null'} willClassify=${decision.willClassify}`);

                if (surface && savedRow) {
                  // Drafting kill switch: HeyReach drafting disabled.
                  // Re-enable later only behind an explicit flag that defaults OFF.
                  console.log("[poll-heyreach-inbox] HeyReach drafting disabled (kill switch)");
                }

                if (savedRow && !existingLead) {
                  totalNew++;

                  // Log activity
                  await supabase.from('agent_activity').insert({
                    user_id: userId,
                    agent_config_id: agentConfig.id,
                    // deno-lint-ignore no-explicit-any
                    lead_id: (savedRow as any).id,
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
                // failures counted inside walker via thrown error in processItem
                throw convoErr;
              }
            },
            nowMs: () => Date.now(),
            sleepMs: (ms: number) => new Promise((r) => setTimeout(r, ms)),
            async saveState(next: WalkState) {
              const { error } = await supabase
                .from('outbound_integrations')
                .update({ heyreach_poll_state: next as any })
                .eq('id', integration.id);
              if (error) throw error;
            },
          },
          stateIn,
          {
            ...DEFAULT_PAGER_OPTIONS,
            runBudgetMs: remaining(),
          },
        );

        // Persist final state from walker (already saved in-page and on stop)
        const { error: finalSaveErr } = await supabase
          .from('outbound_integrations')
          .update({ heyreach_poll_state: walker.state as any })
          .eq('id', integration.id);
        if (finalSaveErr) {
          console.error('[poll-heyreach-inbox] final saveState error:', finalSaveErr);
        }

        // Summarize
        perIntegration.push({
          integrationId: integration.id,
          stopReason: walker.stopReason,
          pagesFetched: walker.pagesFetched,
          conversationsProcessed: walker.itemsProcessed,
          failures: walker.failures,
          walkStartedAt: walker.state.walk?.startedAt ?? null,
          walkOffset: walker.state.walk?.offset ?? null,
          baselineStartedAt: walker.state.baselineStartedAt ?? null,
        });
        // Precedence: fetch_error > time_budget > others
        if (walker.stopReason === 'fetch_error') {
          overallStop = 'fetch_error';
        } else if (walker.stopReason === 'time_budget' && overallStop !== 'fetch_error') {
          overallStop = 'time_budget';
        } else if (!overallStop) {
          overallStop = walker.stopReason;
        }
        console.log(
          `[poll-heyreach-inbox] integration ${integration.id} summary: pages=${walker.pagesFetched}, items=${walker.itemsProcessed}, failures=${walker.failures}, stop=${walker.stopReason}`,
        );
      } catch (integrationErr) {
        console.error(`[poll-heyreach-inbox] Error processing integration ${integration.id}:`, integrationErr);
        perIntegration.push({
          integrationId: integration.id,
          stopReason: 'fetch_error',
          pagesFetched: 0,
          conversationsProcessed: 0,
          failures: 0,
          walkStartedAt: (integration?.heyreach_poll_state?.walk?.startedAt as string) ?? null,
          walkOffset: (integration?.heyreach_poll_state?.walk?.offset as number) ?? null,
          baselineStartedAt: (integration?.heyreach_poll_state?.baselineStartedAt as string) ?? null,
        });
        if (overallStop !== 'fetch_error') overallStop = 'fetch_error';
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
        stopReason: overallStop ?? 'end_of_list',
        elapsedMs: Date.now() - startedAtMs,
        perIntegration,
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
