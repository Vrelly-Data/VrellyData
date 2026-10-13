// Signals: the ONE pipeline every source plugs into.
//
// A source is an edge function whose index.ts is just
//
//     serveSignalSource("openfda_510k", fetchOpenFda510k);
//
// plus one public.signal_sources row (key, signal_type, default_markets,
// cadence, visibility, config). The fetcher turns its upstream into SignalInput[]; everything else —
// auth, the run log, dedupe, the write, source health — happens here, the same
// way for every source:
//
//   signals_start_run   → signal_runs row ('running'), source config, last success
//   fetcher(ctx)        → { signals, fetched, detail?, error? }
//   fixText             → every string repaired (cp1252 ™/–, UTF-8 mojibake)
//   signals_upsert      → keyed on dedupe_key, in chunks; visibility enforced in SQL
//   afterUpsert(ctx)    → optional per-source step on the stored rows (enrichment)
//   signals_finish_run  → run counts + signal_sources.last_run_* (health strip)
//
// Callers: the dispatcher (x-agent-key) or a platform admin's "Run now" (JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Visibility = "admin" | "all_clients" | "team";

export interface SignalInput {
  /** Internal type (signal-catalog.ts). The SQL guard overrides it with the source's type. */
  signal_type: string;
  /** From signal-markets.ts assignMarkets(); empty = the source's default_markets, else 'other'. */
  markets?: string[];
  occurred_at: string;
  title: string;
  dedupe_key: string;
  score: number;
  url?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  person_name?: string | null;
  person_title?: string | null;
  person_email?: string | null;
  person_linkedin?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  industry?: string | null;
  seniority?: string | null;
  company_size?: string | null;
  /** Client-visible detail. Nothing here may reveal how an internal signal was found. */
  payload?: Record<string, unknown>;
  /** Admin-only detail (signal_admin_details): source evidence clients must never see. */
  admin_detail?: Record<string, unknown> | null;
  /** Omit to use the source's default_visibility. Admin-only sources are forced to 'admin' in SQL. */
  visibility?: Visibility;
  /** Required when visibility is 'team'. */
  team_id?: string | null;
}

export interface SourceRow {
  key: string;
  signal_type: string;
  default_markets: string[];
  kind: string;
  cadence: string;
  default_visibility: Visibility;
  config: Record<string, unknown>;
}

export interface SourceContext {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  source: SourceRow;
  config: Record<string, unknown>;
  /** started_at of the last successful (or partial) run; null = first run. */
  lastSuccessAt: string | null;
  fetchFn: typeof fetch;
  now: number;
}

export interface FetchResult {
  signals: SignalInput[];
  /** Upstream records looked at (before mapping/dedupe). */
  fetched: number;
  detail?: Record<string, unknown>;
  /** Set when the fetch stopped early; signals gathered so far are still written ('partial'). */
  error?: string | null;
}

export type Fetcher = (ctx: SourceContext) => Promise<FetchResult>;

/**
 * Optional step after the write, on what is now stored (e.g. High Intent
 * enrichment). Its detail is merged into the run's; an error makes a
 * successful run 'partial' — the signals themselves are already written.
 */
export type AfterUpsert = (ctx: SourceContext) => Promise<{ detail?: Record<string, unknown>; error?: string | null }>;

export interface RunSummary {
  run_id?: string;
  status: "success" | "partial" | "failed" | "skipped";
  skipped?: string;
  fetched: number;
  inserted: number;
  updated: number;
  deduped: number;
  rejected: number;
  error?: string | null;
  detail?: Record<string, unknown>;
}

// --------------------------------------------------------------- helpers ---

// Windows-1252 bytes 0x80–0x9F, as they come out when cp1252 text is decoded
// as Latin-1 (openFDA does this: "3M\u0099 Attest\u0099" is "3M™ Attest™").
const CP1252_C1: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰",
  0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•",
  0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};
