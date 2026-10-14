// enrich-inference-events — fills the backfill's fields on every new reply in
// inference_events. Logic: ./enrich.ts (order, failures) and ./rules.ts
// (formats). Called every 5 min by pg_cron (enrich-inference-events-5min,
// created disabled) with x-agent-key, or by a platform admin.
//
// Body (all optional): { limit: 1–500 (default 200), days (default 30),
//                        ids: [uuid…] — enrich exactly these rows }
// Env: ENRICH_ENABLED=false → do nothing (kill switch).
//      APOLLO_DAILY_CAP (default 300) — Apollo credits per UTC day, all runs.
//      APOLLO_API_KEY — the shared Apollo key (already set for apollo-enrich).
// Rate limits: Reply.io ≤ 90 calls/min across the run (and 30s per call: Reply.io
// throttles by stalling); Apollo bulk_match ≤ 10 people per call.
// Provider keys come from outbound_integrations and are never logged.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { APOLLO_BASE, apolloHeaders } from "../_shared/apollo.ts";
import { authorizeSignalsCaller, signalsCors } from "../_shared/signals.ts";
import {
  type ApolloResult, type EnrichDeps, type FreeData, type Integration, PermanentError, type QueueRow, runEnrichment, type SiblingRow,
  TransientError,
} from "./enrich.ts";
import type { ReplyStep, SmartleadStat, ThreadMessage } from "./rules.ts";

const REPLY_V3 = "https://api.reply.io/v3";
const SMARTLEAD = "https://server.smartlead.ai/api/v1";
const HEYREACH = "https://api.heyreach.io/api/public";
const RUN_BUDGET_MS = 100_000; // stop starting new rows after this; the cron call times out at 150s
const CALL_TIMEOUT_MS = 30_000;
const REPLY_MIN_GAP_MS = Math.ceil(60_000 / 90);
const SMARTLEAD_MAX_PAGES = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const redact = (s: string) => s.replace(/api_key=[^&\s)]+/gi, "api_key=***");

/** HTTP status → which kind of failure. */
function classify(status: number, what: string): Error {
  if (status === 429 || status === 408 || status >= 500) return new TransientError(`${what} HTTP ${status}`);
  return new PermanentError(`${what} HTTP ${status}`);
}

async function fetchJson(url: string, init: RequestInit, what: string, retries = 2): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    } catch (e) {
      if (attempt < retries) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new TransientError(`${what}: ${redact(e instanceof Error ? e.message : String(e))}`);
    }
    if (res.ok) return await res.json().catch(() => null);
    await res.body?.cancel().catch(() => {});
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Math.min(20_000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** attempt));
      continue;
    }
    throw classify(res.status, what);
  }
}

