// signal-inputs-run — runs Signal Inputs (public.signal_inputs).
//
// POST bodies:
//   { source_key: "<writer>" }                 dispatcher (x-agent-key), daily per writer:
//                                              every active input of that family
//   { mode: "run", input_id }                  "Run now": every writer of that input
//   { mode: "preview", family, filters,        count + up to 5 examples, nothing written
//     input_id? }                              (stored on the input when given)
//
// Auth: x-agent-key (dispatcher), a platform admin's JWT, or — for run/preview
// — a member of the input's team. Writes go through the shared pipeline
// (signals_start_run → signals_upsert → signals_finish_run) under the writer
// source's key, so the run log and health strip work as for any source.
//
// Apollo (hiring) spends credits: 1 per organization search page and 1 per
// company whose postings are checked. Bounded per run (input_hiring config
// apollo_max_postings_lookups) and per UTC day across all runs
// (SIGNAL_INPUTS_APOLLO_DAILY_CAP, default 100).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type FetchResult, runSignalSource, signalsCors, upsertSignals } from "../_shared/signals.ts";
import { familyOfWriter, type InputFamily, missingFilters, normalizeFilters, WRITERS } from "./filters.ts";
import { type AdapterResult, type InputRow, runAdapter } from "./sources.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...signalsCors, "Content-Type": "application/json" } });

type Caller = { by: string; admin: boolean; uid: string | null; teams: string[] };

// deno-lint-ignore no-explicit-any
async function authorize(req: Request, supabase: any): Promise<Caller | null> {
  const agentKey = Deno.env.get("AGENT_API_KEY") ?? "";
  const key = req.headers.get("x-agent-key");
  if (agentKey && key && key === agentKey) return { by: "dispatcher", admin: true, uid: null, teams: [] };
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return null;
  const { data, error } = await supabase.auth.getUser(jwt);
  const uid = data?.user?.id;
  if (error || !uid) return null;
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("is_platform_admin").eq("id", uid).maybeSingle(),
    supabase.from("team_memberships").select("team_id").eq("user_id", uid),
  ]);
  const admin = profile?.is_platform_admin === true;
  return { by: `${admin ? "admin" : "user"}:${uid}`, admin, uid, teams: (memberships ?? []).map((m: { team_id: string }) => m.team_id) };
}

