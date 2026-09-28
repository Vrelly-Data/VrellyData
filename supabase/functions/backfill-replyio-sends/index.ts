// [backfill-replyio-sends v1]
//
// One-shot/resumable backfill of Reply.io OUTBOUND history into
// public.inference_events:
// - Email sends            → event_type='sent',          channel='email'
// - LinkedIn messages      → event_type='sent',          channel='linkedin'
// - LinkedIn connections   → event_type='connection_sent' / 'connection_accepted'
//
// Scope:
// - Team-scoped or integration-scoped:
//   process one Reply.io integration by integrationId OR all active Reply.io
//   integrations for a given teamId.
// - Campaigns: all synced Reply.io sequences for the integration(s).
//   Unlike Smartlead, this intentionally ignores capture_enabled — the goal is
//   "ALL historical Reply.io outbound sends".
//
// Auth:
// - Internal only via x-agent-key (AGENT_API_KEY). No frontend JWT allowed.
//
// Request body:
//   {
//     integrationId?: string,   // backfill one Reply.io integration
//     teamId?: string,          // or all active Reply.io integrations for a team
//     maxLeads?: number,        // per-run cap on scanned items (defensive cap; default 5000)
//     campaignId?: string,      // optional single external Reply.io sequence id (smoke test)
//     cursor?: {
//       integrationId?: string;
//       campaignExternalId?: string;
//       offset?: number;
//       occurred_end_date?: string; // ISO run start to keep paging stable where applicable
//     } | string(json or base64-json),
//     dryRun?: boolean          // when true: write NOTHING; return provider stats per campaign
//   }
//
// Response:
//   {
//     integrations, campaigns, rows_scanned, rows_invalid,
//     sent_written, sent_skipped,
//     by_event_type,              // aggregate counts by event_type and channel (dryRun populates)
//     errors, error_samples,
//     hasMore, nextCursor
//   }
//
// Notes:
// - Stable id: source_row_id must be derived from provider ids. For 'sent' rows
//   prefer provider message id; otherwise use the shared computeSentSourceId()
//   hash over provider+personKey+threadId+fingerprint+occurredAt+tag. For
//   this initial version, the provider does not expose per-message history via
//   existing clients in this repo; the write-path is therefore stubbed pending
//   confirmation of the correct Reply.io v3 endpoints. Dry-run mode is fully
//   implemented and returns per-campaign stats suitable for parity checks.
// - Does NOT touch classify-reply, send-agent-reply, or any live send path.
// - Insert-only into public.people using person_key (email or linkedin_url);
//   ignore duplicates, no null keys.
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-key",
  };
}

const REPLY_API_V3 = "https://api.reply.io/v3";

