// [generate-client-analysis v1]
//
// Data Analysis Phase 1 — internal admin function.
//
// Auth: JWT-only (manual button click; no x-agent-key cron path).
// Defense-in-depth admin check: caller must have profiles.is_platform_admin
// even though the UI tab is also gated. Belt + suspenders because the
// edge function is reachable via direct API call regardless of UI gating.
//
// Flow:
//   1. Auth caller, verify is_platform_admin.
//   2. Load client_analysis row (verifies user_id ownership via RLS).
//   3. Resolve range -> {startDate, endDate}.
//   4. Fetch HeyReach overall stats (reuses /stats/GetOverallStats pattern
//      from sync-heyreach-campaigns:163-200, but at account level for the
//      date range instead of per-campaign over a trailing window).
//   5. Fetch Smartlead per-campaign analytics-by-date. Defensive field
//      extraction mirrors sync-smartlead-campaigns' pickNumber pattern
//      because Smartlead's analytics-by-date response shape isn't fully
//      documented; first real call logs the keys so we can tighten later.
//   6. Merge into one stats object (cross-platform totals + per-platform
//      breakdowns) for both UI display and the Claude prompt.
//   7. Call Claude (Sonnet 4.5, same call shape as generate-copy) -> expect
//      strict JSON {"analysis": "...", "priorities": ["..."]}.
//   8. Persist:
//      - client_analysis: analysis_text, stats_snapshot, last_generated_at,
//        last_range.
//      - client_checklist_items: ADDITIVE merge. Insert any priorities whose
//        normalized text (lowercased, whitespace-collapsed) doesn't already
//        appear in existing items. Existing items (including checked-off
//        ones) are NEVER deleted or modified. This is the spec's critical
//        persistence guarantee.
//
// API key reads: outbound_integrations.api_key_encrypted is plaintext today
// despite the name; see sync-smartlead-campaigns header for the documentation
// on this. We don't decrypt — direct pass-through to the platform APIs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