// deno-lint-ignore no-explicit-any
async function apolloCreditsToday(supabase: any): Promise<number> {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase.from("signal_runs").select("detail")
    .eq("source_key", "input_hiring").gte("started_at", day.toISOString());
  return (data ?? []).reduce((a: number, r: { detail?: { apollo_credits?: number } }) => a + Number(r.detail?.apollo_credits ?? 0), 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: signalsCors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const caller = await authorize(req, supabase);
  if (!caller) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode ?? (body?.source_key ? "dispatch" : null);
  const apolloKey = Deno.env.get("APOLLO_API_KEY") ?? null;
  const githubToken = Deno.env.get("GITHUB_TOKEN") ?? null;
  const dailyCap = Math.max(0, Number(Deno.env.get("SIGNAL_INPUTS_APOLLO_DAILY_CAP") ?? 100));
  const canUse = (teamId: string) => caller.admin || caller.teams.includes(teamId);

  const { data: sources } = await supabase.from("signal_sources").select("key, config").like("key", "input_%");
  const configOf = (k: string) => ((sources ?? []).find((s: { key: string }) => s.key === k)?.config ?? {}) as Record<string, unknown>;

  // ------------------------------------------------------------- preview ---
  if (mode === "preview") {
    let family = body?.family as InputFamily;
    let filters = body?.filters;
    let input: InputRow = { id: "preview", team_id: caller.teams[0] ?? "", source_key: family, name: "preview", all_clients: false };
    if (body?.input_id) {
      const { data: row } = await supabase.from("signal_inputs").select("*").eq("id", body.input_id).maybeSingle();
      if (!row || !canUse(row.team_id)) return json({ error: "Signal Input not found" }, 404);
      input = row;
      family = row.source_key;
      filters = filters ?? row.filters;
    }
    if (!WRITERS[family]) return json({ error: "unknown input type" }, 400);
    if (!caller.admin && !caller.teams.length) return json({ error: "no team" }, 403);
    const f = normalizeFilters(family, filters);
    const missing = missingFilters(family, f);
    if (missing) return json({ count: null, missing, sample: [], by_source: {} });
    const used = family === "hiring" ? await apolloCreditsToday(supabase) : 0;
    let count = 0, credits = 0;
    const sample: AdapterResult["sample"] = [];
    const bySource: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const w of WRITERS[family]) {
      const r = await runAdapter(w, input, f, {
        fetchFn: fetch, now: Date.now(), preview: true, config: configOf(w), apolloKey, githubToken,
        apolloCreditsLeft: Math.max(0, dailyCap - used),
      });
      count += r.total;
      credits += r.credits;
      sample.push(...r.sample);
      Object.assign(bySource, (r.detail?.by_source as Record<string, unknown>) ?? { [w]: r.total });
      if (r.error) errors.push(r.error);
    }
    if (body?.input_id) {
      await supabase.from("signal_inputs").update({ preview_count: count, preview_at: new Date().toISOString() }).eq("id", input.id);
    }
    return json({ count, apollo_credits: credits, by_source: bySource, sample: sample.slice(0, 5), error: errors.join("; ") || null, filters: f });
  }

  // ------------------------------------------------------------ run / dispatch
  let writers: string[];
  let inputs: Array<InputRow & { filters: unknown; source_key: InputFamily }>;
  if (mode === "run") {
    const { data: row } = await supabase.from("signal_inputs").select("*").eq("id", body?.input_id).maybeSingle();
    if (!row || !canUse(row.team_id)) return json({ error: "Signal Input not found" }, 404);
    writers = WRITERS[row.source_key as InputFamily];
    inputs = [row];
  } else if (mode === "dispatch") {
    if (caller.by !== "dispatcher" && !caller.admin) return json({ error: "Unauthorized" }, 401);
    const family = familyOfWriter(String(body.source_key));
    if (!family) return json({ error: `unknown writer ${body.source_key}` }, 400);
    writers = [String(body.source_key)];
    const { data: rows, error } = await supabase.from("signal_inputs").select("*").eq("source_key", family).eq("is_active", true)
      .order("created_at");
    if (error) return json({ error: error.message }, 500);
    inputs = rows ?? [];
  } else {
    return json({ error: "expected source_key, or mode run / preview" }, 400);
  }

  const results: Record<string, unknown>[] = [];
  for (const writer of writers) {
    const perInput: Record<string, Record<string, unknown>> = {};
    let credits = 0;
    const fetcher = async (): Promise<FetchResult> => {
      const signals: FetchResult["signals"] = [];
      let fetched = 0;
      const errors: string[] = [];
      const used = writer === "input_hiring" ? await apolloCreditsToday(supabase) : 0;
      for (const input of inputs) {
        const f = normalizeFilters(input.source_key, input.filters);
        const missing = missingFilters(input.source_key, f);
        if (missing) {
          perInput[input.id] = { status: "skipped", error: missing };
          continue;
        }
        try {
          const r = await runAdapter(writer, input, f, {
            fetchFn: fetch, now: Date.now(), preview: false, config: configOf(writer), apolloKey, githubToken,
            apolloCreditsLeft: Math.max(0, dailyCap - used - credits),
          });
          credits += r.credits;
          signals.push(...r.signals);
          fetched += r.fetched;
          perInput[input.id] = { status: r.error ? (r.signals.length ? "partial" : "failed") : "success", total: r.total,
            matched: r.signals.length, credits: r.credits, error: r.error ?? null, ...(r.detail ?? {}) };
          if (r.error) errors.push(`${input.name}: ${r.error}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          perInput[input.id] = { status: "failed", error: msg };
          errors.push(`${input.name}: ${msg}`);
        }
      }
      return {
        signals, fetched, error: errors.length ? errors.join("; ").slice(0, 1000) : null,
        detail: { inputs: inputs.length, apollo_credits: credits },
      };
    };
    // The daily run goes through the shared pipeline (run log, health strip,
    // signal_sources.last_run_at = the writer's schedule). "Run now" writes
    // directly so one team's manual run does not move everyone's schedule.
    let summary: { status: string; skipped?: string; inserted: number; updated: number; error?: string | null };
    if (mode === "dispatch") {
      summary = await runSignalSource({ supabase, sourceKey: writer, fetcher, triggeredBy: caller.by });
    } else {
      const r = await fetcher();
      try {
        const c = await upsertSignals(supabase, writer, r.signals);
        summary = { status: r.error ? (r.signals.length ? "partial" : "failed") : "success", inserted: c.inserted, updated: c.updated, error: r.error ?? null };
      } catch (e) {
        summary = { status: "failed", inserted: 0, updated: 0, error: e instanceof Error ? e.message : String(e) };
      }
      // Logged (without touching the source's schedule) so Apollo credits count toward the daily cap.
      await supabase.from("signal_runs").insert({
        source_key: writer, triggered_by: `${caller.by}:run_now`, status: summary.status,
        finished_at: new Date().toISOString(), fetched: r.fetched, inserted: summary.inserted, updated: summary.updated,
        error: summary.error, detail: { ...(r.detail ?? {}), input_id: inputs[0]?.id ?? null },
      });
    }
    results.push({ writer, status: summary.status, skipped: summary.skipped ?? null, inserted: summary.inserted,
      updated: summary.updated, error: summary.error ?? null, per_input: perInput });

    // Per-input result on the input row (what the Signal Inputs card shows).
    const at = new Date().toISOString();
    for (const input of inputs) {
      const r = perInput[input.id] ?? { status: summary.status === "skipped" ? "skipped" : "success", matched: 0, error: summary.skipped ?? null };
      const { data: cur } = await supabase.from("signal_inputs").select("last_run").eq("id", input.id).maybeSingle();
      const lastRun = { ...((cur?.last_run as Record<string, unknown>) ?? {}), [writer]: { at, ...r } };
      const statuses = Object.values(lastRun).map((x) => String((x as Record<string, unknown>).status));
      const overall = statuses.includes("failed") ? (statuses.every((s) => s === "failed") ? "failed" : "partial")
        : statuses.includes("partial") ? "partial" : statuses.every((s) => s === "skipped") ? "skipped" : "success";
      await supabase.from("signal_inputs").update({ last_run: lastRun, last_run_at: at, last_run_status: overall }).eq("id", input.id);
    }
  }
  console.log(`[signal-inputs-run] by=${caller.by} mode=${mode} ${JSON.stringify(results.map((r) => ({ ...r, per_input: undefined })))}`);
  return json({ results });
});