const CP1252_REVERSE = new Map(Object.entries(CP1252_C1).map(([b, c]) => [c, Number(b)]));
// UTF-8 read as cp1252/Latin-1: a lead byte (Ã Â â Ð …) followed by a continuation-looking char.
const MOJIBAKE = /[\u00c2-\u00f4][\u0080-\u00bf\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/;

/**
 * Repairs text that was decoded with the wrong charset upstream:
 *   1. UTF-8 read as cp1252/Latin-1 ("MickaÃ«l" → "Mickaël", "Itâ€™s" → "It’s"),
 *      only when the whole string re-encodes to valid UTF-8 — otherwise untouched;
 *   2. stray C1 controls U+0080–U+009F read as cp1252 ("\u0099" → "™").
 * Strips other control characters except tab/newline. Idempotent.
 */
export function fixText(input: string): string {
  let s = input;
  if (MOJIBAKE.test(s)) {
    const bytes: number[] = [];
    let ok = true;
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp <= 0xff) bytes.push(cp);
      else if (CP1252_REVERSE.has(ch)) bytes.push(CP1252_REVERSE.get(ch)!);
      else { ok = false; break; }
    }
    if (ok) {
      try {
        s = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
      } catch { /* not mojibake after all: keep it */ }
    }
  }
  s = s.replace(/[\u0080-\u009f]/g, (c) => CP1252_C1[c.charCodeAt(0)] ?? "");
  // deno-lint-ignore no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** fixText over every string in a value (objects and arrays, recursively). */
export function fixTextDeep<T>(v: T): T {
  if (typeof v === "string") return fixText(v) as unknown as T;
  if (Array.isArray(v)) return v.map(fixTextDeep) as unknown as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fixTextDeep(x)])) as T;
  }
  return v;
}

/** Lower-cased bare host: strips scheme, www., path, port. null when it isn't a domain. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.replace(/^[^@/]*@/, ""); // user@ in a URL
  s = s.split(/[/?#:]/)[0];
  s = s.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s) ? s : null;
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Stable dedupe key: prefix + parts, each trimmed and lower-cased, joined by ':'.
 * Empty / missing parts throw — a key that silently collapses to the prefix
 * would merge unrelated signals.
 */
export function dedupeKey(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  const clean = parts.map((p) => (p === null || p === undefined ? "" : String(p).trim().toLowerCase()));
  if (!prefix || clean.some((p) => p === "")) {
    throw new Error(`dedupeKey(${prefix}): empty part in [${parts.join(", ")}]`);
  }
  return [prefix, ...clean].join(":");
}

/** Within-batch dedupe: one row per dedupe_key, the latest occurred_at wins (ties: last seen). */
export function dedupeBatch(rows: SignalInput[]): { rows: SignalInput[]; duplicates: number } {
  const byKey = new Map<string, SignalInput>();
  for (const r of rows) {
    const prev = byKey.get(r.dedupe_key);
    if (!prev || Date.parse(r.occurred_at) >= Date.parse(prev.occurred_at)) byKey.set(r.dedupe_key, r);
  }
  return { rows: [...byKey.values()], duplicates: rows.length - byKey.size };
}

/** "2026-10-09" → ISO at 00:00Z; ISO strings pass through; bad input → null. */
export function toIso(d: string | number | null | undefined): string | null {
  if (d === null || d === undefined || d === "") return null;
  if (typeof d === "number") return Number.isFinite(d) ? new Date(d).toISOString() : null;
  const s = String(d).trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function collapseSpaces(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/\s+/g, " ").trim();
  return t || null;
}

/** Writes through signals_upsert in chunks. Returns summed counts. */
export async function upsertSignals(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  sourceKey: string,
  rows: SignalInput[],
  chunkSize = 500,
): Promise<{ inserted: number; updated: number; deduped: number; rejected: number }> {
  const { rows: unique, duplicates } = dedupeBatch(rows.map(fixTextDeep));
  const total = { inserted: 0, updated: 0, deduped: duplicates, rejected: 0 };
  for (let i = 0; i < unique.length; i += chunkSize) {
    const { data, error } = await supabase.rpc("signals_upsert", {
      p_source_key: sourceKey,
      p_rows: unique.slice(i, i + chunkSize),
    });
    if (error) throw new Error(`signals_upsert failed: ${error.message}`);
    total.inserted += Number(data?.inserted ?? 0);
    total.updated += Number(data?.updated ?? 0);
    total.deduped += Number(data?.deduped ?? 0);
    total.rejected += Number(data?.rejected ?? 0);
  }
  return total;
}

// ------------------------------------------------------------------- run ---

