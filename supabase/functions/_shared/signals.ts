// Signals: the ONE pipeline every source plugs into.
//
// A source is an edge function whose index.ts is just
//
//     serveSignalSource("openfda_510k", fetchOpenFda510k);
//
// plus one public.signal_sources row (key, vertical, cadence, visibility,
// config). The fetcher turns its upstream into SignalInput[]; everything else —
// auth, the run log, dedupe, the write, source health — happens here, the same
// way for every source:
//
//   signals_start_run   → signal_runs row ('running'), source config, last success
//   fetcher(ctx)        → { signals, fetched, detail?, error? }
//   signals_upsert      → keyed on dedupe_key, in chunks; visibility enforced in SQL
//   signals_finish_run  → run counts + signal_sources.last_run_* (health strip)
//
// Callers: the dispatcher (x-agent-key) or a platform admin's "Run now" (JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Visibility = "admin" | "all_clients" | "team";

export interface SignalInput {
  signal_type: string;
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
  payload?: Record<string, unknown>;
  /** Omit to use the source's default_visibility. Admin-only sources are forced to 'admin' in SQL. */
  visibility?: Visibility;
  /** Required when visibility is 'team'. */
  team_id?: string | null;
}

export interface SourceRow {
  key: string;
  vertical: string;
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
  const { rows: unique, duplicates } = dedupeBatch(rows);
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

  try {
    result = await fetcher({
      supabase,
      source,
      config: (source.config ?? {}) as Record<string, unknown>,
      lastSuccessAt: start.last_success_at ?? null,
      fetchFn: opts.fetchFn ?? fetch,
      now: opts.now ?? Date.now(),
    });
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

  const detail = { ...(result.detail ?? {}), rejected: counts.rejected, mapped: result.signals.length };
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
export function serveSignalSource(sourceKey: string, fetcher: Fetcher): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: signalsCors });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...signalsCors, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = await authorizeSignalsCaller(req, supabase, Deno.env.get("AGENT_API_KEY") ?? "");
    if (!auth.ok) return json({ error: "Unauthorized" }, 401);

    const summary = await runSignalSource({ supabase, sourceKey, fetcher, triggeredBy: auth.by });
    console.log(`[signals:${sourceKey}] ${JSON.stringify({ ...summary, detail: undefined })}`);
    return json(summary, summary.status === "failed" ? 500 : 200);
  });
}
