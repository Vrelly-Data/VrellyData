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
const REPLY_API_V3 = "https://api.reply.io/v3";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[generate-client-analysis] ${step}${detailsStr}`);
};

// ---- Range resolution ------------------------------------------------------
// All ranges resolved in UTC. The Smartlead /analytics-by-date endpoint caps
// the span at 30 days; 7d/30d/last_week fit by construction. For mtd we
// clamp the start to max(firstOfMonth, endDate - 30 days) so the last days
// of 31-day months don't produce a 31-day span and get rejected by
// Smartlead. last_week is exactly Monday 00:00 to Sunday 23:59:59 UTC of
// the PREVIOUS calendar week — the natural weekly-cadence default.

type Range = "7d" | "30d" | "mtd" | "last_week";

const MAX_SPAN_MS = 30 * 24 * 60 * 60 * 1000;

function resolveRange(range: Range): { startDate: Date; endDate: Date } {
  const now = new Date();
  let startDate: Date;
  let endDate: Date = now;
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
    case "last_week": {
      // Monday-as-week-start. getUTCDay(): Sun=0, Mon=1, …, Sat=6.
      // daysToThisMonday: 0 if today is Monday, 6 if Sunday — back-distance
      // to THIS week's Monday (or today if Monday). Then subtract 7 to
      // land on the PREVIOUS week's Monday at 00:00:00 UTC.
      const day = now.getUTCDay();
      const daysToThisMonday = (day + 6) % 7;
      const thisMonday = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - daysToThisMonday,
      ));
      const lastMonday = new Date(thisMonday);
      lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
      const lastSunday = new Date(thisMonday);
      lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
      lastSunday.setUTCHours(23, 59, 59, 999);
      startDate = lastMonday;
      endDate = lastSunday;
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
  // Display name resolved from synced_campaigns; falls back to campaign_id
  // when the campaign hasn't been synced yet (rare — admin picker pulls
  // from the same table).
  name: string;
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
  nameLookup: Map<string, string>,
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
        name: nameLookup.get(id) ?? id,
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

// ---- HeyReach per-campaign (range-scoped) --------------------------------
// Adds range-scoped per-campaign breakdown to stats_snapshot.heyreach so the
// bar chart can show LinkedIn campaigns alongside Smartlead campaigns. The
// account-level fetchHeyReachStats above is kept as belt-and-suspenders —
// the stat cards still read its aggregate numbers, and a total per-campaign
// failure cascade can't make the cards lie.
//
// Concurrency strategy (deliberately conservative on first deploy):
//   * BATCH_SIZE = 3 (NOT 5). HeyReach's actual rate limit isn't documented;
//     we have no observed data because the previous loop in
//     sync-heyreach-campaigns ran serially with a 300ms inter-call sleep.
//     If logs come back clean across a few real Generates we can bump to 5
//     (math in the design doc shows comfortable headroom either way).
//   * 200ms sleep BETWEEN batches; NO inter-call sleep WITHIN a batch.
//   * Promise.allSettled isolates a per-campaign failure to that one entry.
//   * 429 → single retry after 500ms. No backoff cascade — if a campaign
//     429s twice it gets omitted; the rest of the batch continues.
//
// Failure handling: per spec, omit failed campaigns from per_campaign[]
// entirely (a zero-bar is misleading; absence is honest). Track a partial
// flag so the chart can surface "some campaigns' data was unavailable".

interface HrPerCampaign {
  campaign_id: string;
  name: string;
  sent: number;
  replies: number;
  connections_sent: number;
  connections_accepted: number;
}

async function fetchOneHrCampaign(
  apiKey: string,
  campaign: { external_campaign_id: string; name: string },
  startDate: Date,
  endDate: Date,
): Promise<HrPerCampaign> {
  const body = JSON.stringify({
    accountIds: [],
    campaignIds: [Number(campaign.external_campaign_id)],
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });

  const fetchOnce = () =>
    fetch(`${HEYREACH_API}/stats/GetOverallStats`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });

  let res = await fetchOnce();
  logStep("HR per-campaign call", {
    campaign_id: campaign.external_campaign_id,
    status: res.status,
  });

  // Single 429 retry after a 500ms wait. NOT a cascade — if the second
  // call also 429s, we throw and Promise.allSettled records the rejection.
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 500));
    res = await fetchOnce();
    logStep("HR per-campaign 429 retry", {
      campaign_id: campaign.external_campaign_id,
      status: res.status,
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const overall = (json?.overallStats ?? {}) as Record<string, number>;

  return {
    campaign_id: campaign.external_campaign_id,
    name: campaign.name,
    sent: Number(overall.messagesSent ?? 0),
    replies: Number(overall.totalMessageReplies ?? 0),
    connections_sent: Number(overall.connectionsSent ?? 0),
    connections_accepted: Number(overall.connectionsAccepted ?? 0),
  };
}

async function fetchHeyReachPerCampaign(
  apiKey: string,
  campaigns: Array<{ external_campaign_id: string; name: string }>,
  startDate: Date,
  endDate: Date,
): Promise<{ per_campaign: HrPerCampaign[]; partial: boolean }> {
  if (campaigns.length === 0) {
    return { per_campaign: [], partial: false };
  }

  const BATCH_SIZE = 3;
  const INTER_BATCH_SLEEP_MS = 200;

  const per_campaign: HrPerCampaign[] = [];
  let anyFailed = false;

  for (let i = 0; i < campaigns.length; i += BATCH_SIZE) {
    const batch = campaigns.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((c) => fetchOneHrCampaign(apiKey, c, startDate, endDate)),
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        per_campaign.push(r.value);
      } else {
        anyFailed = true;
        logStep("HR per-campaign failed (omitted from chart)", {
          campaign_id: batch[j].external_campaign_id,
          error: String(r.reason).slice(0, 200),
        });
      }
    }

    if (i + BATCH_SIZE < campaigns.length) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_SLEEP_MS));
    }
  }

  return { per_campaign, partial: anyFailed };
}

// ---- Reply.io (range-scoped per-campaign) --------------------------------
// Mirrors the fetchHeyReachPerCampaign pattern exactly: BATCH_SIZE=3,
// 200ms inter-batch, Promise.allSettled per batch, 429 single-retry
// honoring Retry-After. Per-channel partial flags are SEPARATE so a
// failed linkedin call for a multichannel sequence doesn't poison the
// email side's flag.
//
// Multichannel sequences generate TWO tasks (one per channel) with the
// same external_campaign_id; the per_campaign[] arrays end up with the
// sequence's campaign_id duplicated across linkedin + email, which is the
// honest representation — the bar chart can render the two as separate
// bars with channel-distinct colors.
//
// channel=null sequences are skipped (Step 2.6's classifier refused to
// guess; we honor that here too).

// Reply.io's /v3/reporting/* filters accept EITHER `dateRangePreset`
// (only lastWeek/lastMonth/lastYear/allTime — verified live; presets
// like last7Days/last30Days/thisMonth return 400 "invalid format") OR
// explicit `from`/`to` ISO datetimes. We use from/to so the Reply.io
// window matches HR/SL exactly within the same report — all three
// platforms cover the identical period regardless of which range
// preset the admin picked.
//
// Verified format (live API, 2026-06-19): "YYYY-MM-DDTHH:mm:ssZ" — no
// milliseconds, trailing Z literal. JavaScript's Date.toISOString()
// returns "...Z" with .SSS milliseconds; we strip those so the request
// matches the verified-good shape exactly.
function toReplyIoISO(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Retry-After parser — seconds, capped at 30, defaults to 2 if missing.
function parseRetryAfterSeconds(header: string | null): number {
  if (!header) return 2;
  const n = Number(header);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 30);
  return 2;
}

interface ReplyIoTask {
  campaign_id: string;   // external_campaign_id (Reply.io sequence id as string)
  name: string;
  channel: "linkedin" | "email";
}

interface ReplyIoLinkedinPerCampaign {
  campaign_id: string;
  name: string;
  sent: number;                  // = messagesSent (per Step 3a convention)
  replies: number;               // = replied
  connections_sent: number;
  connections_accepted: number;
}

interface ReplyIoEmailPerCampaign {
  campaign_id: string;
  name: string;
  sent: number;                  // = delivered
  replies: number;               // = replied
  opens: number;                 // = opened
  clicks: number;                // not returned by Reply.io email reporting; 0
  bounces: number;               // = bounced
}

// One per-channel reporting call with 429 single-retry. Mirrors
// fetchOneHrCampaign's shape; throws on non-OK so Promise.allSettled
// records the rejection per-task.
async function fetchOneReplyIoTask(
  apiKey: string,
  task: ReplyIoTask,
  fromISO: string,
  toISO: string,
): Promise<Record<string, unknown>> {
  const path = task.channel === "linkedin"
    ? "/reporting/linkedin/overview"
    : "/reporting/emails/overview";
  const body = JSON.stringify({
    filters: {
      from: fromISO,
      to: toISO,
      sequenceIds: [Number(task.campaign_id)],
    },
  });
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  const doFetch = () => fetch(`${REPLY_API_V3}${path}`, {
    method: "POST",
    headers,
    body,
  });

  let res = await doFetch();
  logStep("Reply.io reporting call", {
    channel: task.channel,
    campaign_id: task.campaign_id,
    status: res.status,
  });

  if (res.status === 429) {
    const wait = parseRetryAfterSeconds(res.headers.get("Retry-After"));
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await doFetch();
    logStep("Reply.io reporting 429 retry", {
      channel: task.channel,
      campaign_id: task.campaign_id,
      status: res.status,
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  return (json && typeof json === "object")
    ? json as Record<string, unknown>
    : {};
}

async function fetchReplyIoStats(
  apiKey: string,
  campaigns: Array<{ external_campaign_id: string; name: string; channel: string | null }>,
  startDate: Date,
  endDate: Date,
): Promise<{
  linkedin: {
    sent: number;
    replies: number;
    connections_sent: number;
    connections_accepted: number;
    per_campaign: ReplyIoLinkedinPerCampaign[];
    per_campaign_partial: boolean;
  };
  email: {
    totals: { sent: number; replies: number; opens: number; clicks: number; bounces: number };
    per_campaign: ReplyIoEmailPerCampaign[];
    per_campaign_partial: boolean;
  };
}> {
  const empty = {
    linkedin: {
      sent: 0, replies: 0, connections_sent: 0, connections_accepted: 0,
      per_campaign: [] as ReplyIoLinkedinPerCampaign[],
      per_campaign_partial: false,
    },
    email: {
      totals: { sent: 0, replies: 0, opens: 0, clicks: 0, bounces: 0 },
      per_campaign: [] as ReplyIoEmailPerCampaign[],
      per_campaign_partial: false,
    },
  };

  if (campaigns.length === 0) return empty;

  // Flatten: multichannel sequences produce 2 tasks (one per channel).
  // Pure-channel sequences produce 1 task. channel=null sequences are
  // skipped entirely.
  const tasks: ReplyIoTask[] = [];
  for (const c of campaigns) {
    if (c.channel === "linkedin" || c.channel === "multichannel") {
      tasks.push({ campaign_id: c.external_campaign_id, name: c.name, channel: "linkedin" });
    }
    if (c.channel === "email" || c.channel === "multichannel") {
      tasks.push({ campaign_id: c.external_campaign_id, name: c.name, channel: "email" });
    }
  }

  if (tasks.length === 0) return empty;

  const BATCH_SIZE = 3;
  const INTER_BATCH_SLEEP_MS = 200;
  // Match HR/SL window EXACTLY — same Date bounds resolveRange returned,
  // formatted in the explicit ISO shape the API expects.
  const fromISO = toReplyIoISO(startDate);
  const toISO = toReplyIoISO(endDate);

  const linkedinPerCampaign: ReplyIoLinkedinPerCampaign[] = [];
  const emailPerCampaign: ReplyIoEmailPerCampaign[] = [];
  let linkedinPartial = false;
  let emailPartial = false;

  // First-call key tripwire per channel per invocation (same idea as
  // sync-reply-campaigns' loggedLinkedinKeys / loggedEmailKeys).
  let loggedLinkedinKeys = false;
  let loggedEmailKeys = false;

  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((t) => fetchOneReplyIoTask(apiKey, t, fromISO, toISO)),
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const task = batch[j];

      if (r.status === "fulfilled") {
        const raw = r.value;
        if (task.channel === "linkedin") {
          if (!loggedLinkedinKeys) {
            logStep("Reply.io /reporting/linkedin first-call keys", {
              keys: Object.keys(raw),
            });
            loggedLinkedinKeys = true;
          }
          linkedinPerCampaign.push({
            campaign_id: task.campaign_id,
            name: task.name,
            sent: pickNumber(raw, ["messagesSent"]),
            replies: pickNumber(raw, ["replied"]),
            connections_sent: pickNumber(raw, ["connectionsSent"]),
            connections_accepted: pickNumber(raw, ["connectionsAccepted"]),
          });
        } else {
          if (!loggedEmailKeys) {
            logStep("Reply.io /reporting/emails first-call keys", {
              keys: Object.keys(raw),
            });
            loggedEmailKeys = true;
          }
          emailPerCampaign.push({
            campaign_id: task.campaign_id,
            name: task.name,
            sent: pickNumber(raw, ["delivered"]),
            replies: pickNumber(raw, ["replied"]),
            opens: pickNumber(raw, ["opened"]),
            clicks: 0, // /reporting/emails/overview doesn't return clicks
            bounces: pickNumber(raw, ["bounced"]),
          });
        }
      } else {
        if (task.channel === "linkedin") {
          linkedinPartial = true;
          logStep("Reply.io reporting/linkedin per-campaign failed (omitted)", {
            campaign_id: task.campaign_id,
            error: String(r.reason).slice(0, 200),
          });
        } else {
          emailPartial = true;
          logStep("Reply.io reporting/emails per-campaign failed (omitted)", {
            campaign_id: task.campaign_id,
            error: String(r.reason).slice(0, 200),
          });
        }
      }
    }

    if (i + BATCH_SIZE < tasks.length) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_SLEEP_MS));
    }
  }

  // Aggregate totals from per_campaign[]. Failed campaigns are OMITTED
  // (matches HR pattern — partial flag is the signal, not zero bars).
  let liSent = 0, liReplies = 0, liConnSent = 0, liConnAcc = 0;
  for (const p of linkedinPerCampaign) {
    liSent     += p.sent;
    liReplies  += p.replies;
    liConnSent += p.connections_sent;
    liConnAcc  += p.connections_accepted;
  }
  let emSent = 0, emReplies = 0, emOpens = 0, emClicks = 0, emBounces = 0;
  for (const p of emailPerCampaign) {
    emSent    += p.sent;
    emReplies += p.replies;
    emOpens   += p.opens;
    emClicks  += p.clicks;
    emBounces += p.bounces;
  }

  return {
    linkedin: {
      sent: liSent,
      replies: liReplies,
      connections_sent: liConnSent,
      connections_accepted: liConnAcc,
      per_campaign: linkedinPerCampaign,
      per_campaign_partial: linkedinPartial,
    },
    email: {
      totals: { sent: emSent, replies: emReplies, opens: emOpens, clicks: emClicks, bounces: emBounces },
      per_campaign: emailPerCampaign,
      per_campaign_partial: emailPartial,
    },
  };
}

// ---- Responder breakdowns -------------------------------------------------
// Aggregate the PERIOD'S responders by (1) reply intent, (2) top job titles,
// (3) top industries — the concrete substance the analysis is grounded in.
// intent + job_title live on agent_leads; industry is joined from
// synced_contacts (by lower(email) or linkedin_url). Coverage is computed per
// dimension so the prompt can degrade gracefully when title/industry is sparse.

interface Breakdown {
  total: number; // responders in the period
  intent: Record<string, number>; // counts per intent (incl. 'unknown')
  intent_classified: number; // responders with a real (non-unknown) intent
  titles: { name: string; count: number }[]; // top titles, desc
  title_coverage: number; // 0..1 share of responders with a title
  industries: { name: string; count: number }[]; // top industries, desc
  industry_coverage: number; // 0..1 share with an industry (via join)
  company_sizes: { name: string; count: number }[]; // top company sizes, desc
  company_size_coverage: number; // 0..1 share with a company size (via join)
  locations: { name: string; count: number }[]; // top locations, desc
  location_coverage: number; // 0..1 share with a location (via join)
}

// Coverage gates: only surface title/industry when meaningfully populated, so
// the model never invents a pattern from a handful of rows.
const COVERAGE_MIN = 0.4; // ≥40% of responders have the field
const COVERAGE_MIN_COUNT = 5; // and at least this many non-null
const TOP_N = 5;

function topCounts(values: (string | null | undefined)[]): {
  top: { name: string; count: number }[];
  nonNull: number;
} {
  const counts = new Map<string, { name: string; count: number }>();
  let nonNull = 0;
  for (const raw of values) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    nonNull++;
    const key = v.toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.count++;
    else counts.set(key, { name: v, count: 1 }); // display first-seen casing
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, TOP_N);
  return { top, nonNull };
}

// deno-lint-ignore no-explicit-any
async function buildResponderBreakdowns(
  supabase: any,
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<Breakdown> {
  // 1. Period responders (paginated). A responder = a lead whose reply landed
  //    in the window.
  const rows: {
    intent: string | null;
    job_title: string | null;
    email: string | null;
    linkedin_url: string | null;
  }[] = [];
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();
  for (let page = 0; page < 25; page++) {
    const { data, error } = await supabase
      .from("agent_leads")
      .select("intent, job_title, email, linkedin_url")
      .eq("user_id", userId)
      .gte("last_reply_at", startIso)
      .lte("last_reply_at", endIso)
      .range(page * 1000, page * 1000 + 999);
    if (error) {
      logStep("Responder breakdown fetch failed", { error: error.message });
      break;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const total = rows.length;

  // Intent breakdown.
  const intent: Record<string, number> = {};
  let intentClassified = 0;
  for (const r of rows) {
    const key = (r.intent ?? "unknown") || "unknown";
    intent[key] = (intent[key] ?? 0) + 1;
    if (key !== "unknown") intentClassified++;
  }

  // Titles (on the lead).
  const t = topCounts(rows.map((r) => r.job_title));

  // Enrich responders from synced_contacts (industry, company size, location).
  // Match by email OR linkedin_url — LinkedIn/masked-email responders often
  // have no email match but do carry a linkedin_url, so a single pass fetches
  // all fields and merges per lead (email match preferred, linkedin fallback).
  // CRITICAL: synced_contacts is keyed by team_id and an email/linkedin can
  // exist under multiple clients' teams — scope to THIS client's team(s) or a
  // same-key contact from another client leaks into a client-facing report.
  const { data: memberships } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", userId);
  const teamIds = [...new Set((memberships ?? []).map((m: { team_id: string }) => m.team_id).filter(Boolean))];

  type Contact = { industry: string; company_size: string; location: string };
  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const toLocation = (c: { city?: unknown; state?: unknown; country?: unknown }) => {
    const parts = [clean(c.city), clean(c.state)].filter(Boolean);
    return parts.length ? parts.join(", ") : clean(c.country); // "City, State" else country
  };
  const byEmail = new Map<string, Contact>();
  const byLinkedin = new Map<string, Contact>();
  if (teamIds.length > 0) {
    const emails = [...new Set(rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean))];
    const linkedins = [...new Set(rows.map((r) => r.linkedin_url).filter(Boolean) as string[])];
    const chunk = <T,>(a: T[], n: number) =>
      Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
    const SEL = "email, linkedin_url, industry, company_size, city, state, country";
    const toContact = (c: Record<string, unknown>): Contact => ({
      industry: clean(c.industry),
      company_size: clean(c.company_size),
      location: toLocation(c),
    });
    for (const part of chunk(emails, 200)) {
      if (!part.length) continue;
      const { data } = await supabase.from("synced_contacts").select(SEL).in("team_id", teamIds).in("email", part);
      for (const c of data ?? []) if (c.email) byEmail.set(String(c.email).toLowerCase(), toContact(c));
    }
    for (const part of chunk(linkedins, 200)) {
      if (!part.length) continue;
      const { data } = await supabase.from("synced_contacts").select(SEL).in("team_id", teamIds).in("linkedin_url", part);
      for (const c of data ?? []) if (c.linkedin_url) byLinkedin.set(String(c.linkedin_url), toContact(c));
    }
  }
  // One merged contact per lead (email preferred, linkedin fallback).
  const contacts = rows.map((r) => {
    const e = r.email ? byEmail.get(r.email.toLowerCase()) : undefined;
    return e ?? (r.linkedin_url ? byLinkedin.get(r.linkedin_url) : undefined) ?? null;
  });

  const ind = topCounts(contacts.map((c) => c?.industry));
  const size = topCounts(contacts.map((c) => c?.company_size));
  const loc = topCounts(contacts.map((c) => c?.location));

  return {
    total,
    intent,
    intent_classified: intentClassified,
    titles: t.top,
    title_coverage: total ? t.nonNull / total : 0,
    industries: ind.top,
    industry_coverage: total ? ind.nonNull / total : 0,
    company_sizes: size.top,
    company_size_coverage: total ? size.nonNull / total : 0,
    locations: loc.top,
    location_coverage: total ? loc.nonNull / total : 0,
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
  breakdowns: Breakdown,
): Promise<ClaudeResult> {
  // Build the responder-breakdown block, gating each enriched dimension on
  // coverage so the model never fabricates a pattern from sparse data.
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const gated = (
    label: string,
    items: { name: string; count: number }[],
    coverage: number,
  ) => {
    const ok =
      items.length > 0 &&
      coverage >= COVERAGE_MIN &&
      items.reduce((s, x) => s + x.count, 0) >= COVERAGE_MIN_COUNT;
    return ok
      ? `${JSON.stringify(items)} (coverage ${pct(coverage)})`
      : `unavailable (coverage ${pct(coverage)} — too sparse; DO NOT discuss ${label})`;
  };
  const breakdownBlock = `Responder breakdowns for the period (${breakdowns.total} responders):
