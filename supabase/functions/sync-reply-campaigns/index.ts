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
// Stats fetching is intentionally NOT included here (was the old V1
// /campaigns sidecar). Step 3 will add the /v3/reporting/* endpoints to
// generate-client-analysis; until then sync only writes campaign metadata
// (name/status) and preserves any stats already on the row (LinkedIn /
// email CSV uploads).
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

// v3 returns status as a lowercase-friendly string already; just normalize.
function normalizeStatus(status: unknown): string {
  return typeof status === 'string' ? status.toLowerCase() : 'unknown';
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
      .select("id, team_id, api_key_encrypted, platform, reply_team_id")
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
      const wanted = parseInt(replyTeamId, 10);
      const before = sequences.length;
      sequences = sequences.filter(seq => {
        if (seq.teamId === undefined) {
          console.log(`Sequence ${seq.id} (${seq.name}) has no teamId, excluding`);
          return false;
        }
        return seq.teamId === wanted;
      });
      console.log(`After workspace filter (teamId=${wanted}): ${sequences.length}/${before}`);
    }

    // Drop archived sequences — Reply.io shows them in lists but they're
    // not actionable for sync purposes.
    const beforeArchive = sequences.length;
    sequences = sequences.filter(seq => !seq.isArchived);
    console.log(`After archive filter: ${sequences.length}/${beforeArchive} active`);

    const syncedCampaignIds: { internal: string; external: string }[] = [];

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

        // Step 2 scope: no API stats fetched. We keep existing stats as-is
        // (LinkedIn + CSV upload values are preserved). Step 3 will overlay
        // fresh /v3/reporting numbers via generate-client-analysis.
        const mergedStats: Record<string, unknown> = {
          ...existingStats,
          ...linkedinStats,
          ...emailUploadStats,
          // Keep replyTeamId fresh on the row for downstream reporting.
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

    await supabase
      .from("outbound_integrations")
      .update({
        sync_status: finalStatus,
        sync_error: syncError,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
