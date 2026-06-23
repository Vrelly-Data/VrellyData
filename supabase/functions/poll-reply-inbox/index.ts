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

// ---------------------------------------------------------------------------
// Reply.io v3 (deprecated v1 paths removed — Foundation phase 3/6).
//
// Backstop poll for the agent inbox: catches replies the webhook missed.
// Cron auth via x-agent-key, manual trigger via user JWT — unchanged.
//
// Auth swap: X-Api-Key → Authorization: Bearer (matches the template
// established in 8a37994 / 0939c1d / 7503756).
//
// Endpoint swaps:
//   GET /v1/people?page=N&limit=100&status=replied
//     → GET /v3/contacts?status=replied&top=100&skip=K  (items[]/hasMore)
//   GET /v1/people/{id}/emailactivities
//     → GET /v3/contacts/{id}/activities  (shape unverified — see below)
//
// Field-name remaps (verified from the live spike against CYPR):
//   person.companyName       → contact.company
//   person.linkedInProfile   → contact.linkedInUrl  (capital I-n)
//   person.id                → contact.id (numeric, unchanged)
//   person.email / firstName / lastName / title — same names, no remap
//
// `lastReplyDate` proxy: v3 /contacts response does NOT include a
// per-contact "last replied" timestamp. The 30 verified top-level keys
// have addingDate / createdAt / lastModifiedAt but no reply-specific
// time. We use `lastModifiedAt` as the closest proxy for the 7-day
// recency filter and the existing-lead-skip-by-time check. Tradeoff:
// any contact modification (not just a reply) bumps lastModifiedAt, so
// some non-reply changes may flow through to the re-classify path —
// but the upsert + classify-reply are idempotent enough that this is
// wasted work, not corruption. If precision matters, future work can
// derive the real last-reply timestamp from /v3/contacts/{id}/activities.
//
// Activities endpoint shape (/v3/contacts/{id}/activities) is UNVERIFIED.
// First call logs:
//   * whether the response is a direct array or an envelope (items[])
//   * the keys of the first activity object
//   * a presence check across [type, direction, body, text, message,
//     date, createdAt, occurredAt] so we can confirm the field names
//     against live data before trusting the thread parse.
// fetchContactActivitiesV3 then returns the unwrapped array; the loop
// parses defensively with ?? chains across the candidate field names.
// ---------------------------------------------------------------------------

const REPLY_API_V3 = 'https://api.reply.io/v3';

interface V3Contact {
  id: number;
  email?: string;
  firstName?: string;
  lastName?: string;
  // Verified field names from sync-reply-contacts spike:
  company?: string;                                  // NOT companyName
  linkedInUrl?: string;                              // NOT linkedInProfile
  title?: string;
  isOptedOut?: boolean;
  addingDate?: string;
  createdAt?: string;
  lastModifiedAt?: string;                           // proxy for v1's lastReplyDate
  sequences?: unknown[];
}

interface V3ContactsPage {
  items?: V3Contact[];
  hasMore?: boolean;
}

// V3 activity shape — verified live via probe against CYPR. Top-level
// keys: id, date, activityType, sourceType, userName, userId, content.
// `content` is an OBJECT (not a string like v1 body). The reply-specific
// `activityType` enum value is unknown — dev workspace contains only
// CSV-imported leads with MoveToCampaign + Creation activities, no real
// engagement. Defensive substring matching below + runtime logging will
// surface the reply value the first time this runs against prod data.
interface V3Activity {
  id?: number | string;
  date?: string;                                              // timestamp (verified)
  activityType?: string;                                      // v3 discriminator (replaces v1 type/direction)
  sourceType?: string;                                        // workspace source (CsvImport / etc.)
  content?: string | Record<string, unknown> | unknown;       // v3: OBJECT not string
  userId?: number;
  userName?: unknown;                                         // observed as object — not used
}