// deno-lint-ignore no-explicit-any
function realDeps(supabase: any): EnrichDeps {
  const integrations = new Map<string, Integration | null>();
  let lastReplyCall = 0;
  const replyGet = async (i: Integration, path: string, what: string) => {
    const wait = lastReplyCall + REPLY_MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastReplyCall = Date.now();
    const headers: Record<string, string> = { Authorization: `Bearer ${i.apiKey}`, Accept: "application/json" };
    if (i.replyTeamId) headers["X-Reply-Team-Id"] = i.replyTeamId;
    return fetchJson(`${REPLY_V3}${path}`, { headers }, what);
  };

  return {
    now: () => Date.now(),

    async freeLookups(rows) {
      const out: Record<string, FreeData> = {};
      for (let i = 0; i < rows.length; i += 100) {
        const part = rows.slice(i, i + 100).map((r) => ({ id: r.id, team_id: r.team_id, person_key: r.person_key, email: r.email }));
        const { data, error } = await supabase.rpc("inference_enrich_free_lookups", { p_targets: part });
        if (error) throw new Error(`inference_enrich_free_lookups: ${error.message}`);
        Object.assign(out, data ?? {});
      }
      return out;
    },

    async stateTz() {
      const { data, error } = await supabase.rpc("inference_enrich_state_tz");
      if (error) throw new Error(`inference_enrich_state_tz: ${error.message}`);
      return new Map<string, string>((data ?? []).map((r: { state: string; tz: string }) => [r.state.toLowerCase(), r.tz]));
    },

    async integration(teamId, platform) {
      const k = `${teamId}:${platform}`;
      if (!integrations.has(k)) {
        const { data } = await supabase.from("outbound_integrations")
          .select("api_key_encrypted, reply_team_id")
          .eq("team_id", teamId).eq("platform", platform).eq("is_active", true)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        integrations.set(k, data?.api_key_encrypted ? { apiKey: data.api_key_encrypted, replyTeamId: data.reply_team_id ?? null } : null);
      }
      return integrations.get(k) ?? null;
    },

    async replyThread(i, threadId) {
      return (await replyGet(i, `/inbox/threads/${encodeURIComponent(threadId)}`, "reply.io thread")) as Record<string, unknown>;
    },

    async replyMessages(i, threadId) {
      const out: ThreadMessage[] = [];
      for (let skip = 0, page = 0; page < 5; page++, skip += 100) {
        // deno-lint-ignore no-explicit-any
        const j: any = await replyGet(i, `/inbox/threads/${encodeURIComponent(threadId)}/messages?top=100&skip=${skip}`, "reply.io messages");
        const items = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
        out.push(...items.map((m: Record<string, unknown>) => ({
          isOutbound: m.isOutbound === true, date: (m.date as string) ?? undefined, subject: (m.subject as string) ?? null,
        })));
        if (!j?.hasMore || !items.length) break;
      }
      return out;
    },

    async replySequence(i, sequenceId) {
      // deno-lint-ignore no-explicit-any
      const j: any = await replyGet(i, `/sequences/${encodeURIComponent(sequenceId)}`, "reply.io sequence");
      return (Array.isArray(j?.steps) ? j.steps : []) as ReplyStep[];
    },

    async smartleadReplied(i, campaignId, _sinceIso, want) {
      const rows: SmartleadStat[] = [];
      const found = new Set<string>();
      for (let page = 0; page < SMARTLEAD_MAX_PAGES; page++) {
        const u = new URL(`${SMARTLEAD}/campaigns/${encodeURIComponent(campaignId)}/statistics`);
        u.searchParams.set("email_status", "replied");
        u.searchParams.set("limit", "100");
        u.searchParams.set("offset", String(page * 100));
        u.searchParams.set("api_key", i.apiKey);
        // deno-lint-ignore no-explicit-any
        const j: any = await fetchJson(u.toString(), { headers: { Accept: "application/json" } }, "smartlead statistics");
        const data: SmartleadStat[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
        rows.push(...data);
        for (const r of data) if (r.stats_id !== null && r.stats_id !== undefined) found.add(String(r.stats_id));
        if (data.length < 100 || (want.size && [...want].every((w) => found.has(w)))) break;
        await sleep(250);
      }
      return rows;
    },

    async heyreachAccount(conversationId) {
      const { data } = await supabase.from("agent_leads").select("heyreach_account_id")
        .eq("heyreach_conversation_id", conversationId).not("heyreach_account_id", "is", null).limit(1).maybeSingle();
      return data?.heyreach_account_id ? String(data.heyreach_account_id) : null;
    },

    async heyreachChatroom(i, accountId, conversationId) {
      return (await fetchJson(
        `${HEYREACH}/inbox/GetChatroom/${encodeURIComponent(accountId)}/${encodeURIComponent(conversationId)}`,
        { headers: { "X-API-KEY": i.apiKey, Accept: "application/json" } },
        "heyreach chatroom",
      )) as Record<string, unknown>;
    },

    async siblings(rows) {
      const out = new Map<string, SiblingRow>();
      const keys = [...new Set(rows.map((r) => r.person_key).filter(Boolean))];
      for (let i = 0; i < keys.length; i += 100) {
        const { data, error } = await supabase.from("inference_events")
          .select("id, team_id, person_key, occurred_at, metadata, campaign_external_id, campaign_name, subject, copy_fingerprint")
          .eq("event_type", "replied").in("person_key", keys.slice(i, i + 100)).not("source", "like", "%_backfill");
        if (error) throw new Error(`siblings: ${error.message}`);
        for (const r of rows) {
          const t = new Date(r.occurred_at).getTime();
          let best: (SiblingRow & { d: number }) | null = null;
          for (const s of data ?? []) {
            if (s.person_key !== r.person_key || (s.team_id ?? null) !== (r.team_id ?? null)) continue;
            const d = Math.abs(new Date(s.occurred_at).getTime() - t);
            if (d <= 7 * 86_400_000 && (!best || d < best.d)) best = { ...s, d };
          }
          if (best) out.set(r.id, best);
        }
      }
      return out;
    },

    async apolloCreditsToday() {
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      const { data, error } = await supabase.from("inference_enrichment_log").select("credits")
        .eq("step", "apollo").gt("credits", 0).gte("created_at", day.toISOString());
      if (error) throw new Error(`apollo credits today: ${error.message}`);
      return (data ?? []).reduce((a: number, r: { credits: number }) => a + (r.credits ?? 0), 0);
    },

    async apolloMatch(details): Promise<ApolloResult> {
      const key = Deno.env.get("APOLLO_API_KEY");
      if (!key) return { matches: details.map(() => null), credits: 0, insufficient: false, error: "APOLLO_API_KEY not set" };
      const res = await fetch(`${APOLLO_BASE}/people/bulk_match`, {
        method: "POST",
        headers: apolloHeaders(key),
        // Never personal emails or phones: firmographics only.
        body: JSON.stringify({ reveal_personal_emails: false, reveal_phone_number: false, details }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300);
        const insufficient = res.status === 422 && /credit/i.test(body);
        return { matches: details.map(() => null), credits: 0, insufficient, error: insufficient ? null : `bulk_match HTTP ${res.status}` };
      }
      const j = await res.json().catch(() => null);
      const matches: unknown[] = Array.isArray(j?.matches) ? j.matches : [];
      const credits = typeof j?.credits_consumed === "number" ? j.credits_consumed : matches.filter(Boolean).length;
      return { matches: details.map((_, k) => matches[k] ?? null), credits, insufficient: false, error: null };
    },

    async apply(rows) {
      const { data, error } = await supabase.rpc("inference_enrich_apply", { p_rows: rows });
      if (error) throw new Error(`inference_enrich_apply: ${error.message}`);
      return Number(data ?? 0);
    },

    async log(rows) {
      const { error } = await supabase.from("inference_enrichment_log").insert(
        rows.map((r) => ({ event_id: r.event_id, step: r.step, status: r.status, error: r.error ?? null, credits: r.credits ?? 0 })),
      );
      if (error) console.error(`[enrich-inference-events] log insert failed: ${error.message}`);
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: signalsCors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...signalsCors, "Content-Type": "application/json" } });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authorizeSignalsCaller(req, supabase, Deno.env.get("AGENT_API_KEY") ?? "");
  if (!auth.ok) return json({ error: "Unauthorized" }, 401);

  if (/^(false|0|off|no)$/i.test(Deno.env.get("ENRICH_ENABLED") ?? "")) return json({ skipped: "ENRICH_ENABLED is off" });

  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, 500) : null;
  const { data: queue, error } = await supabase.rpc("inference_enrich_queue", {
    p_limit: Math.max(1, Math.min(500, Number(body?.limit ?? 200))),
    p_days: Math.max(1, Number(body?.days ?? 30)),
    p_ids: ids && ids.length ? ids : null,
  });
  if (error) return json({ error: `inference_enrich_queue: ${error.message}` }, 500);

  const cap = Number(Deno.env.get("APOLLO_DAILY_CAP") ?? 300);
  try {
    const summary = await runEnrichment((queue ?? []) as QueueRow[], realDeps(supabase), {
      apolloDailyCap: Number.isFinite(cap) && cap >= 0 ? cap : 300,
      deadlineMs: started + RUN_BUDGET_MS,
    });
    console.log(`[enrich-inference-events] ${JSON.stringify({ by: auth.by, ...summary, ms: Date.now() - started })}`);
    return json({ ...summary, ms: Date.now() - started });
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e));
    console.error(`[enrich-inference-events] run failed: ${msg}`);
    return json({ error: msg }, 500);
  }
});
