import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  resolveExistingLead,
  fetchReplyIoCandidates,
  isValidReplyThreadId,
  type LeadCandidate,
} from '../_shared/lead-dedup.ts';
import { htmlToText } from '../_shared/html-to-text.ts';
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

// ---------------------------------------------------------------------------
// Reply.io v3 — agent inbox backstop poll: catches replies the webhook missed.
// Cron auth via x-agent-key, manual trigger via user JWT. Bearer-authed v3.
//
// Reply source: GET /v3/inbox/threads (top/skip, items[]/hasMore, newest-first
// by lastActivityDate). This is the CORRECT source — it surfaces ALL reply
// threads, email AND LinkedIn (incl. connection replies). The earlier
// /v3/contacts?status=replied only returned contacts flagged 'replied' and
// missed LinkedIn connection replies entirely (~5 contacts vs the inbox's 970
// threads), and the unbounded contact walk timed out the function.
//
// One agent_lead per THREAD (external_id = thread.id). For each thread active
// within the last 24h we fetch its FULL messages via
// GET /v3/inbox/threads/{id}/messages — NOT thread.bodyPreview (truncated) —
// which also carries `isOutbound` so we can tell a real prospect reply from our
// own send. This fixes two bugs: (1) truncated reply text, and (2) outbound
// sequence sends being counted as replies. Threads with NO inbound message are
// skipped entirely; a thread is 'pending' (actionable) only when its LATEST
// message is the inbound reply. last_reply_text/last_reply_at come from the
// latest inbound message; reply_thread holds the full exchange.
//
// Pagination is capped (maxPages, default 2 ≈ 200 newest threads) so each poll
// is fast and focused on NEW replies; frequent scheduled runs catch them as
// they arrive. Recency (24h) decides ACTIONABILITY only (pending vs mirrored),
// not whether a thread is mirrored.
// ---------------------------------------------------------------------------

const REPLY_API_V3 = 'https://api.reply.io/v3';

interface InboxThreadContact {
  id?: number | null;
  ownerId?: number | null;
  fullName?: string;
  email?: string | null;
  linkedInProfileUrl?: string | null;
  companyName?: string | null;
  title?: string | null;
  isDeleted?: boolean;
}

// GET /v3/inbox/threads item. The Inbox is the correct reply source: it
// surfaces ALL reply threads — email AND LinkedIn (incl. connection replies) —
// whereas /v3/contacts?status=replied only returned contacts flagged 'replied'
// (it missed LinkedIn connection replies: ~5 contacts vs the inbox's 970
// threads). Threads are ordered lastActivityDate DESC (newest first).
interface InboxThread {
  id: number;
  channel?: string;                                  // "email" | "linkedIn"
  isRead?: boolean;
  subject?: string | null;
  bodyPreview?: string | null;                       // reply text preview
  lastActivityDate?: string;                         // ISO8601 — reply timestamp
  contact?: InboxThreadContact | null;
  sequence?: { id: number; name: string } | null;
  category?: { id: number; name: string } | null;    // e.g. "Interested" / "Not interested"
  hasMeetingIntent?: boolean;
  status?: { state?: string };
}

interface InboxThreadsPage {
  items?: InboxThread[];
  hasMore?: boolean;
}

// GET /v3/inbox/threads/{threadId}/messages item — the FULL message (not the
// truncated thread.bodyPreview), with the isOutbound discriminator that lets us
// tell a real prospect reply (false) from our own outbound send (true).
// Messages come chronological (oldest first).
interface InboxMessage {
  date?: string;                                     // ISO8601
  body?: string;                                     // FULL message text
  fromName?: string;
  isOutbound?: boolean;                              // true = our send, false = prospect reply
  channel?: string;                                  // "linkedIn" | "email"
}