- Reply intent (always available): ${JSON.stringify(breakdowns.intent)} — ${breakdowns.intent_classified} classified.
- Top job titles: ${gated("job titles", breakdowns.titles, breakdowns.title_coverage)}
- Top industries: ${gated("industries", breakdowns.industries, breakdowns.industry_coverage)}
- Top company sizes: ${gated("company sizes", breakdowns.company_sizes, breakdowns.company_size_coverage)}
- Top locations: ${gated("locations", breakdowns.locations, breakdowns.location_coverage)}`;

  const systemPrompt = `You are a B2B outbound sales analyst. Write a brief, FACTUAL analysis of who replied this period, grounded strictly in the responder breakdowns below. Do not spin or force positivity — report what the data shows.

Produce two outputs:

1. "analysis": ONE short paragraph (3–5 sentences), plain text (no markdown headers/bullets). Characterize WHO IS BEING REACHED and WHO REPLIED, across up to five dimensions, in this priority order:
   (a) reply-type / intent breakdown — always discuss this; cite real counts (e.g. "of 18 replies, 7 were interested and 4 needs-more-info").
   (b) top job titles of responders — discuss ONLY if provided below (not marked unavailable), citing counts (e.g. "11 of 18 interested replies came from Operations titles").
   (c) top industries of responders — discuss ONLY if provided below.
   (d) top company sizes of responders — discuss ONLY if provided below.
   (e) top locations of responders — discuss ONLY if provided below.
   Rules: Use ONLY the numbers in the breakdowns. NEVER invent titles, industries, company sizes, locations, or counts. If a dimension is marked "unavailable", do not mention it at all. Always lead with the reply-type breakdown; weave in whichever enriched dimensions (title/industry/company size/location) are available. If total responders is very low, say so plainly and keep it to what the intent mix shows.

