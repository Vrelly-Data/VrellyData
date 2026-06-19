import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-agent-key",
  };
}

// ---------------------------------------------------------------------------
// Reply.io v3 (deprecated v1/v2 code removed).
//
// Auth is now Bearer; the old X-API-Key header is gone. v3 returns sequences
// directly from /v3/sequences with teamId inline, so the X-Reply-Team-Id
// header (a v1-era request scoping mechanism) is also gone — we filter
// client-side on seq.teamId === replyTeamId.
//
// Pagination: ?top=N per request, paged via &skip=offset, response carries
// items[] + hasMore. Workspace keys typically return all sequences in one or
// two pages.
//
// Stats (Step 3a): per-sequence POST /v3/reporting/{linkedin,emails}/overview
// routed by the channel column written in Step 2.6.
//   * channel='linkedin'     → /reporting/linkedin/overview
//   * channel='email'        → /reporting/emails/overview (plural path)
//   * channel='multichannel' → BOTH calls, merged
//   * channel=null           → skip (Step 2.6's classifier refused to
//                               guess; we honor that here)
//
// Failure isolation: a per-sequence reporting failure (rate-limit
// exhaust, transient 5xx) leaves THAT sequence's existing stats
// unchanged but does NOT fail the whole sync.
//
// Dashboard parity: the Messages Breakdown tooltip's LinkedIn section
// reads outbound_integrations.stats_cache (NOT per-campaign stats), so
// we ALSO aggregate the per-sequence linkedin* values into stats_cache
// at end of sync — mirrors sync-heyreach-campaigns:210-219.
//
// Step 3b will add the /v3/reporting/* calls to generate-client-analysis
// for the client report's stats_snapshot.reply_io section.
// ---------------------------------------------------------------------------

const REPLY_API_V3 = "https://api.reply.io/v3";

// LinkedIn fields - preserved from CSV uploads, never overwritten by sync.
const LINKEDIN_FIELDS = [
  'linkedinMessagesSent',
  'linkedinConnectionsSent',
  'linkedinReplies',
  'linkedinConnectionsAccepted',
  'linkedinDataSource',
  'linkedinDataUploadedAt',
];

// Email CSV upload fields - preserved from CSV uploads, never overwritten by sync.
const EMAIL_UPLOAD_FIELDS = [
  'emailDataSource',
  'emailDataUploadedAt',
  'opens',
  'clicked',
  'bounced',
  'outOfOffice',
  'optedOut',
  'interested',
  'notInterested',
  'autoReplied',
];

// v3 Sequence — the canonical Reply.io v3 object that replaces the v1
// Campaign. teamId is the workspace scope (we filter on it below).
interface ReplyioSequence {
  id: number;
  name: string;
  status: string;         // "Active" / "Paused" / "Finished" / "Archived"
  teamId?: number;        // Workspace ID — undefined on some edge rows
  ownerUserId?: number;
  ownerId?: number;       // legacy alias, kept defensively
  created?: string;
  isArchived?: boolean;
}

interface V3SequencesPage {
  items?: ReplyioSequence[];
  hasMore?: boolean;
}

// One step from GET /v3/sequences/{id}/steps. We only need `type` for
// channel classification — Reply.io's step.type values are camelCase:
// 'email' / 'linkedIn' / 'condition' / 'task' / 'call' / 'sms' /
// 'whatsApp' / 'zapier' (verified against CYPR seq 1704210).
interface ReplyioStep {
  id?: number;
  type?: string;
}

// v3 returns status as a lowercase-friendly string already; just normalize.
function normalizeStatus(status: unknown): string {
  return typeof status === 'string' ? status.toLowerCase() : 'unknown';
}