// Bearer-authed v3 fetcher — identical to sync-reply-contacts' fetchV3.
async function fetchV3<T = unknown>(endpoint: string, apiKey: string): Promise<T> {
  const response = await fetch(`${REPLY_API_V3}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reply.io v3 API error (${response.status}): ${errorText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchV3WithRetry<T = unknown>(
  endpoint: string,
  apiKey: string,
  maxRetries: number = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchV3<T>(endpoint, apiKey);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isRateLimit = msg.includes('Too much requests') || msg.includes('(429)');
      if (isRateLimit && attempt < maxRetries) {
        const waitMs = 5000 * attempt;
        console.log(`Rate limited on ${endpoint}, waiting ${waitMs / 1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Paginate /v3/contacts?status=replied with top + skip; same pattern as
// sync-reply-contacts' fetchAllContactsV3. Stops on hasMore=false, short
// read, or 100k safety cap. Bounded inter-page sleep so we don't hammer.
async function fetchAllRepliedContactsV3(
  apiKey: string,
  pageSize: number = 100,
  maxPages: number = 2,
): Promise<V3Contact[]> {
  const all: V3Contact[] = [];
  let skip = 0;
  for (let page = 1; page <= maxPages; page++) {
    const url = `/contacts?status=replied&top=${pageSize}&skip=${skip}`;
    const resp = await fetchV3WithRetry<V3ContactsPage>(url, apiKey);
    const items = Array.isArray(resp.items) ? resp.items : [];
    if (items.length === 0) break;
    all.push(...items);
    console.log(`  /contacts?status=replied page ${page} (skip=${skip}): fetched ${items.length}, total ${all.length}`);
    if (resp.hasMore === false) break;
    if (items.length < pageSize) break;
    skip += items.length;
    if (all.length > 100000) {
      console.warn(`Reached safety cap (100k contacts); stopping pagination`);
      break;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

// Module-scope tripwire: log activity-response shape ONCE per worker
// process. Fires on the first /v3/contacts/{id}/activities call that
// returns a non-empty result. After we read this off a live dev run we
// can tighten the defensive parsing (or replace it with verified field
// names).
let loggedFirstActivityShape = false;

async function fetchContactActivitiesV3(
  contactId: number | string,
  apiKey: string,
): Promise<V3Activity[]> {
  const resp = await fetchV3WithRetry<unknown>(`/contacts/${contactId}/activities?top=100`, apiKey);

  // Discover envelope: direct array vs paginated object.
  let activities: V3Activity[] = [];
  let envelope: 'direct-array' | 'object-items' | 'object-activities' | 'object-emailActivities' | 'unknown';
  if (Array.isArray(resp)) {
    activities = resp as V3Activity[];
    envelope = 'direct-array';
  } else if (resp && typeof resp === 'object') {
    const obj = resp as Record<string, unknown>;
    if (Array.isArray(obj.items)) { activities = obj.items as V3Activity[]; envelope = 'object-items'; }
    else if (Array.isArray(obj.activities)) { activities = obj.activities as V3Activity[]; envelope = 'object-activities'; }
    else if (Array.isArray(obj.emailActivities)) { activities = obj.emailActivities as V3Activity[]; envelope = 'object-emailActivities'; }
    else { envelope = 'unknown'; }
  } else {
    envelope = 'unknown';
  }

  // First-call shape log — prints once per worker process lifetime,
  // gated on a non-empty activities array. Surfaces the activityType
  // distribution + content sub-keys so we can identify the reply-specific
  // vocabulary the first time this fires against a workspace with real
  // email replies. (Dev workspace only had CsvImport/MoveToCampaign/
  // Creation lifecycle events — no reply activityType values seen.)
  if (!loggedFirstActivityShape && activities.length > 0) {
    const first = activities[0] as Record<string, unknown>;
    console.log(`[/v3/contacts/{id}/activities] first-call envelope: ${envelope} (sample contactId=${contactId}, len=${activities.length})`);
    console.log(`[/v3/contacts/{id}/activities] first activity top-level keys:`, Object.keys(first));

    const activityTypes = [...new Set(activities.map(a => String((a as Record<string, unknown>).activityType ?? '(absent)')))];
    const sourceTypes = [...new Set(activities.map(a => String((a as Record<string, unknown>).sourceType ?? '(absent)')))];
    console.log(`[/v3/contacts/{id}/activities] activityType values in batch:`, activityTypes);
    console.log(`[/v3/contacts/{id}/activities] sourceType values in batch:`, sourceTypes);

    // If content is an object, log its sub-keys so we know which
    // child field carries the message body.
    if (first.content && typeof first.content === 'object') {
      console.log(`[/v3/contacts/{id}/activities] first activity content sub-keys:`, Object.keys(first.content));
    } else {
      console.log(`[/v3/contacts/{id}/activities] first activity content typeof:`, typeof first.content);
    }

    loggedFirstActivityShape = true;
  }

  return activities;
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
    let totalMirrored = 0;

    // Statuses that represent human/agent progress. We NEVER overwrite these
    // back to pending/mirrored — i.e. a dismissed or sent lead is not
    // resurrected into the actionable inbox by a re-poll.
    const PROTECTED_STATUSES = ['draft_ready', 'approved', 'sent', 'dismissed'];

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

        // v3: fetch ALL replied contacts in one paginated walk (was v1's
        // page-by-page in-band loop). Pagination is items[]/hasMore via
        // top+skip — matches sync-reply-campaigns / sync-reply-contacts.
        let repliedContacts: V3Contact[];
        try {
          repliedContacts = await fetchAllRepliedContactsV3(apiKey);
          console.log(`[poll-reply-inbox] Fetched ${repliedContacts.length} replied contacts for integration ${integration.id}`);
        } catch (fetchErr) {
          console.error(`[poll-reply-inbox] Reply.io v3 fetch failed for integration ${integration.id}:`, fetchErr);
          continue;
        }

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        for (const contact of repliedContacts) {
          try {
            // Proxy for v1's `lastReplyDate` — v3 omits a reply-specific
            // timestamp on the contact object. lastModifiedAt advances on
            // any contact modification including replies; we accept some
            // non-reply false positives as the cost of v3 compatibility.
            const lastReplyDate = contact.lastModifiedAt || contact.createdAt || null;

            // ALL-TIME MIRRORING: we no longer skip old replies. Recency now
            // only decides ACTIONABILITY (inbox_status), not whether the row
            // is mirrored. Recent (≤24h) → 'pending' (shows in the agent
            // inbox); older → 'mirrored' (data-only, non-actionable). A null
            // date is treated as recent, preserving prior behavior.
            const isRecentReply = !lastReplyDate || lastReplyDate >= oneDayAgo;

            const externalId = String(contact.id);

            // Dedupe against existing agent_leads by timestamp similarity.
            // Also read inbox_status so we can preserve progressed leads
            // (see PROTECTED_STATUSES) instead of resurrecting them.
            const { data: existingLead } = await supabase
              .from('agent_leads')
              .select('id, last_reply_at, inbox_status')
              .eq('user_id', userId)
              .eq('external_id', externalId)
              .maybeSingle();

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

            // Target inbox_status. A human/agent-progressed lead
            // (draft_ready/approved/sent/dismissed) is preserved verbatim so a
            // re-poll never drags it back to pending or mirrored. Otherwise
            // recency decides: recent → 'pending', old → 'mirrored'.
            const targetInboxStatus =
              existingLead && PROTECTED_STATUSES.includes(existingLead.inbox_status)
                ? existingLead.inbox_status
                : (isRecentReply ? 'pending' : 'mirrored');

            totalProcessed++;

            const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
            const channel = contact.linkedInUrl ? 'linkedin' : 'email';

            const { data: upsertedLead, error: upsertError } = await supabase
              .from('agent_leads')
              .upsert({
                user_id: userId,
                agent_config_id: agentConfig.id,
                external_id: externalId,
                full_name: fullName,
                email: contact.email || '',
                linkedin_url: contact.linkedInUrl || '',
                company: contact.company || '',
                channel,
                source: 'reply_io',
                pipeline_stage: 'replied',
                inbox_status: targetInboxStatus,
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
              // Old (mirrored) replies are data-only: skip the activity-feed
              // entry and the per-contact reply-text backfill. The backfill is
              // N API calls per contact, so doing it for all-time history
              // would be a rate-limit storm — and a years-old "reply detected"
              // activity entry dated now would be misleading. Only recent /
              // actionable replies get the full treatment.
              if (!isRecentReply) {
                totalMirrored++;
                continue;
              }

              totalNew++;

              // Log activity
              await supabase.from('agent_activity').insert({
                user_id: userId,
                agent_config_id: agentConfig.id,
                lead_id: upsertedLead.id,
                lead_name: fullName,
                lead_company: contact.company || '',
                activity_type: 'reply_received',
                description: `${channel === 'linkedin' ? 'LinkedIn' : 'Email'} reply detected via polling from ${fullName}${contact.company ? ' at ' + contact.company : ''}`,
                metadata: { channel, intent: 'pending', source: 'poll' },
              });

              // Backfill reply text from /v3/contacts/{id}/activities.
              // Endpoint shape UNVERIFIED — first-call log inside
              // fetchContactActivitiesV3 surfaces the field names. The
              // ?? chains below are intentionally generous so we don't
              // silently drop the body field if v3 renamed it (e.g.,
              // text/message/content). Tighten after one live read.
              try {
                const activities = await fetchContactActivitiesV3(externalId, apiKey);

                // Defensive incoming-reply predicate. v3 uses
                // `activityType` (PascalCase enum) as the discriminator;
                // the exact reply-specific value is unknown from dev
                // (which only had MoveToCampaign + Creation). Substring
                // match on lowercased value catches likely candidates:
                // "EmailReply", "LinkedInMessageReply", "ReceivedMessage",
                // "ReplyReceived", etc.
                const isIncoming = (a: V3Activity): boolean => {
                  const at = String(a.activityType ?? '').toLowerCase();
                  if (at.includes('reply')) return true;
                  if (at.includes('incoming')) return true;
                  if (at.includes('received')) return true;
                  if (at.includes('inbound')) return true;
                  return false;
                };
                // v3 content is an OBJECT (probe confirmed). Inner shape
                // unknown — try common sub-keys before falling back. If
                // none match, return empty string (drops the activity
                // from the thread rather than writing `[object Object]`).
                const getBody = (a: V3Activity): string => {
                  const c = a.content;
                  if (typeof c === 'string') return c;
                  if (c && typeof c === 'object') {
                    const obj = c as Record<string, unknown>;
                    return String(
                      obj.text ?? obj.body ?? obj.html ?? obj.message ?? obj.content ?? '',
                    );
                  }
                  return '';
                };
                // v3 only exposes `date` (verified). createdAt /
                // occurredAt are absent — kept as defensive fallbacks
                // in case Reply.io adds them later.
                const getTs = (a: V3Activity): string | null => {
                  const x = a as unknown as Record<string, unknown>;
                  return (
                    (a.date ??
                      (x.createdAt as string | undefined) ??
                      (x.occurredAt as string | undefined) ??
                      null) as string | null
                  );
                };

                // Surface the activityType distribution when we couldn't
                // find any incoming reply but activities exist — primary
                // signal that the reply-specific enum value differs from
                // our substring guesses. Once a real prod run hits this
                // log, we update isIncoming() with the exact value.
                if (activities.length > 0 && !activities.some(isIncoming)) {
                  const types = [...new Set(activities.map(a => String(a.activityType ?? '(absent)')))];
                  console.warn(`[poll-reply-inbox] No incoming-reply activityType match for contact ${externalId} (${activities.length} activities); activityTypes seen:`, types);
                }

                const replyActivities = activities
                  .filter(isIncoming)
                  .sort((a, b) => {
                    const at = new Date(getTs(a) || 0).getTime();
                    const bt = new Date(getTs(b) || 0).getTime();
                    return at - bt;
                  });

                if (replyActivities.length > 0) {
                  const latestReply = replyActivities[replyActivities.length - 1];
                  const replyText = getBody(latestReply);

                  // Build full thread (sent + received) ordered chronologically.
                  // Same shape consumed by classify-reply: {role, content,
                  // timestamp, channel}.
                  const threadMessages = activities
                    .filter((a) => getBody(a))
                    .sort((a, b) => {
                      const at = new Date(getTs(a) || 0).getTime();
                      const bt = new Date(getTs(b) || 0).getTime();
                      return at - bt;
                    })
                    .map((a) => ({
                      role: isIncoming(a) ? 'prospect' : 'sender',
                      content: getBody(a),
                      timestamp: getTs(a) || new Date().toISOString(),
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
              } catch (activityErr) {
                console.error(`[poll-reply-inbox] Failed to fetch activities for ${externalId}:`, activityErr);
              }
            }
          } catch (contactErr) {
            console.error(`[poll-reply-inbox] Error processing contact ${contact.id}:`, contactErr);
          }
        }
      } catch (integrationErr) {
        console.error(`[poll-reply-inbox] Error processing integration ${integration.id}:`, integrationErr);
      }
    }

    console.log(`[poll-reply-inbox] Done. Processed: ${totalProcessed}, New leads: ${totalNew}, Mirrored: ${totalMirrored}`);

    return new Response(JSON.stringify({ success: true, processed: totalProcessed, new: totalNew, mirrored: totalMirrored }), {
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
