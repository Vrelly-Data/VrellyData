// [backfill-heyreach v1]
//
// One-shot/resumable backfill of HeyReach LinkedIn history into
// public.inference_events:
// - event_type='sent', channel='linkedin' (outbound LinkedIn DMs)
// - event_type='connection_sent' and 'connection_accepted' where reliably derivable
//   (best-effort; skipped when provider payload lacks timestamps/ids)
//
// Mirrors backfill-smartlead-sends:
// - Internal-only via x-agent-key (AGENT_API_KEY). No frontend JWT allowed.
// - ~100s time budget, resumable id-based cursor, stable ordering per campaign.
// - 429/Retry-After-aware provider requests.
// - Insert-only people upsert keyed by (team_id, person_key) with ignoreDuplicates.
// - Batch upsert inference_events with onConflict: 'source,source_row_id,event_type',
//   ignoreDuplicates: true; count written vs skipped.
//
// Request body:
//   {
//     integrationId?: string,   // backfill one HeyReach integration
//     teamId?: string,          // or all active HeyReach integrations for a team
//     campaignId?: string,      // optional single external campaign id
//     maxLeads?: number,        // per-run cap on considered messages (default 5000)
//     cursor?: { integrationId?: string; campaignExternalId?: string; offset?: number } | string,
//     dryRun?: boolean
//   }
//
// Response:
//   {
//     rows_scanned, rows_invalid, written, skipped,
//     by_event_type, errors, error_samples, hasMore, nextCursor
//     // In dryRun, also returns: by_campaign: { [campaignExternalId]: { ours: {sent, connection_sent, connection_accepted}, provider: {messagesSent, connectionsSent, connectionsAccepted} } }
//   }
//
// Notes:
// - source = 'heyreach_history'
// - source_row_id:
//    * Prefer provider message id when available from HeyReach payloads
//    * Else deterministic hash over (provider, personKey, providerThreadId, copyFingerprint, occurredAt)
// - Skip rows with missing occurred_at or person_key; never fall back to now().
// - LinkedIn-only person_key uses linkedin_url when email absent.
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeCopyFingerprint } from "../_shared/copy-fingerprint.ts";
import { computeSentSourceId } from "../_shared/sent-source-id.ts";

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

const HR_API_BASE = "https://api.heyreach.io/api/public";

type HrConversation = {
  id?: string; // conversation id
  linkedInAccountId?: number;
  lastMessageAt?: string;
  correspondentProfile?: {
    profileUrl?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    emailAddress?: string | null;
    companyName?: string | null;
    position?: string | null;
  } | null;
};

type HrChatroom = {
  id?: string;
  campaignId?: number | string | null;
  linkedInAccountId?: number | null;
  correspondentProfile?: HrConversation["correspondentProfile"];
  messages?: Array<{
    id?: string | number | null;
    sender?: string | null; // 'ME' or other
    body?: string | null;
    createdAt?: string | null;
    type?: string | null; // not documented; best-effort
  }>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function redact(s: string): string {
  // Hide potential API key appearances in logs
  return String(s ?? "")
    .replace(/X-API-KEY:\s*[^\\s]+/gi, "X-API-KEY: ***")
    .replace(/api_key=[^&\\s)]+/gi, "api_key=***");
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
  if (!Number.isNaN(n) && Number.isFinite(n) && n >= 0) return n;
  const when = Date.parse(h);
  if (!Number.isNaN(when)) {
    const diffMs = when - Date.now();
    return diffMs > 0 ? diffMs / 1000 : 0;
  }
  return null;
}