// Classify a sequence as 'linkedin' / 'email' / 'multichannel' / null
// based on which outreach step types are present. Structural steps
// (condition / task) and out-of-scope channels (call / sms / whatsApp /
// zapier) are IGNORED — they don't change whether the sequence is a
// LinkedIn or email play.
//
// 'linkedIn' is the exact camelCase Reply.io returns (verified on
// CYPR data — 14 linkedIn + 3 condition for seq 1704210).
//
// Returns null when the sequence has neither email nor linkedIn steps
// (e.g. a pure-condition skeleton); we refuse to guess in that case so
// the UI shows "no badge" rather than a wrong one.
function classifyChannel(steps: ReplyioStep[]): string | null {
  let hasEmail = false;
  let hasLinkedIn = false;
  for (const step of steps) {
    if (step.type === 'email') hasEmail = true;
    else if (step.type === 'linkedIn') hasLinkedIn = true;
  }
  if (hasEmail && hasLinkedIn) return 'multichannel';
  if (hasLinkedIn) return 'linkedin';
  if (hasEmail) return 'email';
  return null;
}

// Bearer-authed v3 fetcher.
async function fetchV3<T = unknown>(endpoint: string, apiKey: string): Promise<T> {
  const response = await fetch(`${REPLY_API_V3}${endpoint}`, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reply.io v3 API error (${response.status}): ${errorText}`);
  }
  return response.json() as Promise<T>;
}

// Exponential backoff for 429s. Same shape as the previous helper —
// only the underlying fetcher changed.
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
      const isRateLimit = msg.includes("Too much requests") || msg.includes("(429)");
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

// Fetch the steps of a single sequence for channel classification.
// /v3/sequences/{id}/steps returns a DIRECT ARRAY (not wrapped in items[])
// — verified against the live CYPR API and matches what
// sync-reply-sequences already consumes.
async function fetchSequenceStepsV3(
  sequenceId: number,
  apiKey: string,
): Promise<ReplyioStep[]> {
  const resp = await fetchV3WithRetry<unknown>(`/sequences/${sequenceId}/steps`, apiKey);
  return Array.isArray(resp) ? (resp as ReplyioStep[]) : [];
}

// ---- Step 3a: reporting helpers ------------------------------------------

// Defensive numeric extraction — mirrors fetchSmartleadStats' pickNumber
// pattern (generate-client-analysis:132-142). Tries each candidate key in
// order, returning the first numeric value found; 0 if none match.
function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return 0;
}

// Reply.io's 429 responses include Retry-After in seconds. Capped at 30s
// to bound a worst-case wait; defaults to 2s if the header is missing or
// non-numeric.
function parseRetryAfter(header: string | null): number {
  if (!header) return 2;
  const n = Number(header);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 30);
  return 2;
}

// POST /v3/reporting/{channel}/overview for a single sequence. One retry
// on 429 honoring Retry-After. All other non-OK statuses throw with the
// truncated body for log forensics.
//
//   'linkedin' → /reporting/linkedin/overview (singular path)
//   'email'    → /reporting/emails/overview  (plural — Reply.io's own
//                                              routing convention)
async function fetchReplyIoReporting(
  channel: 'linkedin' | 'email',
  sequenceExternalId: number,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const path = channel === 'linkedin'
    ? '/reporting/linkedin/overview'
    : '/reporting/emails/overview';
  const body = JSON.stringify({
    filters: {
      dateRangePreset: 'lastMonth',
      sequenceIds: [sequenceExternalId],
    },
  });
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  const doFetch = () => fetch(`${REPLY_API_V3}${path}`, { method: 'POST', headers, body });

  let res = await doFetch();
  if (res.status === 429) {
    const wait = parseRetryAfter(res.headers.get('Retry-After'));
    console.log(`  reporting/${channel} 429 on seq ${sequenceExternalId}, retrying after ${wait}s`);
    await new Promise(r => setTimeout(r, wait * 1000));
    res = await doFetch();
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`reporting/${channel} ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json().catch(() => ({}));
  return (json && typeof json === 'object') ? json as Record<string, unknown> : {};
}

// Shape a /reporting/linkedin/overview response into the per-row stats
// fields the dashboard reads. Source-agnostic keys (sent, replies) are
// populated so the CampaignsTable columns show real LinkedIn numbers
// instead of '-' (HR's pattern, which we're improving on). LinkedIn-
// specific keys mirror sync-heyreach-campaigns' stats_cache shape so
// the Messages Breakdown tooltip aggregates cleanly across HR + Reply.io.
//
// Per Step 3a spec: sent = messagesSent ONLY (does NOT include
// connectionsSent — connection requests are reported separately in
// linkedinConnectionsSent and aren't conceptually "messages").
function formatLinkedinStats(raw: Record<string, unknown>): Record<string, number> {
  const messagesSent        = pickNumber(raw, ['messagesSent']);
  const replied             = pickNumber(raw, ['replied']);
  const connectionsSent     = pickNumber(raw, ['connectionsSent']);
  const connectionsAccepted = pickNumber(raw, ['connectionsAccepted']);
  return {
    sent: messagesSent,
    replies: replied,
    linkedinMessagesSent: messagesSent,
    linkedinReplies: replied,
    linkedinConnectionsSent: connectionsSent,
    linkedinConnectionsAccepted: connectionsAccepted,
  };
}

// Shape a /reporting/emails/overview response into the per-row stats
// fields the dashboard reads. Keys mirror sync-smartlead-campaigns'
// per-row stats EXACTLY so the same dashboard cells work without any
// per-platform branch.
function formatEmailStats(raw: Record<string, unknown>): Record<string, number> {
  return {
    // delivered ≈ "successfully sent" — same semantic as SL's `sent`.
    sent: pickNumber(raw, ['delivered']),
    opens: pickNumber(raw, ['opened']),
    replies: pickNumber(raw, ['replied']),
    bounces: pickNumber(raw, ['bounced']),
    peopleCount: pickNumber(raw, ['contacted']),
  };
}

// Walk /v3/sequences with top + skip until hasMore=false or we get a short
// read. Safety cap at 10k to bound a runaway loop (typical workspace has
// dozens, not thousands).
async function fetchAllSequencesV3(
  apiKey: string,
  pageSize: number = 100,
): Promise<ReplyioSequence[]> {
  const all: ReplyioSequence[] = [];
  let skip = 0;
  for (let page = 1; page <= 100; page++) {
    const url = `/sequences?top=${pageSize}&skip=${skip}`;
    const resp = await fetchV3WithRetry<V3SequencesPage>(url, apiKey);
    const items = Array.isArray(resp.items) ? resp.items : [];
    if (items.length === 0) break;
    all.push(...items);
    console.log(`  /sequences page ${page} (skip=${skip}): fetched ${items.length}, total ${all.length}`);
    if (resp.hasMore === false) break;
    if (items.length < pageSize) break; // defensive: short read means end
    skip += items.length;
    if (all.length > 10000) {
      console.warn(`Reached safety cap (10k sequences); stopping pagination`);
      break;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

// NOTE: Contact sync was intentionally removed from this function.
// Rationale: syncing contacts for many campaigns can exceed request time
// limits. Contacts + per-campaign stats are synced via the separate
// `sync-reply-contacts` function.

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let integrationId: string | undefined;
  let authHeader: string | null = null;
  let campaignsProcessed = 0;
  let campaignsFailed = 0;

  try {
    authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    integrationId = body.integrationId;

    // Internal service-role call via x-agent-key vs user JWT — unchanged.
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");
    const isInternalCall = !!(agentKey && expectedAgentKey && agentKey === expectedAgentKey);

    let supabase;
    if (isInternalCall) {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        serviceRoleKey,
      );
      console.log("Using service role client (internal auto-sync call)");
    } else {
      supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
    }

    if (!integrationId) {
      throw new Error("Missing integrationId");
    }

    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, platform, reply_team_id, stats_cache")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      throw new Error("Integration not found or access denied");
    }

    if (integration.platform !== "reply.io") {
      throw new Error("This function only supports Reply.io integrations");
    }

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const replyTeamId = integration.reply_team_id; // workspace scope, set at integration-create time

    await supabase
      .from("outbound_integrations")
      .update({ sync_status: "syncing", sync_error: null })
      .eq("id", integrationId);

    console.log(`Starting v3 sync for integration ${integrationId}${replyTeamId ? ` (workspace: ${replyTeamId})` : ''}`);

    // Fetch every sequence the key can see, then filter to this workspace.
    // Workspace keys (the normal case) return a single workspace's sequences
    // — the filter is a no-op. Agency keys would return multiple teams; the
    // filter drops the rest.
    let sequences: ReplyioSequence[];
    try {
      sequences = await fetchAllSequencesV3(apiKey);
      console.log(`Fetched ${sequences.length} total sequences from Reply.io v3`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Failed to fetch sequences:", err);
      throw new Error(`Failed to fetch sequences: ${errorMessage}`);
    }

    if (replyTeamId) {
      // Workspace-vs-agency filter. Workspace keys (the normal case) return
      // sequences with teamId === null because the KEY itself is the
      // isolation boundary — there's no peer team to disambiguate from.
      // Agency keys return seq.teamId populated per-row, and we filter to
      // the requested team. So: include a sequence iff its teamId is
      // null/undefined (workspace case, key already scoped) OR matches the
      // configured workspace (agency case). Only EXCLUDE when teamId is
      // present AND non-matching.
      const wanted = parseInt(replyTeamId, 10);
      const before = sequences.length;
      sequences = sequences.filter(seq => {
        const keep = seq.teamId == null || seq.teamId === wanted;
        if (!keep) {
          console.log(`Sequence ${seq.id} (${seq.name}) teamId=${seq.teamId} ≠ ${wanted}, excluding`);
        }
        return keep;
      });
      console.log(`After workspace filter (teamId=${wanted}): ${sequences.length}/${before}`);
    }

    // Drop archived sequences — Reply.io shows them in lists but they're
    // not actionable for sync purposes.
    const beforeArchive = sequences.length;
    sequences = sequences.filter(seq => !seq.isArchived);
    console.log(`After archive filter: ${sequences.length}/${beforeArchive} active`);

    const syncedCampaignIds: { internal: string; external: string }[] = [];

    // Step 3a: per-sync aggregators + tripwires.
    //
    // loggedLinkedinKeys / loggedEmailKeys — log the first /reporting
    // response's top-level keys ONCE per sync. The response fields are
    // verified against CYPR but logging is a cheap tripwire if Reply.io
    // changes the shape later (same idea as fetchSmartleadStats'
    // analyticsKeysLogged flag).
    //
    // cacheLinkedin* — running sum across this integration's linkedin +
    // multichannel sequences. Folded into outbound_integrations.stats_cache
    // after the loop so the Messages Breakdown tooltip sees Reply.io
    // contribution alongside HR's.
    //
    // linkedinEligibleCount — how many sequences we ATTEMPTED LinkedIn
    // reporting for. Drives the post-loop stats_cache write decision:
    // 0 means no linkedin/multichannel sequences exist, so leave cache
    // untouched; >0 means write the sums even if some calls failed
    // (zeros are honest — "we couldn't get data this sync" — and the
    // next successful sync overwrites).
    let loggedLinkedinKeys = false;
    let loggedEmailKeys = false;
    let cacheLinkedinMessagesSent = 0;
    let cacheLinkedinReplies = 0;
    let cacheLinkedinConnectionsSent = 0;
    let cacheLinkedinConnectionsAccepted = 0;
    let linkedinEligibleCount = 0;

    for (const sequence of sequences) {
      try {
        if (!sequence.id || !sequence.name) {
          console.warn(`Skipping sequence with missing id or name`);
          campaignsFailed++;
          continue;
        }

        console.log(`Processing sequence: ${sequence.name} (ID: ${sequence.id})`);

        // Dedupe: pick the OLDEST existing row for this (team, external_id)
        // — not scoped to integration_id so we catch orphaned dupes from
        // earlier syncs. Same pattern as the v1 version.
        const { data: existingCampaigns } = await supabase
          .from("synced_campaigns")
          .select("id, stats, is_linked, integration_id")
          .eq("team_id", teamId)
          .eq("external_campaign_id", String(sequence.id))
          .order("created_at", { ascending: true });

        const existingCampaign = existingCampaigns && existingCampaigns.length > 0
          ? existingCampaigns[0]
          : null;

        if (existingCampaigns && existingCampaigns.length > 1) {
          console.log(`Found ${existingCampaigns.length} duplicate campaigns for ${sequence.id}, using oldest: ${existingCampaign?.id}`);
        }

        const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};

        // Preserve is_linked: if campaign exists, keep user's choice; if
        // new, default to true (matches v1 behavior).
        const isLinked = existingCampaign ? existingCampaign.is_linked : true;

        // Preserve LinkedIn fields from existing stats.
        const linkedinStats: Record<string, unknown> = {};
        for (const field of LINKEDIN_FIELDS) {
          if (existingStats[field] !== undefined) {
            linkedinStats[field] = existingStats[field];
          }
        }

        // Preserve email CSV upload fields from existing stats.
        const emailUploadStats: Record<string, unknown> = {};
        for (const field of EMAIL_UPLOAD_FIELDS) {
          if (existingStats[field] !== undefined) {
            emailUploadStats[field] = existingStats[field];
          }
        }

        // Per-sequence channel classification. Reply.io is the only
        // multichannel platform we sync — HR and SL hardcode their channel
        // at the sync site, but a Reply.io sequence can be LinkedIn-only,
        // email-only, or mixed, and the /v3/sequences list response carries
        // no channel hint. So we pay one extra API call per sequence to
        // inspect its steps. `classifiedChannel === undefined` means the
        // steps fetch failed (rate-limit exhaust, transient error); we
        // preserve the existing channel value on UPDATE in that case rather
        // than clobbering it with null.
        let classifiedChannel: string | null | undefined = undefined;
        try {
          const steps = await fetchSequenceStepsV3(sequence.id, apiKey);
          classifiedChannel = classifyChannel(steps);
          console.log(`  channel: ${classifiedChannel ?? '(null — no email/linkedIn steps)'}`);
        } catch (stepsErr) {
          const msg = stepsErr instanceof Error ? stepsErr.message : String(stepsErr);
          console.warn(`  Failed to fetch steps for sequence ${sequence.id}, leaving channel unchanged: ${msg}`);
        }

        // Step 3a: route reporting fetch by channel. Per-channel failures
        // are isolated — a 429 on the linkedin call for a multichannel
        // sequence still lets us write the email half. A pure-channel
        // failure leaves THIS row's existing stats untouched and the
        // loop continues to the next sequence.
        let linkedinRaw: Record<string, unknown> | null = null;
        let emailRaw: Record<string, unknown> | null = null;

        if (classifiedChannel === 'linkedin' || classifiedChannel === 'multichannel') {
          linkedinEligibleCount++;
          try {
            linkedinRaw = await fetchReplyIoReporting('linkedin', sequence.id, apiKey);
            if (!loggedLinkedinKeys) {
              console.log(`[reporting/linkedin] first-call response keys for seq ${sequence.id}:`, Object.keys(linkedinRaw));
              loggedLinkedinKeys = true;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`  reporting/linkedin failed for seq ${sequence.id}, leaving existing stats: ${msg}`);
          }
        }

        if (classifiedChannel === 'email' || classifiedChannel === 'multichannel') {
          try {
            emailRaw = await fetchReplyIoReporting('email', sequence.id, apiKey);
            if (!loggedEmailKeys) {
              console.log(`[reporting/emails] first-call response keys for seq ${sequence.id}:`, Object.keys(emailRaw));
              loggedEmailKeys = true;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`  reporting/emails failed for seq ${sequence.id}, leaving existing stats: ${msg}`);
          }
        }

        // Compose the reporting stats overlay. Multichannel merges both
        // shapes per spec: linkedin's keys verbatim + email's source-
        // agnostic keys, with `sent` and `replies` SUMMED across channels.
        let reportingStats: Record<string, unknown> = {};
        if (linkedinRaw) {
          const li = formatLinkedinStats(linkedinRaw);
          reportingStats = { ...li, reply_io_raw_linkedin_reporting: linkedinRaw };
          // Accumulate into the integration-level stats_cache write.
          cacheLinkedinMessagesSent       += li.linkedinMessagesSent;
          cacheLinkedinReplies            += li.linkedinReplies;
          cacheLinkedinConnectionsSent    += li.linkedinConnectionsSent;
          cacheLinkedinConnectionsAccepted += li.linkedinConnectionsAccepted;
        }
        if (emailRaw) {
          const em = formatEmailStats(emailRaw);
          if (linkedinRaw) {
            // Multichannel — overlay email metrics on top of LI's. `sent`
            // and `replies` SUM across channels so the dashboard reflects
            // total outreach volume; the LI-prefixed keys stay isolated
            // for the LinkedIn tooltip aggregation.
            reportingStats = {
              ...reportingStats,
              sent:    ((reportingStats.sent    as number | undefined) ?? 0) + em.sent,
              replies: ((reportingStats.replies as number | undefined) ?? 0) + em.replies,
              opens:       em.opens,
              bounces:     em.bounces,
              peopleCount: em.peopleCount,
              reply_io_raw_email_reporting: emailRaw,
            };
          } else {
            // Pure email.
            reportingStats = { ...em, reply_io_raw_email_reporting: emailRaw };
          }
        }

        // Compose mergedStats. Spread order matters:
        //   existingStats         — baseline (everything currently there)
        //   reportingStats        — overlay fresh API stats (Step 3a)
        //   linkedinStats         — re-overlay user-curated CSV uploads
        //                            (these WIN over fresh API numbers —
        //                            same precedence the v1 sync had)
        //   emailUploadStats      — re-overlay CSV email uploads
        //   replyTeamId           — pinned fresh from sequence.teamId
        const mergedStats: Record<string, unknown> = {
          ...existingStats,
          ...reportingStats,
          ...linkedinStats,
          ...emailUploadStats,
          replyTeamId: sequence.teamId ?? (existingStats.replyTeamId as number | undefined) ?? undefined,
        };

        // Update vs insert — using the oldest existing row's ID preserves
        // the campaign UUID across syncs (contacts/sequences/etc. all FK
        // to it).
        let upsertedCampaignId: string | null = null;
        let campaignError: { message: string } | null = null;

        if (existingCampaign) {
          // UPDATE existing campaign. Setting source: 'reply_io' here
          // ALSO fixes any row that was mislabeled by the prior v1 sync
          // (which omitted source, defaulting to 'heyreach' via the
          // column default — the diagnosed bug).
          const { error } = await supabase
            .from("synced_campaigns")
            .update({
              integration_id: integrationId,
              source: 'reply_io',
              name: String(sequence.name || 'Unnamed Sequence'),
              status: normalizeStatus(sequence.status),
              stats: mergedStats,
              raw_data: sequence,
              is_linked: isLinked,
              // Only write channel when classification succeeded —
              // undefined means "leave the existing column value alone".
              ...(classifiedChannel !== undefined ? { channel: classifiedChannel } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingCampaign.id);

          if (error) {
            campaignError = error;
          } else {
            upsertedCampaignId = existingCampaign.id;
            console.log(`Updated existing campaign ${existingCampaign.id} for sequence ${sequence.id}`);
          }
        } else {
          // INSERT new campaign — source MUST be explicit. The column
          // default is 'heyreach' (legacy), so omitting it silently
          // mislabels.
          const { data, error } = await supabase
            .from("synced_campaigns")
            .insert({
              integration_id: integrationId,
              team_id: teamId,
              source: 'reply_io',
              external_campaign_id: String(sequence.id),
              name: String(sequence.name || 'Unnamed Sequence'),
              status: normalizeStatus(sequence.status),
              stats: mergedStats,
              raw_data: sequence,
              is_linked: isLinked,
              // null on classification failure — new row has no existing
              // value to preserve, so explicit NULL is the honest default
              // ("we don't know yet"). Next sync will re-classify.
              channel: classifiedChannel ?? null,
            })
            .select("id")
            .single();

          if (error) {
            campaignError = error;
          } else {
            upsertedCampaignId = data?.id || null;
            console.log(`Created new campaign ${upsertedCampaignId} for sequence ${sequence.id}`);
          }
        }

        if (campaignError) {
          console.error(`Failed to upsert sequence ${sequence.id}:`, campaignError);
          campaignsFailed++;
          continue;
        }

        campaignsProcessed++;

        if (upsertedCampaignId) {
          syncedCampaignIds.push({
            internal: upsertedCampaignId,
            external: String(sequence.id),
          });
        }

        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (sequenceError) {
        console.error(`Error processing sequence ${sequence.id}:`, sequenceError);
        campaignsFailed++;
      }
    }

    console.log(`Campaign sync complete: ${campaignsProcessed}/${sequences.length} sequences`);

    const finalStatus = campaignsFailed > 0 && campaignsProcessed === 0 ? "error" : "synced";
    const syncError = campaignsFailed > 0
      ? `Synced ${campaignsProcessed}/${sequences.length} sequences (${campaignsFailed} failed)`
      : null;

    // Step 3a: fold LinkedIn aggregates into outbound_integrations.stats_cache
    // so the Messages Breakdown tooltip (usePlaygroundStats:182-188) sees
    // Reply.io's LinkedIn contribution alongside HR's. Only write when at
    // least one linkedin/multichannel sequence was processed — if none were
    // eligible this sync, leave the prior stats_cache alone rather than
    // wiping it.
    //
    // The spread preserves any other keys an existing stats_cache might
    // carry (future-proofs for non-linkedin keys); the linkedin* keys are
    // replaced wholesale with this sync's aggregates (zeros included —
    // honest "no data fetched" when all per-sequence reporting failed).
    let statsCachePatch: Record<string, unknown> | null = null;
    if (linkedinEligibleCount > 0) {
      const existingStatsCache =
        (integration.stats_cache as Record<string, unknown> | null) ?? {};
      statsCachePatch = {
        ...existingStatsCache,
        linkedinMessagesSent: cacheLinkedinMessagesSent,
        linkedinReplies: cacheLinkedinReplies,
        linkedinConnectionsSent: cacheLinkedinConnectionsSent,
        linkedinConnectionsAccepted: cacheLinkedinConnectionsAccepted,
        cached_at: new Date().toISOString(),
      };
      console.log(`stats_cache linkedin sums: messagesSent=${cacheLinkedinMessagesSent}, replies=${cacheLinkedinReplies}, connectionsSent=${cacheLinkedinConnectionsSent}, connectionsAccepted=${cacheLinkedinConnectionsAccepted} (over ${linkedinEligibleCount} eligible sequences)`);
    }

    await supabase
      .from("outbound_integrations")
      .update({
        sync_status: finalStatus,
        sync_error: syncError,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(statsCachePatch ? { stats_cache: statsCachePatch } : {}),
      })
      .eq("id", integrationId);

    console.log(`Sync complete: ${campaignsProcessed} campaigns`);

    return new Response(
      JSON.stringify({
        success: true,
        campaigns: campaignsProcessed,
        campaignsFailed,
        mode: "v3-sequences",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Sync error:", err);

    if (integrationId && authHeader) {
      try {
        const agentKeyErr = req.headers.get("x-agent-key");
        const expectedKeyErr = Deno.env.get("AGENT_API_KEY");
        const isInternalErr = !!(agentKeyErr && expectedKeyErr && agentKeyErr === expectedKeyErr);

        const supabase = isInternalErr
          ? createClient(
              Deno.env.get("SUPABASE_URL") ?? "",
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
            )
          : createClient(
              Deno.env.get("SUPABASE_URL") ?? "",
              Deno.env.get("SUPABASE_ANON_KEY") ?? "",
              { global: { headers: { Authorization: authHeader } } }
            );

        await supabase
          .from("outbound_integrations")
          .update({
            sync_status: "error",
            sync_error: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integrationId);
      } catch (updateError) {
        console.error("Failed to update error status:", updateError);
      }
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
