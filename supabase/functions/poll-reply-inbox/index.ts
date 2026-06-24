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

// Normalize a LinkedIn profile URL to a comparable key so the same person under
// slightly different URLs dedupes. Returns null when there's no usable URL.
//   https://www.linkedin.com/in/jasonmisztal/  →  linkedin.com/in/jasonmisztal
function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let s = String(url).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '');   // strip protocol
  s = s.replace(/^www\./, '');         // strip leading www.
  s = s.split('#')[0].split('?')[0];   // strip fragment + query
  s = s.replace(/\/+$/, '');           // strip trailing slash(es)
  return s || null;
}

function isGenmailEmail(email: string | null | undefined): boolean {
  return String(email ?? '').trim().toLowerCase().endsWith('@genmail.com');
}

// Reply.io can return the same person as a real-email thread + a @genmail.com
// placeholder thread. When two threads share a normalized LinkedIn URL, keep the
// one with the most recent activity; tie-break to the non-genmail email.
function pickLinkedInWinner(a: InboxThread, b: InboxThread): InboxThread {
  const aDate = a.lastActivityDate || '';
  const bDate = b.lastActivityDate || '';
  if (aDate !== bDate) return aDate > bDate ? a : b;   // most recent wins
  const aGen = isGenmailEmail(a.contact?.email);
  const bGen = isGenmailEmail(b.contact?.email);
  if (aGen !== bGen) return aGen ? b : a;              // prefer non-genmail
  return a;                                            // stable
}

// Existing reply_io lead row shape used by the against-DB LinkedIn dedup.
interface ExistingReplyLead {
  id: string;
  external_id: string | null;
  linkedin_url: string | null;
  inbox_status: string;
  last_reply_at: string | null;
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

        // --- Dedup pass 1 (within this run): collapse threads that resolve to
        // the same person by normalized LinkedIn URL (real-email vs @genmail.com
        // placeholder). Keep one winner per LinkedIn key; threads with NO
        // LinkedIn URL pass through untouched and fall back to (user_id,
        // external_id) dedup — we never collapse different no-LinkedIn people.
        const linkedInWinners = new Map<string, InboxThread>();
        const threadsToProcess: InboxThread[] = [];
        for (const thread of inboxThreads) {
          const key = normalizeLinkedInUrl(thread.contact?.linkedInProfileUrl);
          if (!key) {
            threadsToProcess.push(thread);
            continue;
          }
          const prev = linkedInWinners.get(key);
          linkedInWinners.set(key, prev ? pickLinkedInWinner(prev, thread) : thread);
        }
        threadsToProcess.push(...linkedInWinners.values());

        // --- Dedup pass 2 (against the DB): one query for this user's existing
        // reply_io leads, indexed by normalized LinkedIn URL. A thread whose
        // contact matches an existing lead's LinkedIn URL UPDATEs that lead
        // (even under a different external_id) instead of inserting a new row.
        const { data: existingReplyLeads } = await supabase
          .from('agent_leads')
          .select('id, external_id, linkedin_url, inbox_status, last_reply_at')
          .eq('user_id', userId)
          .eq('source', 'reply_io');

        const leadsByLinkedIn = new Map<string, ExistingReplyLead>();
        for (const l of (existingReplyLeads ?? []) as ExistingReplyLead[]) {
          const key = normalizeLinkedInUrl(l.linkedin_url);
          if (!key) continue;
          const prev = leadsByLinkedIn.get(key);
          // Pre-existing duplicates: keep the most recently active one.
          if (!prev || (l.last_reply_at || '') > (prev.last_reply_at || '')) {
            leadsByLinkedIn.set(key, l);
          }
        }

        for (const thread of threadsToProcess) {
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
            const replyText = latestInbound.body || '';

            // Resolve the existing lead to dedupe against: prefer a normalized
            // LinkedIn-URL match (collapses real-email vs @genmail.com
            // duplicates, even under a different external_id), then fall back to
            // the same-(user_id, external_id) lead for no-LinkedIn contacts.
            const linkedInKey = normalizeLinkedInUrl(contact?.linkedInProfileUrl);
            let existingLead: ExistingReplyLead | null =
              linkedInKey ? (leadsByLinkedIn.get(linkedInKey) ?? null) : null;
            if (!existingLead) {
              const { data } = await supabase
                .from('agent_leads')
                .select('id, external_id, linkedin_url, inbox_status, last_reply_at')
                .eq('user_id', userId)
                .eq('external_id', externalId)
                .maybeSingle();
              existingLead = (data as ExistingReplyLead | null) ?? null;
            }

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
            // re-poll never drags it back. Otherwise: 'pending' (actionable)
            // ONLY when the latest message is the inbound reply AND it's within
            // 24h; everything else (we already replied, or older) → 'mirrored'.
            const targetInboxStatus =
              existingLead && PROTECTED_STATUSES.includes(existingLead.inbox_status)
                ? existingLead.inbox_status
                : (latestIsInbound && isRecentReply ? 'pending' : 'mirrored');

            totalProcessed++;

            const fullName = contact?.fullName || latestInbound.fromName || 'Unknown';
            const company = contact?.companyName || '';
            // Reply.io channel is "linkedIn" | "email"; normalize to the
            // lowercase 'linkedin'/'email' convention the rest of the app uses.
            const channel = normalizeChannel(thread.channel);

            // Full conversation thread — same shape the HeyReach path writes so
            // the Conversation panel renders the exchange: inbound → 'prospect'
            // (left), outbound → 'sender' (right); the renderer reads `timestamp`.
            const replyThread = messages.map((m) => ({
              role: m.isOutbound ? 'sender' : 'prospect',
              content: m.body || '',
              timestamp: m.date || new Date().toISOString(),
              channel: normalizeChannel(m.channel ?? thread.channel),
              fromName: m.fromName ?? null,
            }));

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
                  last_reply_text: replyText,
                  reply_thread: replyThread,
                  updated_at: nowIso,
                })
                .eq('id', existingLead.id)
                .select('id')
                .single();

              if (updateError) {
                console.error(`[poll-reply-inbox] Update error for lead ${existingLead.id} (thread ${externalId}):`, updateError.message);
                continue;
              }
              writtenLeadId = updated?.id ?? existingLead.id;
            } else {
              // INSERT a new lead (upsert keyed on user_id,external_id).
              const { data: inserted, error: upsertError } = await supabase
                .from('agent_leads')
                .upsert({
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
                  last_reply_text: replyText,
                  reply_thread: replyThread,
                }, {
                  onConflict: 'user_id,external_id',
                  ignoreDuplicates: false,
                })
                .select('id')
                .single();

              if (upsertError) {
                console.error(`[poll-reply-inbox] Upsert error for ${externalId}:`, upsertError.message);
                continue;
              }
              writtenLeadId = inserted?.id ?? null;

              // Register the new lead under its LinkedIn key so a later thread
              // in this same run with the same key UPDATEs it (defensive — the
              // within-run pass already collapses same-key threads).
              if (linkedInKey && writtenLeadId) {
                leadsByLinkedIn.set(linkedInKey, {
                  id: writtenLeadId,
                  external_id: externalId,
                  linkedin_url: contact?.linkedInProfileUrl || null,
                  inbox_status: targetInboxStatus,
                  last_reply_at: lastReplyDate || nowIso,
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