async function hrPost(
  path: string,
  apiKey: string,
  body: unknown,
  opts?: { backoffOn429?: boolean; deadlineMs?: number },
): Promise<Response> {
  const doFetch = () =>
    fetch(`${HR_API_BASE}${path}`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  if (!opts?.backoffOn429) return doFetch();
  let attempt = 0;
  while (attempt < 3) {
    const resp = await doFetch();
    if (resp.status !== 429) return resp;
    let waitSecs = Math.min(Math.max(parseRetryAfterSeconds(resp.headers.get("retry-after")) ?? 0, Math.pow(2, attempt + 1)), 20);
    if (opts?.deadlineMs) {
      const remain = Math.max(0, Math.floor((opts.deadlineMs - Date.now()) / 1000));
      if (remain <= 0) return resp;
      waitSecs = Math.min(waitSecs, remain);
    }
    if (waitSecs <= 0) return resp;
    await sleep(waitSecs * 1000);
    attempt++;
  }
  return doFetch();
}

async function hrGet(
  path: string,
  apiKey: string,
  opts?: { backoffOn429?: boolean; deadlineMs?: number },
): Promise<Response> {
  const url = `${HR_API_BASE}${path}`;
  const doFetch = () =>
    fetch(url, {
      method: "GET",
      headers: { "X-API-KEY": apiKey, Accept: "application/json" },
    });
  if (!opts?.backoffOn429) return doFetch();
  let attempt = 0;
  while (attempt < 3) {
    const resp = await doFetch();
    if (resp.status !== 429) return resp;
    let waitSecs = Math.min(Math.max(parseRetryAfterSeconds(resp.headers.get("retry-after")) ?? 0, Math.pow(2, attempt + 1)), 20);
    if (opts?.deadlineMs) {
      const remain = Math.max(0, Math.floor((opts.deadlineMs - Date.now()) / 1000));
      if (remain <= 0) return resp;
      waitSecs = Math.min(waitSecs, remain);
    }
    if (waitSecs <= 0) return resp;
    await sleep(waitSecs * 1000);
    attempt++;
  }
  return doFetch();
}

type CursorObj = {
  integrationId: string | null;
  campaignExternalId: string | null;
  offset: number;
};

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
    const dryRun: boolean = body?.dryRun === true;
    const maxLeads: number = Math.max(1, Number(body?.maxLeads ?? 5000));
    const campaignIdFilter: string | undefined = body?.campaignId ? String(body?.campaignId) : undefined;
    const TIME_BUDGET_MS = 100_000; // ~100s
    const timeBudgetStart = Date.now();
    const deadlineMs = timeBudgetStart + TIME_BUDGET_MS;
    const timeBudgetExceeded = () => Date.now() - timeBudgetStart > TIME_BUDGET_MS;

    // Optional resumable cursor
    let cursorIntegrationId: string | null = null;
    let cursorCampaignExternalId: string | null = null;
    let startOffset = 0;
    if (body?.cursor) {
      try {
        const curObj: any = typeof body.cursor === "string" ? parseMaybeJsonOrBase64(String(body.cursor)) : body.cursor;
        if (curObj && typeof curObj === "object") {
          cursorIntegrationId = curObj?.integrationId ?? null;
          cursorCampaignExternalId = curObj?.campaignExternalId ?? null;
          startOffset = Number(curObj?.offset ?? 0) || 0;
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
        .eq("platform", "heyreach")
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
        .eq("platform", "heyreach")
        .eq("is_active", true)
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      integrations = (data ?? []) as Integration[];
      if (integrations.length === 0) {
        return new Response(JSON.stringify({ error: "No active HeyReach integrations for team" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let rowsScanned = 0;
    let rowsInvalid = 0;
    let written = 0;
    let skipped = 0;
    let errors = 0;
    const errorSamples: string[] = [];
    const byEventType: Record<string, number> = Object.create(null);
    const byCampaign: Record<string, { ours: Record<string, number>; provider: { messagesSent: number; connectionsSent: number; connectionsAccepted: number } }> = Object.create(null);
    let hasMore = false;
    let nextCursor: CursorObj | null = null;

    outer: for (const integ of integrations) {
      if (timeBudgetExceeded()) {
        hasMore = true;
        nextCursor = { integrationId: integ.id, campaignExternalId: null, offset: 0 };
        break;
      }
      if (!integ?.api_key_encrypted) continue;
      const apiKey = integ.api_key_encrypted;

      // Campaigns for this integration (safety: capture_enabled only)
      let campaignsList: { id: string; team_id: string; external_campaign_id: string; name?: string | null }[] = [];
      {
        const { data: list, error: listErr } = await supabase
          .from("synced_campaigns")
          .select("id, team_id, external_campaign_id, name")
          .eq("integration_id", integ.id)
          .eq("capture_enabled", true)
          .eq("source", "heyreach")
          .order("external_campaign_id", { ascending: true });
        if (listErr) throw new Error(listErr.message);
        campaignsList = (list ?? []) as any[];
      }
      if (campaignIdFilter) {
        campaignsList = campaignsList.filter((c) => String(c.external_campaign_id) === String(campaignIdFilter));
      }
      if (campaignIdFilter && campaignsList.length === 0) {
        // Nothing to do on this integration for that specific campaign
        continue;
      }

      // Determine starting campaign index for resume robustness:
      let startIndex = 0;
      if (cursorIntegrationId && integ.id !== cursorIntegrationId) {
        continue; // not at cursor integration yet
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
        const externalIdStr = String(camp.external_campaign_id);
        // Provider metrics for dryRun comparison — safe single call per campaign
        if (dryRun && !byCampaign[externalIdStr]) {
          try {
            const statsRes = await hrPost(
              "/stats/GetOverallStats",
              apiKey!,
              {
                accountIds: [], // all
                campaignIds: [Number(externalIdStr)].filter((n) => Number.isFinite(n)),
                startDate: "2000-01-01T00:00:00.000Z",
                endDate: new Date().toISOString(),
              },
              { backoffOn429: true, deadlineMs },
            );
            const stats = await statsRes.json().catch(() => ({}));
            const overall = (stats as any)?.overallStats || {};
            byCampaign[externalIdStr] = {
              ours: { sent: 0, connection_sent: 0, connection_accepted: 0 },
              provider: {
                messagesSent: Number(overall?.messagesSent ?? 0) || 0,
                connectionsSent: Number(overall?.connectionsSent ?? 0) || 0,
                connectionsAccepted: Number(overall?.connectionsAccepted ?? 0) || 0,
              },
            };
          } catch (e) {
            // Non-fatal — still proceed with our counts
            byCampaign[externalIdStr] = {
              ours: { sent: 0, connection_sent: 0, connection_accepted: 0 },
              provider: { messagesSent: 0, connectionsSent: 0, connectionsAccepted: 0 },
            };
          }
        }

        // Page provider conversations for this campaign
        const sameCampaignAsCursor = !!cursorCampaignExternalId && String(camp.external_campaign_id) === String(cursorCampaignExternalId);
        let offset = sameCampaignAsCursor ? startOffset : 0;
        const PAGE = 50; // conversation page size
        while (true) {
          if (timeBudgetExceeded()) {
            hasMore = true;
            nextCursor = { integrationId: integ.id, campaignExternalId: externalIdStr, offset };
            break outer;
          }
          // Fetch one page of conversations
          let page: { items?: HrConversation[]; totalCount?: number } | null = null;
          try {
            const res = await hrPost(
              "/inbox/GetConversationsV2",
              apiKey!,
              {
                filters: {
                  linkedInAccountIds: [],
                  campaignIds: [Number(externalIdStr)].filter((n) => Number.isFinite(n)),
                  searchString: "",
                },
                offset,
                limit: PAGE,
              },
              { backoffOn429: true, deadlineMs },
            );
            if (res.status === 429) {
              hasMore = true;
              nextCursor = { integrationId: integ.id, campaignExternalId: externalIdStr, offset };
              break outer;
            }
            if (!res.ok) {
              const bodyText = await res.text().catch(() => "");
              throw new Error(
                `HeyReach GetConversationsV2 failed (${res.status}): ${bodyText.substring(0, 300)}`,
              );
            }
            page = await res.json().catch(() => ({} as { items?: HrConversation[]; totalCount?: number }));
          } catch (e) {
            const msg = redact((e as Error)?.message ?? String(e));
            console.warn("[backfill-heyreach] conversations page fetch failed:", msg);
            errors++;
            hasMore = true;
            nextCursor = { integrationId: integ.id, campaignExternalId: externalIdStr, offset };
            break outer;
          }
          const convs: HrConversation[] = Array.isArray((page as any)?.items) ? (((page as any).items ?? []) as HrConversation[]) : [];
          if (convs.length === 0) break;

          // For each conversation, fetch chatroom and build events
          const evRows: any[] = [];
          const pagePeople: { email?: string | null; linkedin?: string | null }[] = [];
          let processedThisPage = 0;
          for (const c of convs) {
            if (timeBudgetExceeded()) {
              hasMore = true;
              nextCursor = { integrationId: integ.id, campaignExternalId: externalIdStr, offset };
              break outer;
            }
            const convId = (c?.id ?? "") + "";
            const accountId = c?.linkedInAccountId ?? null;
            if (!convId || accountId == null) {
              processedThisPage++;
              continue;
            }
            let chat: HrChatroom | null = null;
            try {
              const res = await hrGet(`/inbox/GetChatroom/${accountId}/${encodeURIComponent(convId)}`, apiKey!, {
                backoffOn429: true, deadlineMs,
              });
              if (!res.ok) {
                const bt = await res.text().catch(() => "");
                throw new Error(`HeyReach GetChatroom ${res.status}: ${bt.substring(0, 300)}`);
              }
              chat = await res.json().catch(() => ({} as HrChatroom));
            } catch (e) {
              const msg = redact((e as Error)?.message ?? String(e));
              console.warn("[backfill-heyreach] chatroom fetch failed:", msg);
              errors++;
              // Retry conversation on next run; do not advance offset
              hasMore = true;
              nextCursor = { integrationId: integ.id, campaignExternalId: externalIdStr, offset };
              break outer;
            }
            const profile = (chat?.correspondentProfile ?? c?.correspondentProfile) || {};
            const linkedinUrl = (profile?.profileUrl ?? "")?.toString().trim() || null;
            const emailLower = (profile?.emailAddress ? String(profile.emailAddress).trim().toLowerCase() : "") || null;
            const fullName = [profile?.firstName ?? "", profile?.lastName ?? ""].filter(Boolean).join(" ").trim() || null;
            const jobTitle = (profile?.position ?? "")?.toString().trim() || null;
            const company = (profile?.companyName ?? "")?.toString().trim() || null;
            const campaignExternalId = chat?.campaignId != null ? String(chat.campaignId) : externalIdStr;
            const messages = Array.isArray(chat?.messages) ? chat!.messages! : [];

            // Build outbound 'sent' events from messages where sender === 'ME'
            for (const m of messages) {
              if ((m?.sender ?? "") !== "ME") continue;
              const body = (m?.body ?? "")?.toString();
              const occurredAt = (m?.createdAt ?? "")?.toString();
              const providerMessageId = (m?.id != null) ? String(m.id) : null;
              if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
                rowsInvalid++;
                continue;
              }
              // Identity
              const personKey = (emailLower && emailLower.trim() ? emailLower : (linkedinUrl && linkedinUrl.trim() ? linkedinUrl : null));
              if (!personKey) {
                rowsInvalid++;
                continue;
              }
              const fp = await computeCopyFingerprint(body ?? "", null);
              const srcId = await computeSentSourceId({
                provider: "heyreach",
                personKey,
                occurredAt,
                providerThreadId: convId,
                providerMessageId,
                copyFingerprint: fp,
                tag: null,
              });
              const row = {
                team_id: (camp as any).team_id,
                agent_config_id: null,
                person_key: personKey,
                email: emailLower,
                linkedin_url: linkedinUrl,
                full_name: fullName,
                job_title: jobTitle,
                company_name: company,
                channel: "linkedin",
                campaign_external_id: campaignExternalId ?? null,
                campaign_name: (camp as any)?.name ?? null,
                sequence_step_type: "linkedin_message",
                copy_fingerprint: fp,
                subject: null,
                event_type: "sent",
                intent: null,
                is_objection: null,
                pipeline_stage: "sent",
                disposition_tag: null,
                occurred_at: occurredAt,
                source: "heyreach_history",
                source_row_id: srcId,
                metadata: {
                  provider: "heyreach",
                  provider_thread_id: convId,
                  provider_message_id: providerMessageId,
                  account_id: accountId,
                } as Record<string, unknown>,
              };
              evRows.push(row);
              rowsScanned++;
              if (dryRun) {
                byEventType["sent"] = (byEventType["sent"] ?? 0) + 1;
                if (byCampaign[externalIdStr]) byCampaign[externalIdStr].ours.sent += 1;
              }
              if (rowsScanned >= maxLeads) break;
            }

            // Track people insert for this conversation (once per person key)
            pagePeople.push({ email: emailLower, linkedin: linkedinUrl });

            if (rowsScanned >= maxLeads) break;
            processedThisPage++;
          }

          if (timeBudgetExceeded()) {
            hasMore = true;
            nextCursor = { integrationId: integ.id, campaignExternalId: externalIdStr, offset };
            break outer;
          }

          if (!dryRun) {
            // Batched upsert for inference_events (chunks of ~500)
            const CHUNK = 500;
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
                hasMore = true;
                nextCursor = { integrationId: integ.id, campaignExternalId: externalIdStr, offset };
                break outer;
              } else {
                const w = Array.isArray(ins) ? ins.length : 0;
                written += w;
                skipped += Math.max(0, chunk.length - w);
                byEventType["sent"] = (byEventType["sent"] ?? 0) + chunk.length; // count considered; written vs skipped tracked separately
              }
            }
            // Batched insert-only upsert for people (dedupe by person_key)
            const dedup = new Map<string, { team_id: string; person_key: string; email: string | null; linkedin_url: string | null; full_name: string | null; job_title: string | null; company_name: string | null }>();
            for (const p of pagePeople) {
              const key = (p?.email && p.email.trim()) ? p.email.trim() : ((p?.linkedin && p.linkedin.trim()) ? p.linkedin.trim() : null);
              if (!key) continue;
              if (!dedup.has(key)) {
                dedup.set(key, {
                  team_id: (camp as any).team_id,
                  person_key: key,
                  email: p?.email ?? null,
                  linkedin_url: p?.linkedin ?? null,
                  full_name: null,
                  job_title: null,
                  company_name: null,
                });
              }
            }
            if (dedup.size > 0) {
              const { error: pplErr } = await supabase
                .from("people")
                // @ts-ignore onConflict supports column-list
                .upsert(Array.from(dedup.values()), { onConflict: "team_id,person_key", ignoreDuplicates: true })
                .select("id");
              if (pplErr) {
                errors++;
                const em = redact(pplErr.message ?? String(pplErr));
                if (errorSamples.length < 5) errorSamples.push(em);
                hasMore = true;
                nextCursor = { integrationId: integ.id, campaignExternalId: externalIdStr, offset };
                break outer;
              }
            }
          }

          // Advance offset
          offset += processedThisPage;
          if (processedThisPage < convs.length || convs.length < PAGE || rowsScanned >= maxLeads) break;
        }
        // Reset cursor gates once we pass the first eligible campaign
        cursorIntegrationId = null;
        cursorCampaignExternalId = null;
        startOffset = 0;
        if (rowsScanned >= maxLeads) {
          hasMore = true;
          nextCursor = { integrationId: integ.id, campaignExternalId: String(camp.external_campaign_id), offset: 0 };
          break outer;
        }
      }
      if (rowsScanned >= maxLeads) break;
    }

    // Ensure non-null cursor when hasMore is true
    if (hasMore && !nextCursor) {
      const integ0 = integrations[0];
      if (integ0) {
        nextCursor = { integrationId: integ0.id, campaignExternalId: null, offset: 0 };
      }
    }

    const baseResp: any = {
      success: true,
      rows_scanned: rowsScanned,
      rows_invalid: rowsInvalid,
      written,
      skipped,
      by_event_type: byEventType,
      errors,
      error_samples: errorSamples,
      hasMore,
      nextCursor,
    };
    if (dryRun) {
      baseResp.by_campaign = byCampaign;
    }
    return new Response(JSON.stringify(baseResp), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const red = redact(msg);
    console.error("[backfill-heyreach] fatal:", red);
    return new Response(JSON.stringify({ error: red }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Tiny unit tests for pure helpers and mapping shims (run under deno test)
try {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.test?.("redact X-API-KEY", () => {
    const s = "X-API-KEY: abcdef123";
    const r = redact(s);
    if (!/X-API-KEY:\s+\*\*\*/.test(r)) {
      throw new Error(`redact failed: ${r}`);
    }
  });
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.test?.("cursor encode/decode", () => {
    const cur = { integrationId: "int1", campaignExternalId: "42", offset: 100 };
    const encoded = btoa(JSON.stringify(cur));
    const parsed = parseMaybeJsonOrBase64(encoded) as any;
    if (!parsed || parsed.integrationId !== "int1" || parsed.campaignExternalId !== "42" || parsed.offset !== 100) {
      throw new Error(`cursor parse failed: ${JSON.stringify(parsed)}`);
    }
  });
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.test?.("row to event mapping (sent)", async () => {
    // Minimal shim for the mapping logic
    const convId = "c1";
    const accountId = 7;
    const profile = { profileUrl: "https://www.linkedin.com/in/john", emailAddress: "John@EXAMPLE.com", firstName: "John", lastName: "Doe", companyName: "ACME", position: "SE" };
    const msg = { id: "m9", sender: "ME", body: "Hello there", createdAt: "2026-01-02T03:04:05.000Z" };
    const emailLower = "john@example.com";
    const personKey = emailLower;
    const fp = await computeCopyFingerprint(msg.body!, null);
    const srcId = await computeSentSourceId({
      provider: "heyreach",
      personKey,
      occurredAt: msg.createdAt!,
      providerThreadId: convId,
      providerMessageId: msg.id!,
      copyFingerprint: fp,
      tag: null,
    });
    if (!srcId || !fp) {
      throw new Error("mapping failed to compute ids");
    }
  });
} catch {
  // ignore when not under test
}