// Shared helpers (mirror backfill-smartlead-sends)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function redact(s: string): string {
  return String(s ?? "")
    .replace(/api_key=[^&\\s)]+/gi, "api_key=***")
    .replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
}
function parseMaybeJsonOrBase64(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    try {
      const decoded = atob(str);
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}
function parseRetryAfterSeconds(h: string | null): number | null {
  if (!h) return null;
  const n = Number(h);
  if (!Number.isNaN(n) && Number.isFinite(n) && n >= 0) return Math.min(n, 30);
  const when = Date.parse(h);
  if (!Number.isNaN(when)) {
    const diffMs = when - Date.now();
    return diffMs > 0 ? Math.min(30, Math.floor(diffMs / 1000)) : 0;
  }
  return null;
}

// Reply.io v3 POST wrapper with single 429 retry honoring Retry-After
async function replyV3Post(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const doFetch = () =>
    fetch(`${REPLY_API_V3}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
  let res = await doFetch();
  if (res.status === 429) {
    const wait = parseRetryAfterSeconds(res.headers.get("Retry-After")) ?? 2;
    await sleep(wait * 1000);
    res = await doFetch();
  }
  return res;
}

// Normalize Reply.io "channel" values to our canonical set
function normalizeChannel(c: unknown): "email" | "linkedin" | "other" {
  const s = String(c ?? "").toLowerCase();
  if (s === "linkedin" || s === "linkedIn".toLowerCase()) return "linkedin";
  if (s === "email") return "email";
  return "other";
}

type ByEventType = Record<string, { channel: string; count: number }>;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Internal-only gate
    const agentKey = req.headers.get("x-agent-key") || "";
    const expected = Deno.env.get("AGENT_API_KEY") || "";
    if (!agentKey || !expected || agentKey !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const integrationId: string | undefined = body?.integrationId;
    const teamId: string | undefined = body?.teamId;
    const maxLeads: number = Math.max(1, Number(body?.maxLeads ?? 5000));
    const campaignIdFilter: string | undefined = body?.campaignId ? String(body?.campaignId) : undefined;
    const dryRun: boolean = body?.dryRun === true;
    const RUN_START_ISO = new Date().toISOString();
    const TIME_BUDGET_MS = 100_000; // ~100s
    const timeBudgetStart = Date.now();
    const timeBudgetExceeded = () => Date.now() - timeBudgetStart > TIME_BUDGET_MS;

    // Optional resumable cursor
    let cursorIntegrationId: string | null = null;
    let cursorCampaignExternalId: string | null = null;
    let startOffset = 0;
    let occurredEndDate: string | null = null;
    if (body?.cursor) {
      try {
        const curObj: any = typeof body.cursor === "string" ? parseMaybeJsonOrBase64(String(body.cursor)) : body.cursor;
        if (curObj && typeof curObj === "object") {
          cursorIntegrationId = curObj?.integrationId ?? null;
          cursorCampaignExternalId = curObj?.campaignExternalId ?? null;
          startOffset = Number(curObj?.offset ?? 0) || 0;
          occurredEndDate = typeof curObj?.occurred_end_date === "string" ? curObj.occurred_end_date : null;
        }
      } catch {
        // ignore malformed cursor
      }
    }

    if (!integrationId && !teamId) {
      return new Response(JSON.stringify({ error: "Provide integrationId OR teamId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Resolve integrations
    type Integration = {
      id: string;
      team_id: string;
      created_by: string;
      api_key_encrypted: string | null;
    };
    let integrations: Integration[] = [];
    if (integrationId) {
      const { data, error } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, created_by, api_key_encrypted")
        .eq("id", integrationId)
        .eq("platform", "reply.io")
        .eq("is_active", true)
        .order("id", { ascending: true })
        .maybeSingle();
      if (error || !data) throw new Error("Integration not found or inactive");
      integrations = [data as Integration];
    } else if (teamId) {
      const { data, error } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, created_by, api_key_encrypted")
        .eq("team_id", teamId)
        .eq("platform", "reply.io")
        .eq("is_active", true)
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      integrations = (data ?? []) as Integration[];
      if (integrations.length === 0) {
        return new Response(JSON.stringify({ error: "No active Reply.io integrations for team" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let totalCampaigns = 0;
    let rowsScanned = 0;
    let rowsInvalid = 0;
    let sentWritten = 0;
    let sentSkipped = 0;
    let errors = 0;
    const errorSamples: string[] = [];
    let hasMore = false;
    let nextCursor:
      | { integrationId: string; campaignExternalId: string; offset: number; occurred_end_date: string }
      | null = null;

    const byEventType: ByEventType = {}; // aggregates for response (esp. dryRun)

    // Iterate integrations in stable order
    outer: for (const integ of integrations) {
      if (timeBudgetExceeded()) {
        hasMore = true;
        nextCursor = {
          integrationId: integ.id,
          campaignExternalId: null as unknown as any,
          offset: 0,
          occurred_end_date: occurredEndDate || RUN_START_ISO,
        };
        break;
      }
      if (!integ?.api_key_encrypted) continue;
      const apiKey = integ.api_key_encrypted;

      // Sequences (synced campaigns) for this integration — include ALL, regardless of capture_enabled
      let campaignsList: { id: string; team_id: string; external_campaign_id: string; name?: string | null; channel?: string | null }[] = [];
      {
        const { data: list, error: listErr } = await supabase
          .from("synced_campaigns")
          .select("id, team_id, external_campaign_id, name, channel")
          .eq("integration_id", integ.id)
          .eq("source", "reply_io")
          .order("external_campaign_id", { ascending: true });
        if (listErr) throw new Error(listErr.message);
        campaignsList = (list ?? []) as any[];
      }

      if (campaignIdFilter) {
        campaignsList = campaignsList.filter((c) => String(c.external_campaign_id) === String(campaignIdFilter));
      }
      totalCampaigns += campaignsList.length;
      if (campaignIdFilter && campaignsList.length === 0) {
        // Nothing to do on this integration for that specific campaign
        continue;
      }

      // Determine starting campaign index for resume robustness:
      let startIndex = 0;
      if (cursorIntegrationId && integ.id !== cursorIntegrationId) {
        // Not yet at the cursor integration
        continue;
      }
      if (cursorCampaignExternalId) {
        const asNum = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : null);
        const cursorVal = String(cursorCampaignExternalId);
        const cursorNum = asNum(cursorVal);
        const cmp = (a: string, b: string) => {
          const na = asNum(a), nb = asNum(b);
          if (na !== null && nb !== null) return na - nb;
          return a.localeCompare(b);
        };
        startIndex = campaignsList.findIndex((c) => cmp(String(c.external_campaign_id), cursorVal) >= 0);
        if (startIndex < 0) startIndex = campaignsList.length;
      }

      for (let j = startIndex; j < campaignsList.length; j++) {
        const camp = campaignsList[j];
        const externalId = String(camp.external_campaign_id);
        const endDateIso = occurredEndDate || RUN_START_ISO;
        const channels: Array<"email" | "linkedin"> = (() => {
          const ch = normalizeChannel(camp.channel);
          if (ch === "email") return ["email"];
          if (ch === "linkedin") return ["linkedin"];
          // Unknown or multichannel — fetch both for dry-run parity
          return ["linkedin", "email"];
        })();

        // Dry-run: fetch per-campaign stats per channel and accumulate. Non-dry-run:
        // write path requires per-message history, which the current repo does not
        // yet include clients for — stubbed with explicit TODO in PR body.
        for (const ch of channels) {
          if (timeBudgetExceeded()) {
            hasMore = true;
            nextCursor = {
              integrationId: integ.id,
              campaignExternalId: externalId,
              offset: 0,
              occurred_end_date: endDateIso,
            };
            break outer;
          }

          if (dryRun) {
            try {
              const path = ch === "linkedin" ? "/reporting/linkedin/overview" : "/reporting/emails/overview";
              const res = await replyV3Post(path, apiKey!, {
                filters: { dateRangePreset: "allTime", sequenceIds: [Number(externalId)] },
              });
              if (res.status === 429) {
                hasMore = true;
                nextCursor = {
                  integrationId: integ.id,
                  campaignExternalId: externalId,
                  offset: 0,
                  occurred_end_date: endDateIso,
                };
                break outer;
              }
              if (!res.ok) {
                const bodyText = await res.text().catch(() => "");
                throw new Error(`Reply.io reporting ${ch} failed (${res.status}): ${bodyText.substring(0, 300)}`);
              }
              const raw = await res.json().catch(() => ({} as Record<string, unknown>));
              if (ch === "email") {
                const sent = Number((raw as any)?.delivered ?? 0) || 0;
                const key = "sent|email";
                byEventType[key] = { channel: "email", count: ((byEventType[key]?.count ?? 0) + sent) };
                rowsScanned += sent; // approximate
              } else {
                const liSent = Number((raw as any)?.messagesSent ?? 0) || 0;
                const connSent = Number((raw as any)?.connectionsSent ?? 0) || 0;
                const connAcc = Number((raw as any)?.connectionsAccepted ?? 0) || 0;
                const k1 = "sent|linkedin", k2 = "connection_sent|linkedin", k3 = "connection_accepted|linkedin";
                byEventType[k1] = { channel: "linkedin", count: ((byEventType[k1]?.count ?? 0) + liSent) };
                byEventType[k2] = { channel: "linkedin", count: ((byEventType[k2]?.count ?? 0) + connSent) };
                byEventType[k3] = { channel: "linkedin", count: ((byEventType[k3]?.count ?? 0) + connAcc) };
                rowsScanned += liSent + connSent + connAcc; // approximate
              }
            } catch (e) {
              const msg = redact((e as Error)?.message ?? String(e));
              console.warn("[backfill-replyio-sends] reporting fetch failed:", msg);
              errors++;
              if (errorSamples.length < 5) errorSamples.push(msg);
              // Return a cursor to retry this campaign/channel
              hasMore = true;
              nextCursor = {
                integrationId: integ.id,
                campaignExternalId: externalId,
                offset: 0,
                occurred_end_date: endDateIso,
              };
              break outer;
            }
          } else {
            // Non-dry-run path — placeholder. Pending confirmation of the correct
            // v3 endpoints for per-message history (email sends, LinkedIn steps)
            // we do NOT attempt to synthesize events from aggregates. This keeps
            // occurred_at honest (no now() fallback) and preserves insert-only
            // semantics. The PR body flags this explicitly.
            // rowsInvalid stays 0 here — we didn't attempt to map any rows.
          }
        }

        // Reset cursor gates once we pass the first eligible campaign
        cursorIntegrationId = null;
        cursorCampaignExternalId = null;
        startOffset = 0;

        if (rowsScanned >= maxLeads) {
          hasMore = true;
          nextCursor = {
            integrationId: integ.id,
            campaignExternalId: externalId,
            offset: 0,
            occurred_end_date: occurredEndDate || RUN_START_ISO,
          };
          break outer;
        }
      }
    }

    // Ensure non-null cursor when hasMore is true
    if (hasMore && !nextCursor) {
      const integ0 = integrations[0];
      if (integ0) {
        nextCursor = {
          integrationId: integ0.id,
          campaignExternalId: null as unknown as any,
          offset: 0,
          occurred_end_date: occurredEndDate || RUN_START_ISO,
        };
      }
    }

    // Shape response
    // Expand by_event_type into a simpler object: { sent_written, sent_skipped, by_event_type: { [k]: count } }
    const byEventCounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(byEventType)) {
      byEventCounts[k] = v.count;
    }

    return new Response(JSON.stringify({
      success: true,
      integrations: integrations.length,
      campaigns: totalCampaigns,
      rows_scanned: rowsScanned,
      rows_invalid: rowsInvalid,
      sent_written: sentWritten,
      sent_skipped: sentSkipped,
      by_event_type: byEventCounts,
      errors,
      error_samples: errorSamples,
      hasMore,
      nextCursor,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const red = redact(msg);
    console.error("[backfill-replyio-sends] fatal:", red);
    return new Response(JSON.stringify({ error: red }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});

// ---- Inline unit tests for pure helpers -----------------------------------
try {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.test?.("redact api_key & bearer", () => {
    const s = "https://x?k=v&api_key=abcs 123) Authorization: Bearer SECRET.TOKEN";
    const r = redact(s);
    if (!r.includes("api_key=*** 123)") || !r.includes("Bearer ***")) {
      throw new Error(`redact failed: ${r}`);
    }
  });
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.test?.("cursor parse json or base64", () => {
    const obj = { a: 1, b: "x" };
    const raw = JSON.stringify(obj);
    const b64 = btoa(raw);
    const p1 = parseMaybeJsonOrBase64(raw) as any;
    const p2 = parseMaybeJsonOrBase64(b64) as any;
    if (!p1 || p1.a !== 1 || p1.b !== "x") throw new Error("json parse failed");
    if (!p2 || p2.a !== 1 || p2.b !== "x") throw new Error("base64 parse failed");
  });
} catch {
  // ignore when not under test
}

