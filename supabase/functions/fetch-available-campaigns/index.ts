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
      "authorization, x-client-info, apikey, content-type",
  };
}

// ---------------------------------------------------------------------------
// Reply.io v3-only. The previous version mixed v1 (/campaigns) with v3
// (/sequences) and authed via X-Api-Key; both are gone.
//
// v3 returns teamId inline on every sequence, so the X-Reply-Team-Id
// request header (v1-era) is unnecessary — we filter client-side. The old
// "fetch each team separately" loop collapses into one bulk fetch + a
// teamId predicate.
// ---------------------------------------------------------------------------

const REPLY_API_V3 = "https://api.reply.io/v3";

interface ReplyioSequence {
  id: number;
  name: string;
  status: string;
  teamId?: number;
  ownerUserId?: number;
  ownerId?: number;
  isArchived?: boolean;
  peopleCount?: number; // not all v3 list responses include this; tolerate missing
}

interface V3SequencesPage {
  items?: ReplyioSequence[];
  hasMore?: boolean;
}

// v3 status is already a lowercase-friendly string.
function normalizeStatus(status: unknown): string {
  return typeof status === 'string' ? status.toLowerCase() : 'unknown';
}

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

// Walk /v3/sequences with top + skip. Same shape as sync-reply-campaigns'
// pagination loop — duplicated here so this function stays standalone.
async function fetchAllSequencesV3(
  apiKey: string,
  pageSize: number = 100,
): Promise<ReplyioSequence[]> {
  const all: ReplyioSequence[] = [];
  let skip = 0;
  for (let page = 1; page <= 100; page++) {
    const url = `/sequences?top=${pageSize}&skip=${skip}`;
    const resp = await fetchV3<V3SequencesPage>(url, apiKey);
    const items = Array.isArray(resp.items) ? resp.items : [];
    if (items.length === 0) break;
    all.push(...items);
    console.log(`  /sequences page ${page} (skip=${skip}): fetched ${items.length}, total ${all.length}`);
    if (resp.hasMore === false) break;
    if (items.length < pageSize) break;
    skip += items.length;
    if (all.length > 10000) {
      console.warn(`Reached safety cap (10k sequences); stopping pagination`);
      break;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    const { integrationId, skipTeamFilter, autoLinkOnFirstSync } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    if (!integrationId) {
      throw new Error("Missing integrationId");
    }

    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, platform, reply_team_id, links_initialized")
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
    const replyTeamId = integration.reply_team_id;
    const linksInitialized = integration.links_initialized ?? false;

    // Auto-link only on the first-ever sync of this integration.
    const shouldAutoLink = autoLinkOnFirstSync === true && !linksInitialized;
    console.log(`Auto-link decision: autoLinkOnFirstSync=${autoLinkOnFirstSync}, linksInitialized=${linksInitialized}, shouldAutoLink=${shouldAutoLink}`);

    // One bulk fetch — v3 returns teamId on every row, so we filter
    // client-side instead of looping per-team.
    const allSequences = await fetchAllSequencesV3(apiKey);
    console.log(`Fetched ${allSequences.length} total sequences from Reply.io v3`);

    // Apply workspace filter. skipTeamFilter=true returns every team's
    // sequences (agency-discovery flow); else scope to the integration's
    // reply_team_id (the normal workspace-key path).
    let teamFiltered: boolean;
    let effectiveTeamId: string | null;
    let scopedSequences: ReplyioSequence[];

    if (skipTeamFilter) {
      console.log(`skipTeamFilter=true → returning sequences from ALL teams visible to this key`);
      scopedSequences = allSequences;
      teamFiltered = false;
      effectiveTeamId = null;
    } else if (replyTeamId) {
      effectiveTeamId = replyTeamId;
      const wanted = parseInt(replyTeamId, 10);
      const before = allSequences.length;
      scopedSequences = allSequences.filter(seq => seq.teamId === wanted);
      teamFiltered = true;
      console.log(`Filtered to workspace teamId=${wanted}: ${scopedSequences.length}/${before}`);
    } else {
      // No replyTeamId on the integration — return everything visible.
      // (Edge case: keys created before workspace auto-detect existed.)
      console.log(`No reply_team_id set on integration; returning all sequences (no scope)`);
      scopedSequences = allSequences;
      teamFiltered = false;
      effectiveTeamId = null;
    }

    // Drop archived — same semantics as sync-reply-campaigns.
    scopedSequences = scopedSequences.filter(seq => !seq.isArchived);
    console.log(`After archive filter: ${scopedSequences.length} sequences`);

    // Count unique teams across the returned set (informational for the
    // frontend's agency-detection UI).
    const uniqueTeamIds = [...new Set(scopedSequences.map(s => s.teamId).filter((t): t is number => typeof t === 'number'))];
    const teamsCount = uniqueTeamIds.length || 1;

    // Look up existing rows so we can preserve is_linked + stats.
    const { data: existingCampaigns } = await supabase
      .from("synced_campaigns")
      .select("external_campaign_id, is_linked, stats")
      .eq("integration_id", integrationId);

    const existingMap = new Map<string, { is_linked: boolean; stats: Record<string, unknown> | null }>();
    (existingCampaigns || []).forEach(c => {
      existingMap.set(c.external_campaign_id, {
        is_linked: c.is_linked,
        stats: c.stats as Record<string, unknown> | null,
      });
    });

    // Build upsert payloads. source: 'reply_io' is HARDCODED — the column
    // default is 'heyreach', so omitting it was the diagnosed mislabel bug.
    const campaignsToUpsert = scopedSequences.map(sequence => {
      const existing = existingMap.get(String(sequence.id));

      // Preserve any prior stats; v3 list endpoint doesn't carry per-
      // sequence numeric counters (Step 3 will fetch those via reporting).
      // peopleCount tolerated when present, kept fresh.
      const existingStats = existing?.stats || {};
      const mergedStats: Record<string, unknown> = {
        ...existingStats,
        peopleCount: sequence.peopleCount ?? (existingStats.peopleCount as number | undefined) ?? 0,
        replyTeamId: sequence.teamId ?? (existingStats.replyTeamId as number | undefined) ?? null,
      };

      let isLinked: boolean;
      if (existing !== undefined) {
        isLinked = existing.is_linked;
      } else if (shouldAutoLink) {
        isLinked = true;
        console.log(`Auto-linking new campaign: ${sequence.name} (${sequence.id})`);
      } else {
        isLinked = false;
      }

      return {
        integration_id: integrationId,
        team_id: teamId,
        source: 'reply_io', // hardcoded — DO NOT remove (fixes default='heyreach' mislabel)
        external_campaign_id: String(sequence.id),
        name: String(sequence.name || 'Unnamed Sequence'),
        status: normalizeStatus(sequence.status),
        stats: mergedStats,
        is_linked: isLinked,
        updated_at: new Date().toISOString(),
      };
    });

    if (campaignsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from("synced_campaigns")
        .upsert(campaignsToUpsert, {
          onConflict: "integration_id,external_campaign_id",
        });

      if (upsertError) {
        console.error("Failed to upsert campaigns:", upsertError);
        throw new Error(`Failed to save campaigns: ${upsertError.message}`);
      }

      console.log(`Upserted ${campaignsToUpsert.length} campaigns`);
    }

    if (shouldAutoLink && campaignsToUpsert.length > 0) {
      const { error: updateError } = await supabase
        .from("outbound_integrations")
        .update({ links_initialized: true })
        .eq("id", integrationId);

      if (updateError) {
        console.warn("Failed to set links_initialized:", updateError);
      } else {
        console.log("Set links_initialized = true for integration");
      }
    }

    const result = scopedSequences.map(sequence => {
      const existing = existingMap.get(String(sequence.id));
      let isLinked: boolean;
      if (existing !== undefined) {
        isLinked = existing.is_linked;
      } else if (shouldAutoLink) {
        isLinked = true;
      } else {
        isLinked = false;
      }

      return {
        id: String(sequence.id),
        name: sequence.name,
        status: normalizeStatus(sequence.status),
        peopleCount: sequence.peopleCount ?? 0,
        isLinked,
        replyTeamId: sequence.teamId ?? null,
      };
    });

    const responsePayload: Record<string, unknown> = {
      success: true,
      campaigns: result,
      total: result.length,
      teamsCount,
      teamFiltered,
      teamId: effectiveTeamId,
      autoLinked: shouldAutoLink,
      linkedCount: result.filter(c => c.isLinked).length,
    };

    if (!teamFiltered) {
      responsePayload.discoveredTeamIds = uniqueTeamIds.slice(0, 50).map(String);
      responsePayload.discoveredTeamsCount = uniqueTeamIds.length;
    }

    return new Response(
      JSON.stringify(responsePayload),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Fetch campaigns error:", err);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