const HEYREACH_API = "https://api.heyreach.io/api/public";
const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[generate-client-analysis] ${step}${detailsStr}`);
};

// ---- Range resolution ------------------------------------------------------
// All ranges resolved in UTC. The Smartlead /analytics-by-date endpoint caps
// the span at 30 days; 7d/30d fit by construction. For mtd we clamp the
// start to max(firstOfMonth, endDate - 30 days) so the last days of 31-day
// months don't produce a 31-day span and get rejected by Smartlead. Net
// effect: mtd reports the calendar month-to-date when feasible, and the
// last 30 days when the month is too long (Jan/Mar/May/Jul/Aug/Oct/Dec
// on day 31 only).

type Range = "7d" | "30d" | "mtd";

const MAX_SPAN_MS = 30 * 24 * 60 * 60 * 1000;

function resolveRange(range: Range): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = now;
  let startDate: Date;
  switch (range) {
    case "7d":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      startDate = new Date(now.getTime() - MAX_SPAN_MS);
      break;
    case "mtd": {
      const firstOfMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const earliestAllowed = new Date(now.getTime() - MAX_SPAN_MS);
      // Pick the later of the two so the span never exceeds 30 days.
      startDate = firstOfMonth.getTime() < earliestAllowed.getTime()
        ? earliestAllowed
        : firstOfMonth;
      break;
    }
  }
  return { startDate, endDate };
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pct(num: number, denom: number): number | null {
  if (!denom) return null;
  return Number(((num / denom) * 100).toFixed(2));
}

// Defensive numeric extraction (mirrors sync-smartlead-campaigns).
function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return 0;
}

// ---- HeyReach -------------------------------------------------------------

async function fetchHeyReachStats(
  apiKey: string,
  accountIds: number[],
  startDate: Date,
  endDate: Date,
): Promise<Record<string, number>> {
  if (accountIds.length === 0) {
    return { sent: 0, replies: 0, connections_sent: 0, connections_accepted: 0 };
  }

  const res = await fetch(`${HEYREACH_API}/stats/GetOverallStats`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      accountIds,
      campaignIds: [],
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logStep("HeyReach GetOverallStats failed", {
      status: res.status,
      body: errText.substring(0, 300),
    });
    return { sent: 0, replies: 0, connections_sent: 0, connections_accepted: 0 };
  }

  const body = await res.json();
  const overall = (body?.overallStats ?? {}) as Record<string, number>;
  return {
    sent: Number(overall.messagesSent ?? 0),
    replies: Number(overall.totalMessageReplies ?? 0),
    connections_sent: Number(overall.connectionsSent ?? 0),
    connections_accepted: Number(overall.connectionsAccepted ?? 0),
  };
}

// ---- Smartlead ------------------------------------------------------------

interface SmartleadCampaignStats {
  campaign_id: string;
  sent: number;
  replies: number;
  opens: number;
  clicks: number;
  bounces: number;
}

async function fetchSmartleadStats(
  apiKey: string,
  campaignIds: string[],
  startDate: Date,
  endDate: Date,
): Promise<{ totals: Record<string, number>; per_campaign: SmartleadCampaignStats[] }> {
  if (campaignIds.length === 0) {
    return {
      totals: { sent: 0, replies: 0, opens: 0, clicks: 0, bounces: 0 },
      per_campaign: [],
    };
  }

  const startYMD = toYMD(startDate);
  const endYMD = toYMD(endDate);

  let analyticsKeysLogged = false;
  const per_campaign: SmartleadCampaignStats[] = [];
  let sent = 0, replies = 0, opens = 0, clicks = 0, bounces = 0;

  for (const id of campaignIds) {
    const url = new URL(
      `${SMARTLEAD_API_BASE}/campaigns/${encodeURIComponent(id)}/analytics-by-date`,
    );
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("start_date", startYMD);
    url.searchParams.set("end_date", endYMD);

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        // Never log url (contains api_key) — only the path + status + body snippet.
        logStep(`Smartlead analytics-by-date ${res.status} for campaign ${id}`, {
          body: errText.substring(0, 300),
        });
        continue;
      }

      const a = await res.json().catch(() => ({}));
      if (!analyticsKeysLogged && a && typeof a === "object") {
        logStep("First /analytics-by-date keys", { keys: Object.keys(a) });
        analyticsKeysLogged = true;
      }

      const analytics = a as Record<string, unknown>;
      const campaignSent = pickNumber(analytics, [
        "sent", "sent_count", "total_sent", "sent_emails",
      ]);
      const campaignReplies = pickNumber(analytics, [
        "replies", "reply_count", "unique_replies", "replied",
      ]);
      const campaignOpens = pickNumber(analytics, [
        "opens", "open_count", "unique_opens", "unique_open_count", "opened",
      ]);
      const campaignClicks = pickNumber(analytics, [
        "clicks", "click_count", "unique_clicks", "unique_click_count", "clicked",
      ]);
      const campaignBounces = pickNumber(analytics, [
        "bounces", "bounce_count", "bounced",
      ]);

      per_campaign.push({
        campaign_id: id,
        sent: campaignSent,
        replies: campaignReplies,
        opens: campaignOpens,
        clicks: campaignClicks,
        bounces: campaignBounces,
      });
      sent += campaignSent;
      replies += campaignReplies;
      opens += campaignOpens;
      clicks += campaignClicks;
      bounces += campaignBounces;
    } catch (err) {
      logStep(`Smartlead /analytics-by-date error for campaign ${id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Gentle pacing — same shape sync-smartlead-campaigns uses.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    totals: { sent, replies, opens, clicks, bounces },
    per_campaign,
  };
}

// ---- Claude ---------------------------------------------------------------

interface ClaudeResult {
  analysis: string;
  priorities: string[];
}

