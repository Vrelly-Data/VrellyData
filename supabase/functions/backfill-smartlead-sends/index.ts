// [backfill-smartlead-sends v3]
//
// One-shot/resumable backfill of Smartlead OUTBOUND "SENT" messages into
// public.inference_events (event_type='sent', channel='email'), plus additive
// insert-only people upserts (email-only) keyed by person_key.
//
// Scope:
// - Team-scoped: choose one Smartlead integration by integrationId OR all active
//   Smartlead integrations for a given teamId.
// - Campaigns: capture_enabled=true only (safety). Can be widened later.
// - Source rows: Smartlead per-email statistics: GET /campaigns/{id}/statistics?limit=1000&offset=N
//   (one row per sequence email send; stable stats_id).
//
// Auth:
// - Internal only via x-agent-key (AGENT_API_KEY). No frontend JWT allowed.
//
// Request body:
//   {
//     integrationId?: string,   // backfill one Smartlead integration
//     teamId?: string,          // or all active Smartlead integrations for a team
//     maxLeads?: number,        // per-run cap (default 5000)
//     campaignId?: string,      // optional single external Smartlead campaign id (smoke test)
//     cursor?: {
//       integrationId?: string;
//       campaignExternalId?: string;
//       offset?: number;
//       sent_time_end_date?: string; // ISO run start to keep offsets stable
//     } | string(json or base64-json)
//   }
//
// Response:
//   {
//     integrations, campaigns, rows_scanned,
//     messages_sent_written, messages_sent_skipped, errors, error_samples,
//     hasMore, nextCursor
//   }
//
// Notes:
// - Stable id: source_row_id = "smartlead:stats:" + stats_id (no now() fallback).
// - Skip rows missing sent_time.
// - Does NOT touch classify-reply or send-agent-reply or any live send path.
// - Insert-only into public.people using person_key/email; ignore duplicates, no null keys.
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

const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";