/** The whole run for one source. Never throws: every outcome lands in signal_runs. */
export async function runSignalSource(opts: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  sourceKey: string;
  fetcher: Fetcher;
  afterUpsert?: AfterUpsert;
  triggeredBy?: string;
  fetchFn?: typeof fetch;
  now?: number;
}): Promise<RunSummary> {
  const { supabase, sourceKey, fetcher } = opts;
  const zero = { fetched: 0, inserted: 0, updated: 0, deduped: 0, rejected: 0 };

  const { data: start, error: startErr } = await supabase.rpc("signals_start_run", {
    p_source_key: sourceKey,
    p_triggered_by: opts.triggeredBy ?? "dispatcher",
  });
  if (startErr) return { status: "failed", ...zero, error: `start failed: ${startErr.message}` };
  if (start?.skipped) return { status: "skipped", skipped: String(start.skipped), ...zero };

  const runId = String(start.run_id);
  const source = start.source as SourceRow;
  let result: FetchResult;
  let counts = { inserted: 0, updated: 0, deduped: 0, rejected: 0 };
  let status: RunSummary["status"];
  let error: string | null = null;

  const ctx: SourceContext = {
    supabase,
    source,
    config: (source.config ?? {}) as Record<string, unknown>,
    lastSuccessAt: start.last_success_at ?? null,
    fetchFn: opts.fetchFn ?? fetch,
    now: opts.now ?? Date.now(),
  };
  try {
    result = await fetcher(ctx);
  } catch (e) {
    result = { signals: [], fetched: 0, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    counts = await upsertSignals(supabase, sourceKey, result.signals);
    error = result.error ?? null;
    status = error ? (result.signals.length > 0 ? "partial" : "failed") : "success";
  } catch (e) {
    error = [result.error, e instanceof Error ? e.message : String(e)].filter(Boolean).join("; ");
    status = "failed";
  }

  let afterDetail: Record<string, unknown> = {};
  if (opts.afterUpsert && status !== "failed") {
    try {
      const a = await opts.afterUpsert(ctx);
      afterDetail = a.detail ?? {};
      if (a.error) {
        error = [error, a.error].filter(Boolean).join("; ");
        status = "partial";
      }
    } catch (e) {
      error = [error, `after-upsert: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join("; ");
      status = "partial";
    }
  }

  const detail = { ...(result.detail ?? {}), ...afterDetail, rejected: counts.rejected, mapped: result.signals.length };
  const { error: finErr } = await supabase.rpc("signals_finish_run", {
    p_run_id: runId,
    p_status: status,
    p_fetched: result.fetched,
    p_inserted: counts.inserted,
    p_updated: counts.updated,
    p_deduped: counts.deduped,
    p_error: error,
    p_detail: detail,
  });
  if (finErr) console.error(`[signals:${sourceKey}] finish_run failed: ${finErr.message}`);

  return { run_id: runId, status, fetched: result.fetched, ...counts, error, detail };
}

// ------------------------------------------------------------------ auth ---

/** x-agent-key (dispatcher/cron) or a platform admin's JWT ("Run now"). */
export async function authorizeSignalsCaller(
  req: Request,
  // deno-lint-ignore no-explicit-any
  admin: any,
  agentKey: string,
): Promise<{ ok: true; by: string } | { ok: false }> {
  const key = req.headers.get("x-agent-key");
  if (agentKey && key && key === agentKey) return { ok: true, by: "dispatcher" };
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return { ok: false };
  const { data: userData, error } = await admin.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (error || !uid) return { ok: false };
  const { data: profile } = await admin.from("profiles").select("is_platform_admin").eq("id", uid).maybeSingle();
  return profile?.is_platform_admin === true ? { ok: true, by: `admin:${uid}` } : { ok: false };
}

export const signalsCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The entire index.ts of a source function. */
export function serveSignalSource(sourceKey: string, fetcher: Fetcher, afterUpsert?: AfterUpsert): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: signalsCors });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...signalsCors, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = await authorizeSignalsCaller(req, supabase, Deno.env.get("AGENT_API_KEY") ?? "");
    if (!auth.ok) return json({ error: "Unauthorized" }, 401);

    const summary = await runSignalSource({ supabase, sourceKey, fetcher, afterUpsert, triggeredBy: auth.by });
    console.log(`[signals:${sourceKey}] ${JSON.stringify({ ...summary, detail: undefined })}`);
    return json(summary, summary.status === "failed" ? 500 : 200);
  });
}