2. "priorities": an array of AT MOST TWO short imperative-voice to-do strings. Never more than two.
   - Priority 1 is derived from the overall campaign stats.
   - Priority 2 is derived from the responder patterns in the analysis (intent mix, or a title/industry pattern if available).
   Each one concrete, specific sentence tied to a number. If only one meaningful priority exists, return just one. Never more than two.

Client: ${displayName}
Range: ${range} (${toYMD(startDate)} to ${toYMD(endDate)})

${breakdownBlock}

Aggregate stats (for priority 1 context):
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

  // Coerce + trim each priority; drop empties; HARD-CAP at 2 (Feature 3 —
  // priority 1 from stats, priority 2 from the analysis paragraph). Enforced
  // here regardless of what the model returns.
  parsed.priorities = parsed.priorities
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0)
    .slice(0, 2);

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

    // Data-analysis is open to every logged-in user for their OWN clients.
    // We no longer gate on is_platform_admin; instead we authorize per-row
    // below (owner OR platform admin). callerIsAdmin is resolved here but is
    // NON-blocking — it only grants an admin the read-only cross-user path.
    const adminCheck = await userClient
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    const callerIsAdmin = adminCheck.data?.is_platform_admin === true;

    const body = await req.json().catch(() => ({}));
    const clientId = (body as { clientId?: string }).clientId;
    const range = (body as { range?: Range }).range;
    // statsOnly mode (Phase 1+): re-compute and persist stats for the given
    // range WITHOUT calling Claude and WITHOUT touching analysis_text or
    // client_checklist_items. Used by the range tabs and the auto-refresh on
    // detail-view mount so numbers stay current without spending an AI call.
    const statsOnly =
      (body as { statsOnly?: boolean }).statsOnly === true;
    // Opt-in verification aid: when debug=true, success responses include a
    // _debug object showing WHICH user's integration was resolved (always the
    // row owner). The UI never sets this, so it's inert in normal use.
    const debug = (body as { debug?: boolean }).debug === true;
    if (
      !clientId ||
      !range ||
      !["7d", "30d", "mtd", "last_week"].includes(range)
    ) {
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
      .select("id, user_id, display_name, heyreach_account_ids, smartlead_campaign_ids, reply_io_integration_id, excluded_reply_io_campaign_ids")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !clientRow) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Authorize: the row owner always; a platform admin gets read-only
    // cross-user access (the stats still come from the OWNER's own Reply
    // integration below — never the admin's).
    if (clientRow.user_id !== user.id && !callerIsAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { startDate, endDate } = resolveRange(range);
    logStep("Resolved range", { range, start: toYMD(startDate), end: toYMD(endDate) });

    // Resolve integration API keys owned by the ROW OWNER (clientRow.user_id)
    // — NOT the caller. This is the isolation guarantee: a client's stats
    // always come from the client's own Reply/HeyReach/Smartlead integration,
    // even when a platform admin is viewing. An admin therefore never needs
    // to (and never does) integrate a client's key under the admin account.
    // Service-role read, so RLS doesn't block reading the owner's rows.
    // Missing integration = zero stats for that platform (run still completes).
    const { data: integrations } = await supabase
      .from("outbound_integrations")
      .select("id, platform, api_key_encrypted, is_active, created_by")
      .eq("created_by", clientRow.user_id)
      .eq("is_active", true)
      .in("platform", ["heyreach", "smartlead", "reply.io"]);

    const heyreachKey =
      (integrations ?? []).find((r) => r.platform === "heyreach")?.api_key_encrypted ?? null;
    const smartleadKey =
      (integrations ?? []).find((r) => r.platform === "smartlead")?.api_key_encrypted ?? null;
    // Reply.io scope is per-integration (one workspace per row), so we
    // look up the SPECIFIC integration the client picker selected — not
    // "first active reply.io" like HR/SL. If the picker is unset or the
    // referenced integration is no longer active, replyIoKey stays null
    // and the Reply.io branch becomes a no-op.
    const replyIoKey = clientRow.reply_io_integration_id
      ? ((integrations ?? []).find(
          (r) =>
            r.platform === "reply.io" &&
            r.id === clientRow.reply_io_integration_id,
        )?.api_key_encrypted ?? null)
      : null;

    // Verification aid: prove the resolved integrations belong to the ROW
    // OWNER, not the caller. created_by on each matched row must equal
    // clientRow.user_id (that's the .eq filter above). Included in the
    // response only when debug=true.
    const resolutionDebug = {
      caller_user_id: user.id,
      caller_is_admin: callerIsAdmin,
      owner_user_id: clientRow.user_id,
      resolved_from_owner: clientRow.user_id !== user.id
        ? "admin viewing another user's client — key is the OWNER's"
        : "caller is the owner",
      matched_integration_created_by: {
        heyreach: (integrations ?? []).find((r) => r.platform === "heyreach")?.created_by ?? null,
        smartlead: (integrations ?? []).find((r) => r.platform === "smartlead")?.created_by ?? null,
        reply_io: (integrations ?? []).find(
          (r) => r.platform === "reply.io" && r.id === clientRow.reply_io_integration_id,
        )?.created_by ?? null,
      },
      reply_io_key_present: replyIoKey !== null,
    };
    if (debug) logStep("resolution", resolutionDebug);

    // ---- Pre-fetch synced_campaigns (single query, both platforms) ----
    // Used for:
    //   * HR campaign scoping — filter by raw_data.campaignAccountIds
    //     intersection with client.heyreach_account_ids. The picker stores
    //     ACCOUNT ids, not campaign ids, so we derive in-scope campaigns
    //     via the existing linked-account relationship surfaced on every
    //     HR campaign row by sync-heyreach-campaigns.
    //
    //     FIELD-NAME NOTE: HeyReach's /campaign/GetAll response uses
    //     `campaignAccountIds` (verified against prod data — confirmed
    //     present on real rows; the previously-tried `linkedInAccountIds`
    //     and `accountIds` are NOT in the payload, so the original filter
    //     silently returned zero matches and the chart never showed any
    //     LinkedIn campaigns). The fallback chain below tries the correct
    //     name first, then the two legacy guesses, so any historical row
    //     that does happen to carry the old field name still scopes.
    //   * SL display names for per_campaign[] entries — so the chart
    //     x-axis reads "Campaign A" instead of "11234".
    const { data: allSynced } = await supabase
      .from("synced_campaigns")
      .select("source, external_campaign_id, name, raw_data, channel, integration_id")
      .eq("is_linked", true)
      .in("source", ["heyreach", "smartlead", "reply_io"]);

    const syncedRows = (allSynced ?? []) as Array<{
      source: string;
      external_campaign_id: string;
      name: string;
      raw_data: Record<string, unknown> | null;
      channel: string | null;
      integration_id: string | null;
    }>;

    const hrAccountSet = new Set(
      (clientRow.heyreach_account_ids ?? []).map(Number),
    );
    const hrInScope = syncedRows
      .filter((c) => {
        if (c.source !== "heyreach") return false;
        // Fallback chain: campaignAccountIds is the real HeyReach field
        // name; linkedInAccountIds and accountIds are legacy guesses kept
        // as defensive fallbacks for any historical row.
        const linked =
          (c.raw_data?.campaignAccountIds as unknown) ??
          (c.raw_data?.linkedInAccountIds as unknown) ??
          (c.raw_data?.accountIds as unknown) ??
          [];
        if (!Array.isArray(linked)) return false;
        return linked.some((id) => hrAccountSet.has(Number(id)));
      })
      .map((c) => ({
        external_campaign_id: c.external_campaign_id,
        name: c.name,
      }));

    const slNameLookup = new Map<string, string>();
    for (const c of syncedRows) {
      if (c.source === "smartlead") {
        slNameLookup.set(c.external_campaign_id, c.name);
      }
    }

    // Reply.io scope: every reply_io row whose integration_id matches the
    // picker's selection, MINUS any campaign the admin unchecked in the
    // "Edit campaigns" modal (excluded_reply_io_campaign_ids — a per-client
    // EXCLUDE list keyed by external_campaign_id, so campaigns synced later
    // default to shown). Channel passed through so fetchReplyIoStats can
    // route per-row to /reporting/linkedin or /reporting/emails (or both
    // for multichannel). Empty when the picker is unset, the integration
    // was deleted, or none of the workspace's linked sequences are picker-
    // scoped — Reply.io branch then no-ops cleanly.
    const replyIoExcluded = new Set(
      clientRow.excluded_reply_io_campaign_ids ?? [],
    );
    const replyIoInScope = clientRow.reply_io_integration_id
      ? syncedRows
          .filter(
            (c) =>
              c.source === "reply_io" &&
              c.integration_id === clientRow.reply_io_integration_id &&
              !replyIoExcluded.has(c.external_campaign_id),
          )
          .map((c) => ({
            external_campaign_id: c.external_campaign_id,
            name: c.name,
            channel: c.channel,
          }))
      : [];

    // ---- Fetch ----
    // Account-level HR call PRESERVED (belt-and-suspenders). The stat
    // cards read these aggregate numbers; per-campaign failure can't
    // make them lie.
    const heyreachStats = heyreachKey
      ? await fetchHeyReachStats(
          heyreachKey,
          clientRow.heyreach_account_ids ?? [],
          startDate,
          endDate,
        )
      : { sent: 0, replies: 0, connections_sent: 0, connections_accepted: 0 };

    // New: range-scoped HR per-campaign breakdown. Bounded concurrency
    // (batch_size=3, 200ms inter-batch, allSettled, 429 single retry) —
    // see fetchHeyReachPerCampaign for the rationale.
    const heyreachPerCampaign = heyreachKey
      ? await fetchHeyReachPerCampaign(
          heyreachKey,
          hrInScope,
          startDate,
          endDate,
        )
      : { per_campaign: [], partial: false };

    const smartleadStats = smartleadKey
      ? await fetchSmartleadStats(
          smartleadKey,
          clientRow.smartlead_campaign_ids ?? [],
          startDate,
          endDate,
          slNameLookup,
        )
      : { totals: { sent: 0, replies: 0, opens: 0, clicks: 0, bounces: 0 }, per_campaign: [] };

    // Reply.io per-campaign reporting. Routed per-row by channel — see
    // fetchReplyIoStats for the bounded-concurrency + partial-flag details
    // (mirrors fetchHeyReachPerCampaign exactly). When replyIoKey is null
    // OR replyIoInScope is empty, returns the all-zero shape so the totals
    // merge below stays neutral.
    const replyIoStats = replyIoKey
      ? await fetchReplyIoStats(replyIoKey, replyIoInScope, startDate, endDate)
      : {
          linkedin: {
            sent: 0, replies: 0, connections_sent: 0, connections_accepted: 0,
            per_campaign: [], per_campaign_partial: false,
          },
          email: {
            totals: { sent: 0, replies: 0, opens: 0, clicks: 0, bounces: 0 },
            per_campaign: [], per_campaign_partial: false,
          },
        };

    // ---- Merge ----
    // Reply.io contributions fold into the cross-platform totals alongside
    // HR/SL. Linkedin metrics from Reply.io (sent / replies / connections_*)
    // sum with HR's; email metrics (sent / replies / opens / clicks /
    // bounces) sum with SL's. Per-channel breakdowns stay separated in
    // stats_snapshot.{heyreach, smartlead, reply_io}.
    const totalSent =
      heyreachStats.sent +
      smartleadStats.totals.sent +
      replyIoStats.linkedin.sent +
      replyIoStats.email.totals.sent;
    const totalReplies =
      heyreachStats.replies +
      smartleadStats.totals.replies +
      replyIoStats.linkedin.replies +
      replyIoStats.email.totals.replies;
    const totalConnectionsSent =
      heyreachStats.connections_sent + replyIoStats.linkedin.connections_sent;
    const totalConnectionsAccepted =
      heyreachStats.connections_accepted + replyIoStats.linkedin.connections_accepted;
    const totalOpens = smartleadStats.totals.opens + replyIoStats.email.totals.opens;
    const totalClicks = smartleadStats.totals.clicks + replyIoStats.email.totals.clicks;
    const totalBounces = smartleadStats.totals.bounces + replyIoStats.email.totals.bounces;
    // Denominator for email-rate fields: SL.sent + RI.email.sent. Using
    // total email volume keeps the open/click/bounce rates honest — pure
    // email volume, not muddied by LinkedIn outreach.
    const totalEmailSent = smartleadStats.totals.sent + replyIoStats.email.totals.sent;

    const stats = {
      range,
      start_date: toYMD(startDate),
      end_date: toYMD(endDate),
      totals: {
        sent: totalSent,
        replies: totalReplies,
        reply_rate_pct: pct(totalReplies, totalSent),
        connections_sent: totalConnectionsSent,
        connections_accepted: totalConnectionsAccepted,
        connection_accept_rate_pct: pct(totalConnectionsAccepted, totalConnectionsSent),
        // Channel-split totals so the StatsGrid's "LinkedIn Messages Sent"
        // and "Emails Sent" cards stay source-agnostic — mirrors the
        // connections_sent / connections_accepted / opens / bounces
        // pattern (those have summed across HR + RI / SL + RI from the
        // start). Before these existed, the cards read heyreach.sent /
        // smartlead.totals.sent directly, which under-reported every
        // Reply.io-only client (CYPR's "LinkedIn Messages Sent" showed
        // 0 instead of 658).
        linkedin_messages_sent: heyreachStats.sent + replyIoStats.linkedin.sent,
        email_sent: smartleadStats.totals.sent + replyIoStats.email.totals.sent,
        opens: totalOpens,
        open_rate_pct: pct(totalOpens, totalEmailSent),
        clicks: totalClicks,
        click_rate_pct: pct(totalClicks, totalEmailSent),
        bounces: totalBounces,
        bounce_rate_pct: pct(totalBounces, totalEmailSent),
      },
      heyreach: {
        ...heyreachStats,
        per_campaign: heyreachPerCampaign.per_campaign,
        per_campaign_partial: heyreachPerCampaign.partial,
      },
      smartlead: smartleadStats,
      reply_io: replyIoStats,
    };

    // ---- statsOnly short-circuit ----
    // Persist the new numbers + range/timestamp, then return. No Claude call,
    // no checklist mutation. analysis_text is left exactly as it was — the
    // UI's "AI summary" and Priorities sections continue showing the last
    // full-Generate output, which is the explicit decoupling the spec calls
    // out (header label tracks most-recent refresh; AI text tracks
    // most-recent full Generate).
    if (statsOnly) {
      const { error: statsUpdateErr } = await supabase
        .from("client_analysis")
        .update({
          stats_snapshot: stats,
          last_generated_at: new Date().toISOString(),
          last_range: range,
        })
        .eq("id", clientId);
      if (statsUpdateErr) {
        logStep("client_analysis stats-only update failed", {
          error: statsUpdateErr.message,
        });
        throw new Error("Failed to persist stats");
      }
      logStep("statsOnly persisted", { range });
      return new Response(
        JSON.stringify({ stats, statsOnly: true, ...(debug ? { _debug: resolutionDebug } : {}) }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ---- Responder breakdowns (grounds the analysis in real replies) ----
    const breakdowns = await buildResponderBreakdowns(
      supabase,
      clientRow.user_id,
      startDate,
      endDate,
    );
    logStep("Responder breakdowns", {
      total: breakdowns.total,
      intent: breakdowns.intent,
      title_coverage: breakdowns.title_coverage,
      industry_coverage: breakdowns.industry_coverage,
      company_size_coverage: breakdowns.company_size_coverage,
      location_coverage: breakdowns.location_coverage,
      // Populated counts (out of total) so coverage reads as "X of N".
      populated: {
        title: Math.round(breakdowns.title_coverage * breakdowns.total),
        industry: Math.round(breakdowns.industry_coverage * breakdowns.total),
        company_size: Math.round(breakdowns.company_size_coverage * breakdowns.total),
        location: Math.round(breakdowns.location_coverage * breakdowns.total),
      },
    });

    // ---- Claude ----
    const { analysis, priorities } = await callClaude(
      anthropicKey,
      clientRow.display_name,
      range,
      startDate,
      endDate,
      stats,
      breakdowns,
    );

    // ---- Persist snapshot ----
    // Each full Generate INSERTs a new row in client_analysis_snapshots —
    // never overwrites an existing one. The legacy client_analysis row's
    // analysis_text / stats_snapshot / last_generated_at / last_range fields
    // are intentionally NOT updated here (the legacy CHECK on last_range
    // only allows 7d/30d/mtd, and the snapshot table is now the source of
    // truth). client_analysis becomes per-client metadata only.
    const { data: insertedSnap, error: insertSnapErr } = await supabase
      .from("client_analysis_snapshots")
      .insert({
        client_id: clientId,
        // Snapshot belongs to the ROW OWNER, not the caller — so the client
        // sees their own snapshot (owner RLS) and an admin generating on their
        // behalf doesn't silently take ownership of it.
        user_id: clientRow.user_id,
        analysis_text: analysis,
        stats_snapshot: stats,
        range,
        period_start: toYMD(startDate),
        period_end: toYMD(endDate),
      })
      .select("id")
      .single();
    if (insertSnapErr || !insertedSnap) {
      logStep("client_analysis_snapshots insert failed", {
        error: insertSnapErr?.message,
      });
      throw new Error("Failed to persist analysis snapshot");
    }
    const snapshotId = insertedSnap.id as string;

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
        snapshot_id: snapshotId,
        analysis,
        stats,
        checklist: finalChecklist ?? [],
        inserted_priorities: toInsert.length,
        ...(debug ? { _debug: resolutionDebug } : {}),
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