type SmartleadStatsRow = {
  stats_id?: string | number | null;
  sequence_number?: number | null;
  sent_time?: string | null;
  email_subject?: string | null;
  lead_email?: string | null;
  [k: string]: unknown;
};
type SmartleadStatsEnvelope = {
  data?: SmartleadStatsRow[];
  total?: number;
  [k: string]: unknown;
} | SmartleadStatsRow[] | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const redact = (s: string) => String(s ?? "").replace(/api_key=[^&\s)]+/g, "api_key=***");
function parseMaybeJsonOrBase64(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    try {
      // Deno has atob; Buffer is not available
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
  if (!Number.isNaN(n) && Number.isFinite(n) && n >= 0) return n;
  // HTTP-date
  const when = Date.parse(h);
  if (!Number.isNaN(when)) {
    const diffMs = when - Date.now();
    return diffMs > 0 ? diffMs / 1000 : 0;
  }
  return null;
}

// Safe GET wrapper that appends api_key via URLSearchParams and never logs the full URL.
async function smartleadGet(
  pathWithLeadingSlash: string,
  apiKey: string,
  opts?: { backoffOn429?: boolean; deadlineMs?: number },
): Promise<Response> {
  const url = new URL(`${SMARTLEAD_API_BASE}${pathWithLeadingSlash}`);
  url.searchParams.set("api_key", apiKey);
  const doFetch = () =>
    fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  if (!opts?.backoffOn429) return doFetch();
  let attempt = 0;
  while (attempt < 3) {
    const resp = await doFetch();
    if (resp.status !== 429) return resp;
    // Parse Retry-After seconds or date; cap each wait at 20s and don't exceed time budget.
    const parsed = parseRetryAfterSeconds(resp.headers.get("retry-after"));
    const exp = Math.pow(2, attempt + 1); // 2,4,8
    let waitSecs = Math.max(parsed ?? 0, exp);
    waitSecs = Math.min(waitSecs, 20);
    if (opts?.deadlineMs) {
      const remain = Math.max(0, Math.floor((opts.deadlineMs - Date.now()) / 1000));
      if (remain <= 0) return resp;
      waitSecs = Math.min(waitSecs, remain);
    }
    if (waitSecs <= 0) return resp;
    await sleep(waitSecs * 1000);
    attempt++;
  }
  // Signal rate limit to caller
  const last = await doFetch();
  if (last.status === 429) {
    const ra = parseRetryAfterSeconds(last.headers.get("retry-after")) ?? 0;
    const err: any = new Error(`Smartlead 429 after retries`);
    err.rateLimited = true;
    err.retryAfterSeconds = ra;
    err.status = 429;
    return last;
  }
  return last;
}

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
    const RUN_START_ISO = new Date().toISOString();
    const TIME_BUDGET_MS = 100_000; // ~100s
    const timeBudgetStart = Date.now();
    const timeBudgetExceeded = () => Date.now() - timeBudgetStart > TIME_BUDGET_MS;
    const deadlineMs = timeBudgetStart + TIME_BUDGET_MS;

    // Optional resumable cursor
    let cursorIntegrationId: string | null = null;
    let cursorCampaignExternalId: string | null = null;
    let startOffset = 0;
    let sentTimeEndDate: string | null = null;
    if (body?.cursor) {
      try {
        const curObj: any = typeof body.cursor === "string" ? parseMaybeJsonOrBase64(String(body.cursor)) : body.cursor;
        if (curObj && typeof curObj === "object") {
          cursorIntegrationId = curObj?.integrationId ?? null;
          cursorCampaignExternalId = curObj?.campaignExternalId ?? null;
          startOffset = Number(curObj?.offset ?? 0) || 0;
          sentTimeEndDate = typeof curObj?.sent_time_end_date === "string" ? curObj.sent_time_end_date : null;
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
    type Integration = { id: string; team_id: string; created_by: string; api_key_encrypted: string | null };
    let integrations: Integration[] = [];
    if (integrationId) {
      const { data, error } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, created_by, api_key_encrypted")
        .eq("id", integrationId)
        .eq("platform", "smartlead")
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
        .eq("platform", "smartlead")
        .eq("is_active", true)
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      integrations = (data ?? []) as Integration[];
      if (integrations.length === 0) {
        return new Response(JSON.stringify({ error: "No active Smartlead integrations for team" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let totalCampaigns = 0;
    let rowsScanned = 0;
    let messagesSentWritten = 0;
    let messagesSentSkipped = 0;
    let errors = 0;
    let rowsInvalid = 0;
    const errorSamples: string[] = [];
    let hasMore = false;
    let nextCursor:
      | { integrationId: string; campaignExternalId: string; offset: number; sent_time_end_date: string }
      | null = null;

    // Track people inserts once per email for the whole run
    const peopleSeen = new Set<string>();
    let campaignFilterFound = !campaignIdFilter; // if filter absent, treat as found

    outer: for (const integ of integrations) {
      if (timeBudgetExceeded()) {
        hasMore = true;
        // Park on this integration start
        nextCursor = {
          integrationId: integ.id,
          campaignExternalId: null as unknown as any, // keep shape stable; consumer tolerates null
          offset: 0,
          sent_time_end_date: sentTimeEndDate || RUN_START_ISO,
        };
        break;
      }
      if (!integ?.api_key_encrypted) continue;
      const apiKey = integ.api_key_encrypted;

      // Campaigns for this integration (safety: capture_enabled only)
      // List and order stably by external id
      let campaignsList: { id: string; team_id: string; external_campaign_id: string; name?: string | null }[] = [];
      {
        const { data: list, error: listErr } = await supabase
          .from("synced_campaigns")
          .select("id, team_id, external_campaign_id, name")
          .eq("integration_id", integ.id)
          .eq("capture_enabled", true)
          .eq("source", "smartlead")
          .order("external_campaign_id", { ascending: true });
        if (listErr) throw new Error(listErr.message);
        campaignsList = (list ?? []) as any[];
      }
      if (campaignIdFilter) {
        campaignsList = campaignsList.filter((c) => String(c.external_campaign_id) === String(campaignIdFilter));
      }
      totalCampaigns += campaignsList.length;
      // If campaignIdFilter provided, ensure it belongs to this integration/team
      if (campaignIdFilter && campaignsList.length === 0) {
        // Nothing to do on this integration for that specific campaign
        continue;
      }
      if (campaignIdFilter && campaignsList.length > 0) {
        campaignFilterFound = true;
      }

      // Determine starting campaign index for resume robustness:
      let startIndex = 0;
      if (cursorIntegrationId && integ.id !== cursorIntegrationId) {
        // Not yet at the cursor integration
        continue;
      }
      if (cursorCampaignExternalId) {
        // Find first campaign with external_campaign_id >= cursorCampaignExternalId
        const asNum = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : null);
        const cursorVal = String(cursorCampaignExternalId);
        const cursorNum = asNum(cursorVal);
        const cmp = (a: string, b: string) => {
          const na = asNum(a), nb = asNum(b);
          if (na !== null && nb !== null) return na - nb;
          return a.localeCompare(b);
        };
        startIndex = campaignsList.findIndex((c) => cmp(String(c.external_campaign_id), cursorVal) >= 0);
        if (startIndex < 0) startIndex = campaignsList.length; // nothing >= cursor; will skip loop
      }

      for (let j = startIndex; j < campaignsList.length; j++) {
        const camp = campaignsList[j];
        // Page provider statistics for this campaign
        const sameCampaignAsCursor = !!cursorCampaignExternalId && String(camp.external_campaign_id) === String(cursorCampaignExternalId);
        let offset = sameCampaignAsCursor ? startOffset : 0;
        const PAGE = 1000; // Smartlead stats page size
        const endDateIso = sentTimeEndDate || RUN_START_ISO;
        while (true) {
          if (timeBudgetExceeded()) {
            hasMore = true;
            nextCursor = {
              integrationId: integ.id,
              campaignExternalId: String(camp.external_campaign_id),
              offset,
              sent_time_end_date: endDateIso,
            };
            break outer;
          }
          // Fetch one page of campaign stats from Smartlead with 429 backoff
          let page: SmartleadStatsEnvelope | null = null;
          try {
            const res = await smartleadGet(
              `/campaigns/${encodeURIComponent(camp.external_campaign_id)}/statistics?limit=${PAGE}&offset=${offset}&sent_time_end_date=${encodeURIComponent(endDateIso)}`,
              apiKey!,
              { backoffOn429: true, deadlineMs },
            );
            if (res.status === 429) {
              hasMore = true;
              nextCursor = {
                integrationId: integ.id,
                campaignExternalId: String(camp.external_campaign_id),
                offset,
                sent_time_end_date: endDateIso,
              };
              break outer;
            }
            if (!res.ok) {
              const bodyText = await res.text().catch(() => "");
              throw new Error(
                `Smartlead /campaigns/${camp.external_campaign_id}/statistics failed (${res.status}): ${bodyText.substring(0, 300)}`,
              );
            }
            page = await res.json().catch(() => ({} as SmartleadStatsEnvelope));
          } catch (e) {
            const msg = redact((e as Error)?.message ?? String(e));
            console.warn("[backfill-smartlead-sends] statistics page fetch failed:", msg);
            errors++;
            // Do not skip to next campaign on transient page failure; return cursor to retry this page
            hasMore = true;
            nextCursor = {
              integrationId: integ.id,
              campaignExternalId: String(camp.external_campaign_id),
              offset,
              sent_time_end_date: endDateIso,
            };
            break outer;
          }
          const rows: SmartleadStatsRow[] = Array.isArray(page)
            ? ((page ?? []) as SmartleadStatsRow[])
            : Array.isArray((page as any)?.data)
            ? (((page as any).data ?? []) as SmartleadStatsRow[])
            : [];
          if (rows.length === 0) break;

          // Build batched writes for this page
          const evRows: any[] = [];
          const pagePeopleEmails: string[] = [];
          let processedThisPage = 0;
          let pageAbortedForBudget = false;
          for (const r of rows) {
            if (timeBudgetExceeded()) {
              // Do not advance offset; retry this entire page next run
              pageAbortedForBudget = true;
              break;
            }
            rowsScanned++;
            const sentTime = typeof r?.sent_time === "string" && r.sent_time ? r.sent_time : null;
            const email = (r?.lead_email ?? "").toString().trim().toLowerCase();
            const statsId = r?.stats_id !== undefined && r?.stats_id !== null ? String(r.stats_id) : null;
            if (!sentTime || !email || !statsId) {
              rowsInvalid++;
              processedThisPage++;
              continue;
            }
            // Ignore rows later than endDateIso to keep offsets stable; provider query also fixed by end date
            if (new Date(sentTime).getTime() > new Date(endDateIso).getTime()) {
              processedThisPage++;
              continue;
            }
            const sourceRowId = `smartlead:stats:${statsId}`;
            evRows.push({
              team_id: (camp as any).team_id,
              person_key: email,
              email,
              channel: "email",
              campaign_external_id: String((camp as any).external_campaign_id ?? ""),
              campaign_name: (camp as any)?.name ?? null,
              sequence_step_type: "email",
              copy_fingerprint: null,
              subject: (typeof r?.email_subject === "string" && r.email_subject.trim()) ? r.email_subject.trim() : null,
              event_type: "sent",
              intent: null,
              is_objection: null,
              pipeline_stage: "sent",
              disposition_tag: null,
              occurred_at: sentTime,
              source: "smartlead_stats",
              source_row_id: sourceRowId,
              metadata: {
                provider: "smartlead",
                sequence_number: r?.sequence_number ?? null,
              } as Record<string, unknown>,
            });
            if (!peopleSeen.has(email)) {
              peopleSeen.add(email);
              pagePeopleEmails.push(email);
            }
            processedThisPage++;
            if (rowsScanned >= maxLeads) break;
          }

          if (pageAbortedForBudget || timeBudgetExceeded()) {
            hasMore = true;
            // Keep offset at start of page to ensure no dropped rows
            nextCursor = {
              integrationId: integ.id,
              campaignExternalId: String(camp.external_campaign_id),
              offset,
              sent_time_end_date: endDateIso,
            };
            break outer;
          }

          // Batched upsert for inference_events (chunks of ~500)
          const CHUNK = 500;
          let eventsWriteFailed = false;
          for (let k = 0; k < evRows.length; k += CHUNK) {
            const chunk = evRows.slice(k, k + CHUNK);
            if (chunk.length === 0) continue;
            const { data: ins, error: insErr } = await supabase
              .from("inference_events")
              // @ts-ignore onConflict supports column-list
              .upsert(chunk, { onConflict: "source,source_row_id,event_type", ignoreDuplicates: true })
              .select("id");
            if (insErr) {
              errors++;
              const em = redact(insErr.message ?? String(insErr));
              if (errorSamples.length < 5) errorSamples.push(em);
              eventsWriteFailed = true;
              break;
            } else {
              const written = Array.isArray(ins) ? ins.length : 0;
              messagesSentWritten += written;
              messagesSentSkipped += Math.max(0, chunk.length - written);
            }
          }

          if (eventsWriteFailed) {
            hasMore = true;
            // Keep offset at start of page to retry failed writes
            nextCursor = {
              integrationId: integ.id,
              campaignExternalId: String(camp.external_campaign_id),
              offset,
              sent_time_end_date: endDateIso,
            };
            break outer;
          }

          // Batched insert-only upsert for people (distinct new emails this page)
          if (pagePeopleEmails.length > 0) {
            const peopleRows = pagePeopleEmails.map((email) => {
              const fullName =
                typeof (rows.find((r2) => (r2?.lead_email ?? "").toString().trim().toLowerCase() === email) as any)?.lead_name ===
                  "string"
                  ? String((rows.find((r2) => (r2?.lead_email ?? "").toString().trim().toLowerCase() === email) as any)?.lead_name)
                      .trim() || null
                  : null;
              return {
                team_id: (camp as any).team_id,
                person_key: email,
                email,
                full_name: fullName,
              } as Record<string, unknown>;
            });
            const { error: pplErr } = await supabase
              .from("people")
              // @ts-ignore onConflict supports column-list
              .upsert(peopleRows, { onConflict: "team_id,person_key", ignoreDuplicates: true })
              .select("id");
            if (pplErr) {
              errors++;
              const em = redact(pplErr.message ?? String(pplErr));
              if (errorSamples.length < 5) errorSamples.push(em);
              hasMore = true;
              // Retry page to ensure people rows eventually land; keep offset at start
              nextCursor = {
                integrationId: integ.id,
                campaignExternalId: String(camp.external_campaign_id),
                offset,
                sent_time_end_date: endDateIso,
              };
              break outer;
            }
          }

          offset += processedThisPage;
          if (processedThisPage < rows.length || rows.length < PAGE || rowsScanned >= maxLeads) break;
        }
        // Reset cursor gates once we pass the first eligible campaign
        cursorIntegrationId = null;
        cursorCampaignExternalId = null;
        startOffset = 0;
        if (rowsScanned >= maxLeads) {
          hasMore = true;
          nextCursor = {
            integrationId: integ.id,
            campaignExternalId: String(camp.external_campaign_id),
            offset,
            sent_time_end_date: sentTimeEndDate || RUN_START_ISO,
          };
          break outer;
        }
      }
      if (rowsScanned >= maxLeads) break;
    }

    if (campaignIdFilter && !campaignFilterFound) {
      return new Response(JSON.stringify({ error: "campaignId not found or not capture_enabled for the scope" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure non-null cursor when hasMore is true
    if (hasMore && !nextCursor) {
      const integ0 = integrations[0];
      if (integ0) {
        nextCursor = {
          integrationId: integ0.id,
          campaignExternalId: null as unknown as any,
          offset: 0,
          sent_time_end_date: sentTimeEndDate || RUN_START_ISO,
        };
      }
    }

    return new Response(JSON.stringify({
      success: true,
      integrations: integrations.length,
      campaigns: totalCampaigns,
      rows_scanned: rowsScanned,
      messages_sent_written: messagesSentWritten,
      messages_sent_skipped: messagesSentSkipped,
      errors,
      error_samples: errorSamples,
      rows_invalid: rowsInvalid,
      hasMore,
      nextCursor,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const red = redact(msg);
    console.error("[backfill-smartlead-sends] fatal:", red);
    return new Response(JSON.stringify({ error: red }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Tiny unit test for redact
try {
  // Deno.test is available in test runner; ignored in serve
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.test?.("redact api_key", () => {
    const s = "https://x?k=v&api_key=abcs 123)";
    const r = redact(s);
    if (!r.includes("api_key=*** 123)")) {
      throw new Error(`redact failed: ${r}`);
    }
  });
} catch {
  // ignore when not under test
}