interface InboxMessagesPage {
  items?: InboxMessage[];
  hasMore?: boolean;
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

// Paginate GET /v3/inbox/threads with top + skip. The inbox is ordered
// lastActivityDate DESC (newest first), so the first maxPages give us the
// most-recent reply threads — which is all we need for fast, frequent polling
// of NEW replies. Stops on hasMore=false, short read, or the maxPages cap.
// Bounded inter-page sleep so we don't hammer the API.
async function fetchInboxThreads(
  apiKey: string,
  maxPages: number = 2,
): Promise<InboxThread[]> {
  const pageSize = 100;
  const all: InboxThread[] = [];
  let skip = 0;
  for (let page = 1; page <= maxPages; page++) {
    const url = `/inbox/threads?top=${pageSize}&skip=${skip}`;
    const resp = await fetchV3WithRetry<InboxThreadsPage>(url, apiKey);
    const items = Array.isArray(resp.items) ? resp.items : [];
    if (items.length === 0) break;
    all.push(...items);
    console.log(`  /inbox/threads page ${page} (skip=${skip}): fetched ${items.length}, total ${all.length}`);
    if (resp.hasMore === false) break;
    if (items.length < pageSize) break;
    skip += items.length;
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

// Fetch the FULL messages of one thread (chronological, oldest first) via
// GET /v3/inbox/threads/{threadId}/messages. Gives us full bodies + the
// isOutbound flag (fixes truncation + outbound-counted-as-reply). Paginates
// top/skip defensively (capped) in case a thread has >100 messages; most
// threads are a single page, so no inter-page sleep is incurred in practice.
async function fetchThreadMessages(
  threadId: number,
  apiKey: string,
): Promise<InboxMessage[]> {
  const pageSize = 100;
  const all: InboxMessage[] = [];
  let skip = 0;
  for (let page = 1; page <= 10; page++) {   // hard cap: 1000 messages/thread
    const url = `/inbox/threads/${threadId}/messages?top=${pageSize}&skip=${skip}`;
    const resp = await fetchV3WithRetry<InboxMessagesPage>(url, apiKey);
    const items = Array.isArray(resp.items) ? resp.items : [];
    if (items.length === 0) break;
    all.push(...items);
    if (resp.hasMore === false) break;
    if (items.length < pageSize) break;
    skip += items.length;
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// LinkedIn-URL / genmail / email dedup normalizers now live in
// ../_shared/lead-dedup.ts and are shared with reply-webhook so both capture
// paths resolve the same prospect to the same lead.

// htmlToText moved to _shared/html-to-text.ts so reply-webhook uses the
// IDENTICAL implementation (both paths write the same agent_leads row).

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

        // Fetch the inbox threads (the correct reply source — see
        // fetchInboxThreads). Newest-first, capped at maxPages so each poll is
        // fast and focused on recent replies.
        let inboxThreads: InboxThread[];
        try {
          inboxThreads = await fetchInboxThreads(apiKey);
          console.log(`[poll-reply-inbox] Fetched ${inboxThreads.length} inbox threads for integration ${integration.id}`);
        } catch (fetchErr) {
          console.error(`[poll-reply-inbox] Reply.io inbox fetch failed for integration ${integration.id}:`, fetchErr);
          continue;
        }

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const normalizeChannel = (c: unknown): string =>
          String(c).toLowerCase() === 'linkedin' ? 'linkedin' : 'email';

        // Dedup candidates: this user's existing reply_io leads, fetched once.
        // MUTABLE — after each INSERT we push the new lead so a later thread in
        // the same run resolves against it (intra-run dedup); after an UPDATE we
        // refresh the matched candidate in place. Matching uses the shared
        // resolveExistingLead (external_id → normalized linkedin_url →
        // normalized email, genmail excluded) — identical to reply-webhook.
        const candidates: LeadCandidate[] = await fetchReplyIoCandidates(supabase, userId);
        // Visibility for the null-repair's one known imprecision: a contact with
        // MULTIPLE threads gets whichever thread this run processes first, and
        // later threads for the same lead then see a non-null id and skip. That
        // is safe (send-agent-reply's ownership check still confirms the thread
        // belongs to this contact) but it IS a first-seen-wins choice, so record
        // repairs per run and log when a second thread turns up for one.
        const repairedThisRun = new Map<string, string>();

        for (const thread of inboxThreads) {
          try {
            const contact = thread.contact ?? null;
            const externalId = String(thread.id);
            const threadActivity = thread.lastActivityDate || null;

            // PERFORMANCE: only inspect threads active within the last 24h —
            // those are the only candidates for an actionable reply, and the
            // per-thread messages fetch is expensive. Older threads are skipped
            // here WITHOUT the messages call (the webhook is the primary capture
            // path; this poll is a 24h backstop). null date → treat as recent.
            if (threadActivity && threadActivity < oneDayAgo) {
              continue;
            }

            // Fetch the FULL message list for this thread (oldest → newest).
            let messages: InboxMessage[];
            try {
              messages = await fetchThreadMessages(thread.id, apiKey);
            } catch (msgErr) {
              console.error(`[poll-reply-inbox] Failed to fetch messages for thread ${externalId}:`, msgErr);
              continue;
            }

            // INBOUND = prospect reply (isOutbound === false). No inbound at all
            // → this thread is outbound-only (we sent, nobody replied). SKIP it
            // entirely — do not create/surface a lead. (Fixes outbound-counted-
            // as-reply.)
            const inbound = messages.filter((m) => m.isOutbound === false);
            if (inbound.length === 0) {
              continue;
            }

            const latestInbound = inbound[inbound.length - 1];
            const latestMessage = messages[messages.length - 1];
            // Actionable only when the most recent message in the thread IS the
            // inbound reply (nothing outbound after it). If our send is latest,
            // the thread's newest activity is our outbound — not a new reply.
            const latestIsInbound = latestMessage ? latestMessage.isOutbound === false : true;

            // last_reply_* derive from the latest INBOUND message (FULL body).
            const lastReplyDate = latestInbound.date || threadActivity || null;
            const isRecentReply = !lastReplyDate || lastReplyDate >= oneDayAgo;
            // Email bodies arrive as HTML; LinkedIn as plain text. Normalize
            // email → readable text at capture (htmlToText is a no-op on text).
            const latestInboundChannel = normalizeChannel(latestInbound.channel ?? thread.channel);
            const replyText = latestInboundChannel === 'email'
              ? htmlToText(latestInbound.body || '')
              : (latestInbound.body || '');

            // Resolve the existing lead to dedupe against, in shared order:
            // external_id → normalized linkedin_url → normalized email (genmail
            // excluded). The returned object is a reference into `candidates`,
            // so mutating it below keeps the in-run list current.
            const existingLead = resolveExistingLead(candidates, {
              externalId,
              linkedinUrl: contact?.linkedInProfileUrl,
              email: contact?.email,
            });

            // Resurface decision (unified with reply-webhook via shouldResurface):
            // a genuinely-new, unanswered, non-suppressed inbound reply flips the
            // lead to 'pending' + triggers a draft. "Genuinely new" = the newest
            // reply is STRICTLY newer than the lead's prior last_reply_at (the
            // re-poll guard, replacing the old 60s window). Otherwise the lead's
            // current status is preserved — a re-poll never drags a handled or
            // opted_out/not_relevant lead back into the actionable queue.
            // "Genuinely new" is measured against the SURFACE watermark
            // (last_surfaced_reply_at) — the last reply that actually flipped
            // the lead to 'pending' — NOT last_reply_at, which the display
            // write below bumps unconditionally. This is what lets a reply
            // that was previously stored-without-surfacing (e.g. into a
            // dismissed thread) still resurface, and keeps re-polls idempotent.
            const newerThanPrior = (() => {
              const now = lastReplyDate ? new Date(lastReplyDate).getTime() : 0;
              const prior = existingLead?.last_surfaced_reply_at
                ? new Date(existingLead.last_surfaced_reply_at).getTime()
                : 0;
              return now > prior;
            })();
            let targetInboxStatus: string;
            if (existingLead) {
              targetInboxStatus = shouldResurface({
                dispositionTag: existingLead.disposition_tag,
                newestRole: latestIsInbound ? 'prospect' : 'sender',
                newerThanPrior,
              })
                ? 'pending'
                : (existingLead.inbox_status ?? 'mirrored');
            } else {
              // New lead: actionable when the newest message is the inbound reply
              // and it's recent (24h). classify-reply runs when 'pending'.
              targetInboxStatus = (latestIsInbound && isRecentReply) ? 'pending' : 'mirrored';
            }

            totalProcessed++;

            const fullName = contact?.fullName || latestInbound.fromName || 'Unknown';
            const company = contact?.companyName || '';
            // Reply.io channel is "linkedIn" | "email"; normalize to the
            // lowercase 'linkedin'/'email' convention the rest of the app uses.
            const channel = normalizeChannel(thread.channel);

            // Full conversation thread — same shape the HeyReach path writes so
            // the Conversation panel renders the exchange: inbound → 'prospect'
            // (left), outbound → 'sender' (right); the renderer reads `timestamp`.
            const replyThread = messages.map((m) => {
              const msgChannel = normalizeChannel(m.channel ?? thread.channel);
              return {
                role: m.isOutbound ? 'sender' : 'prospect',
                // Email → readable text; LinkedIn (plain text) passes through.
                content: msgChannel === 'email' ? htmlToText(m.body || '') : (m.body || ''),
                timestamp: m.date || new Date().toISOString(),
                channel: msgChannel,
                fromName: m.fromName ?? null,
              };
            });

            const nowIso = new Date().toISOString();
            let writtenLeadId: string | null = null;

            if (existingLead) {
              // UPDATE the matched existing lead in place — refresh the reply
              // fields per the normal rules, but DO NOT touch external_id /
              // source / email / linkedin_url, so the real-email identity is
              // preserved and no duplicate external_id row is created.
              const { data: updated, error: updateError } = await supabase
                .from('agent_leads')
                .update({
                  inbox_status: targetInboxStatus,
                  last_reply_at: lastReplyDate || nowIso,
                  last_reply_text: cleanReplyPreview(replyText),
                  reply_thread: replyThread,
                  updated_at: nowIso,
                  // Advance the SURFACE watermark ONLY when we actually surface
                  // (→ 'pending'). Otherwise leave it untouched so the display
                  // write above can't consume the reply without surfacing it.
                  ...(targetInboxStatus === 'pending'
                    ? { last_surfaced_reply_at: lastReplyDate || nowIso }
                    : {}),
                  // SELF-HEALING NULL-REPAIR (strict upgrade, null -> thread id).
                  //
                  // reply-webhook captures in real time but cannot always resolve
                  // the inbox thread (Reply.io's v3 payload carries no thread id,
                  // and GET /v3/inbox/threads ignores every filter param, so it
                  // resolves client-side and returns NULL rather than guess on a
                  // 429 or a genuinely ambiguous multi-thread contact). Such a
                  // lead is visible but unsendable — send-agent-reply rejects a
                  // null external_id with 400 thread_unresolved. The poll already
                  // holds the authoritative thread id, so it fills the gap here.
                  //
                  // WIDENED from "NULL only" to "NULL or not a valid thread id".
                  //
                  // The null-only form was dead code: no reply_io lead in prod
                  // has a NULL external_id, while 1,577 carry a value that is
                  // not a thread id at all — 'backfill:<sha1>' keys from one-off
                  // pipeline scripts, contact ids, email addresses. Those leads
                  // updated correctly on every new reply (thread, timestamp,
                  // status) while the one field that makes them SENDABLE stayed
                  // frozen, because a non-null bad value was treated as an
                  // identity worth protecting. It never was.
                  //
                  // The original guarantee is untouched: a VALID thread id is
                  // still never overwritten, so the masked-stub <-> real-email
                  // downgrade this rule was written to prevent cannot occur.
                  // Verified against all 2,520 prod reply_io leads: the two sets
                  // are strictly complementary, 0 overlap.
                  //
                  // Identity safety comes from resolveExistingLead, which has
                  // already matched this thread to this lead by external_id ->
                  // linkedin_url -> email. A backfill key never matches by id,
                  // so the match was made on a real identity field.
                  ...(isValidReplyThreadId(existingLead.external_id)
                    ? {}
                    : { external_id: externalId }),
                })
                .eq('id', existingLead.id)
                .select('id')
                .single();

              if (updateError) {
                console.error(`[poll-reply-inbox] Update error for lead ${existingLead.id} (thread ${externalId}):`, updateError.message);
                continue;
              }
              writtenLeadId = updated?.id ?? existingLead.id;
              // Refresh the matched candidate in place for later threads in this
              // run (existingLead is a reference into `candidates`).
              existingLead.last_reply_at = lastReplyDate || nowIso;
              existingLead.inbox_status = targetInboxStatus;
              // Mirror the repair into the in-run candidate so a LATER thread for
              // the same contact in this same run sees a non-null value and does
              // not overwrite the id we just set.
              if (!isValidReplyThreadId(existingLead.external_id)) {
                existingLead.external_id = externalId;
                repairedThisRun.set(String(existingLead.id), String(externalId));
                console.log(
                  `[poll-reply-inbox] null-repair: lead ${existingLead.id} external_id -> ${externalId}`,
                );
              } else if (
                repairedThisRun.has(String(existingLead.id)) &&
                repairedThisRun.get(String(existingLead.id)) !== String(externalId)
              ) {
                // MULTI-THREAD CONTACT — we repaired this lead earlier in this
                // same run with a different thread. Keeping first-seen.
                console.log(
                  `[poll-reply-inbox] null-repair MULTI-THREAD: lead ${existingLead.id} kept ` +
                  `first-seen thread ${repairedThisRun.get(String(existingLead.id))}, also saw ` +
                  `${externalId}. Safe (same contact), but first-seen-wins — revisit if frequent.`,
                );
              }
              if (targetInboxStatus === 'pending') {
                existingLead.last_surfaced_reply_at = lastReplyDate || nowIso;
              }
            } else {
              // INSERT — nothing matched any dedup key. Plain insert (NOT upsert):
              // the shared resolver already ruled out an existing row, and the
              // (user_id, external_id) unique index is partial so onConflict
              // inference is unreliable anyway.
              const { data: inserted, error: insertError } = await supabase
                .from('agent_leads')
                .insert({
                  user_id: userId,
                  agent_config_id: agentConfig.id,
                  external_id: externalId,
                  full_name: fullName,
                  email: contact?.email || '',
                  linkedin_url: contact?.linkedInProfileUrl || '',
                  company,
                  channel,
                  source: 'reply_io',
                  pipeline_stage: 'replied',
                  inbox_status: targetInboxStatus,
                  last_reply_at: lastReplyDate || nowIso,
                  last_reply_text: cleanReplyPreview(replyText),
                  reply_thread: replyThread,
                  // Seed the surface watermark when the new lead lands actionable.
                  ...(targetInboxStatus === 'pending'
                    ? { last_surfaced_reply_at: lastReplyDate || nowIso }
                    : {}),
                })
                .select('id')
                .single();

              if (insertError) {
                console.error(`[poll-reply-inbox] Insert error for ${externalId}:`, insertError.message);
                continue;
              }
              writtenLeadId = inserted?.id ?? null;

              // Register the new lead so a later thread in this same run resolves
              // against it (intra-run dedup across all keys).
              if (writtenLeadId) {
                candidates.push({
                  id: writtenLeadId,
                  external_id: externalId,
                  linkedin_url: contact?.linkedInProfileUrl || null,
                  email: contact?.email || null,
                  last_reply_at: lastReplyDate || nowIso,
                  inbox_status: targetInboxStatus,
                  last_surfaced_reply_at:
                    targetInboxStatus === 'pending' ? (lastReplyDate || nowIso) : null,
                });
              }
            }

            if (writtenLeadId) {
              // Only newly-actionable ('pending') threads get an activity-feed
              // entry; mirrored ones (we already replied, or PROTECTED) are
              // data-only.
              if (targetInboxStatus !== 'pending') {
                totalMirrored++;
                continue;
              }

              totalNew++;

              // Log activity
              await supabase.from('agent_activity').insert({
                user_id: userId,
                agent_config_id: agentConfig.id,
                lead_id: writtenLeadId,
                lead_name: fullName,
                lead_company: company,
                activity_type: 'reply_received',
                description: `${channel === 'linkedin' ? 'LinkedIn' : 'Email'} reply detected via polling from ${fullName}${company ? ' at ' + company : ''}`,
                metadata: { channel, intent: 'pending', source: 'poll' },
              });

              // Trigger a draft — poll previously NEVER did this (only the
              // webhook did). Fires only for 'pending' (resurfaced or new
              // actionable) leads; classify-reply itself early-returns for
              // opted_out. replyText/replyThread are the just-written values.
              fireClassifyReply({
                supabaseUrl,
                agentKey: expectedKey || '',
                leadId: writtenLeadId,
                replyText,
                threadHistory: replyThread,
                agentConfig,
                channel,
                userId,
              });
              // Best-effort: record 'replied' inference event (non-blocking)
              try {
                const personKey =
                  (contact?.email && contact.email.trim()
                    ? contact.email.trim().toLowerCase()
                    : '') ||
                  (contact?.linkedInProfileUrl && contact.linkedInProfileUrl.trim()
                    ? contact.linkedInProfileUrl.trim()
                    : '') ||
                  externalId;
                if (personKey) {
                  const srid = `${externalId}:${lastReplyDate || nowIso}`;
                  await supabase.from('inference_events').upsert(
                    {
                      team_id: integration.team_id,
                      agent_config_id: agentConfig.id,
                      person_key: personKey,
                      email: contact?.email ? contact.email.trim().toLowerCase() : null,
                      linkedin_url: contact?.linkedInProfileUrl ?? null,
                      full_name: fullName || null,
                      job_title: contact?.title || null,
                      company_name: company || null,
                      channel,
                      campaign_external_id: thread.sequence?.id ? String(thread.sequence.id) : null,
                      campaign_name: thread.sequence?.name ?? null,
                      event_type: 'replied',
                      intent: null,
                      is_objection: null,
                      pipeline_stage: 'replied',
                      disposition_tag: null,
                      occurred_at: lastReplyDate || nowIso,
                      source: 'poll_reply_inbox',
                      source_row_id: srid,
                      metadata: { source: 'poll' }
                    },
                    // @ts-ignore onConflict supports column-list; partial unique index handles non-null source_row_id
                    { onConflict: 'source,source_row_id,event_type' }
                  );
                }
              } catch (e) {
                console.warn('[poll-reply-inbox] inference_events write failed (non-fatal):', e);
              }
              // Best-effort: upsert people directory snapshot
              try {
                const pkey =
                  (contact?.email && contact.email.trim()
                    ? contact.email.trim().toLowerCase()
                    : '') ||
                  (contact?.linkedInProfileUrl && contact.linkedInProfileUrl.trim()
                    ? contact.linkedInProfileUrl.trim()
                    : '') ||
                  externalId;
                if (pkey) {
                  const person: Record<string, unknown> = {
                    team_id: integration.team_id,
                    person_key: pkey,
                    source: 'poll_reply_inbox',
                    last_seen_at: lastReplyDate || nowIso,
                  };
                  if (contact?.email) person.email = contact.email.trim().toLowerCase();
                  if (contact?.linkedInProfileUrl) person.linkedin_url = contact.linkedInProfileUrl;
                  if (fullName) person.full_name = fullName;
                  if (contact?.title) person.job_title = contact.title;
                  if (company) person.company_name = company;
                  await supabase.from('people').upsert(person, { onConflict: 'team_id,person_key' });
                }
              } catch (e) {
                console.warn('[poll-reply-inbox] people upsert failed (non-fatal):', e);
              }
            }
          } catch (threadErr) {
            console.error(`[poll-reply-inbox] Error processing thread ${thread.id}:`, threadErr);
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