async function callClaude(
  anthropicKey: string,
  displayName: string,
  range: Range,
  startDate: Date,
  endDate: Date,
  stats: Record<string, unknown>,
): Promise<ClaudeResult> {
  const systemPrompt = `You are an expert B2B outbound sales analyst writing a brief, data-grounded performance report for the team running outbound on behalf of a client.

Produce two outputs:

1. "analysis": a 2–4 paragraph performance write-up in markdown (headers, bullets, **bold** for emphasis are fine). Tone: professional, direct, data-grounded. Cite specific numbers from the stats. If something is concerning (e.g. high bounce rate, low reply rate, low connection-accept rate), call it out plainly. If activity is low or zero for the period, say so and explain what the stats DO show. Do NOT speculate beyond what the numbers support.

2. "priorities": an array of 3–6 short to-do strings. Each priority is one imperative-voice sentence stating a concrete next action the team should take. Be specific and tied to the data (e.g. "Investigate high bounce rate on campaign 11111 — currently 12.3% (>5% threshold)"). Avoid generic advice ("improve copy" is not actionable).

Client: ${displayName}
Range: ${range} (${toYMD(startDate)} to ${toYMD(endDate)})

Stats:
${JSON.stringify(stats, null, 2)}

Return STRICTLY valid JSON in this exact shape, with no preamble, no trailing prose, and no markdown fences around the JSON itself:
{"analysis": "...", "priorities": ["...", "..."]}`;

  const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        { role: "user", content: "Generate the analysis and priorities now." },
      ],
    }),
  });

  if (!claudeResponse.ok) {
    const err = await claudeResponse.text();
    logStep("Claude API error", { status: claudeResponse.status, body: err.substring(0, 300) });
    throw new Error(`Claude API ${claudeResponse.status}`);
  }

  const claudeData = await claudeResponse.json();
  const responseText = String(claudeData.content?.[0]?.text ?? "");

  // Strip ```json fences if Claude added them despite the instruction.
  const cleaned = responseText
    .replace(/^```json?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: ClaudeResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logStep("Claude returned non-JSON", { raw: responseText.substring(0, 500) });
    throw new Error("Claude response was not valid JSON");
  }

  if (typeof parsed.analysis !== "string" || !Array.isArray(parsed.priorities)) {
    throw new Error("Claude JSON missing expected shape {analysis, priorities[]}");
  }

  // Coerce + trim each priority; drop empties.
  parsed.priorities = parsed.priorities
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0);

  return parsed;
}

// ---- Checklist merge ------------------------------------------------------
// Case-insensitive + whitespace-normalized dedupe. New items inserted with
// their ORIGINAL Claude-returned text (we only normalize during comparison).

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---- Handler --------------------------------------------------------------

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "Anthropic API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      logStep("Auth failed", { error: authError?.message });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Defense-in-depth admin gate. UI tab is also hidden if not admin, but
    // the function is reachable via direct API call so we enforce here too.
    const adminCheck = await userClient
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!adminCheck.data?.is_platform_admin) {
      logStep("Non-admin caller blocked", { userId: user.id });
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const clientId = (body as { clientId?: string }).clientId;
    const range = (body as { range?: Range }).range;
    if (!clientId || !range || !["7d", "30d", "mtd"].includes(range)) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid clientId / range" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Service-role for the rest: RLS is already enforced by the explicit
    // user_id check we do below, and we need to bypass it for the checklist
    // sub-queries / inserts to run cleanly under one connection.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: clientRow, error: clientErr } = await supabase
      .from("client_analysis")
      .select("id, user_id, display_name, heyreach_account_ids, smartlead_campaign_ids")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !clientRow) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (clientRow.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { startDate, endDate } = resolveRange(range);
    logStep("Resolved range", { range, start: toYMD(startDate), end: toYMD(endDate) });

    // Resolve integration API keys. First active row per platform owned by
    // the admin user. Missing integration = zero stats for that platform
    // (still allows the run to complete with whatever does work).
    const { data: integrations } = await supabase
      .from("outbound_integrations")
      .select("platform, api_key_encrypted, is_active, created_by")
      .eq("created_by", user.id)
      .eq("is_active", true)
      .in("platform", ["heyreach", "smartlead"]);

    const heyreachKey =
      (integrations ?? []).find((r) => r.platform === "heyreach")?.api_key_encrypted ?? null;
    const smartleadKey =
      (integrations ?? []).find((r) => r.platform === "smartlead")?.api_key_encrypted ?? null;

    // ---- Fetch ----
    const heyreachStats = heyreachKey
      ? await fetchHeyReachStats(
          heyreachKey,
          clientRow.heyreach_account_ids ?? [],
          startDate,
          endDate,
        )
      : { sent: 0, replies: 0, connections_sent: 0, connections_accepted: 0 };

    const smartleadStats = smartleadKey
      ? await fetchSmartleadStats(
          smartleadKey,
          clientRow.smartlead_campaign_ids ?? [],
          startDate,
          endDate,
        )
      : { totals: { sent: 0, replies: 0, opens: 0, clicks: 0, bounces: 0 }, per_campaign: [] };

    // ---- Merge ----
    const totalSent = heyreachStats.sent + smartleadStats.totals.sent;
    const totalReplies = heyreachStats.replies + smartleadStats.totals.replies;
    const stats = {
      range,
      start_date: toYMD(startDate),
      end_date: toYMD(endDate),
      totals: {
        sent: totalSent,
        replies: totalReplies,
        reply_rate_pct: pct(totalReplies, totalSent),
        connections_sent: heyreachStats.connections_sent,
        connections_accepted: heyreachStats.connections_accepted,
        connection_accept_rate_pct: pct(
          heyreachStats.connections_accepted,
          heyreachStats.connections_sent,
        ),
        opens: smartleadStats.totals.opens,
        open_rate_pct: pct(smartleadStats.totals.opens, smartleadStats.totals.sent),
        clicks: smartleadStats.totals.clicks,
        click_rate_pct: pct(smartleadStats.totals.clicks, smartleadStats.totals.sent),
        bounces: smartleadStats.totals.bounces,
        bounce_rate_pct: pct(smartleadStats.totals.bounces, smartleadStats.totals.sent),
      },
      heyreach: heyreachStats,
      smartlead: smartleadStats,
    };

    // ---- Claude ----
    const { analysis, priorities } = await callClaude(
      anthropicKey,
      clientRow.display_name,
      range,
      startDate,
      endDate,
      stats,
    );

    // ---- Persist parent ----
    const { error: updateErr } = await supabase
      .from("client_analysis")
      .update({
        analysis_text: analysis,
        stats_snapshot: stats,
        last_generated_at: new Date().toISOString(),
        last_range: range,
      })
      .eq("id", clientId);
    if (updateErr) {
      logStep("client_analysis update failed", { error: updateErr.message });
      throw new Error("Failed to persist analysis");
    }

    // ---- Merge checklist (additive only) ----
    const { data: existing } = await supabase
      .from("client_checklist_items")
      .select("id, text, done, sort_order")
      .eq("client_analysis_id", clientId);

    const existingNormalized = new Set(
      (existing ?? []).map((r) => normalize(r.text as string)),
    );
    const maxSort = (existing ?? []).reduce(
      (m: number, r: { sort_order?: number }) =>
        Math.max(m, Number(r.sort_order ?? 0)),
      0,
    );

    const toInsert = priorities
      .filter((p) => !existingNormalized.has(normalize(p)))
      .map((p, i) => ({
        client_analysis_id: clientId,
        text: p,
        source: "generated" as const,
        done: false,
        sort_order: maxSort + i + 1,
      }));

    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from("client_checklist_items")
        .insert(toInsert);
      if (insertErr) {
        logStep("checklist insert failed", { error: insertErr.message });
        // Don't fail the whole request — the analysis itself persisted.
      }
    }

    // ---- Return current snapshot ----
    const { data: finalChecklist } = await supabase
      .from("client_checklist_items")
      .select("id, text, done, done_at, source, sort_order")
      .eq("client_analysis_id", clientId)
      .order("sort_order", { ascending: true });

    return new Response(
      JSON.stringify({
        analysis,
        stats,
        checklist: finalChecklist ?? [],
        inserted_priorities: toInsert.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("Fatal error", { error: msg });
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
