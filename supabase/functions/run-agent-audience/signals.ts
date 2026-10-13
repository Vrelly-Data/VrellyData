// run-agent-audience, source = 'signals'. Called after the claim, the run row
// and the LIVE campaign preflight — nothing here runs for a campaign that
// cannot send.
//
//   1. compile the saved filters (_shared/signal-audience.ts);
//   2. read the Apollo budget, only if the paid fallback could be needed;
//   3. walk matching signals this audience has not used yet, best first
//      (signals_audience_candidates — visibility for THIS user applied in SQL),
//      a page at a time, resolving each page cheapest first
//      (_shared/signal-resolver.ts) until max_per_run people are collected.
//      Companies are taken whole: a company whose people would overflow the
//      run's allowance waits for the next run (unless it is the first, then it
//      is sliced);
//   4. dedupe within the run on email and LinkedIn (the SQL and the resolver
//      already dropped everyone pushed, a lead or a synced contact);
//   5. push through add-contacts-to-sequence with the signal as custom fields
//      (signal_type, signal_title, signal_date, signal_url);
//   6. record the signals this run consumed (agent_audience_signals) and mark
//      the pushed ones 'pushed' for the team (signals_mark_audience_used).
//
// A signal is NOT recorded as used when its company was skipped for budget,
// Apollo failed, its push failed, or it did not fit in this run: it comes back
// next run. A signal with nobody to reach IS recorded (no_people /
// all_duplicates), so runs do not re-resolve it forever.
//
// MANUAL SHAPES:
//   signal_ids  [...]                         only these signals (from Signals ->
//                                              "Build audience from these").
//   selections  [{signal_id, person_key}]     exactly these people, from the
//                                              preview. person_key is 'p:<prospect
//                                              id>', 'a:<apollo id>' or
//                                              'e:<email>'. The server re-resolves
//                                              the signals and only pushes keys it
//                                              found itself — a client cannot
//                                              smuggle an email in.

import { normalizeEmailKey, normalizeLinkedInUrl } from "../_shared/lead-dedup.ts";
import { compileSignalAudience, type CompiledSignalAudience, SignalFilterError } from "../_shared/signal-audience.ts";
import {
  type CandidateSignal, type ResolvedPerson, type ResolverDeps, resolveSignals, signalCustomFields,
} from "../_shared/signal-resolver.ts";
import { readApolloBudget, supabaseResolverDeps } from "../_shared/signal-resolver-supabase.ts";

export const SIGNALS_PAGE = 25;
/** Signals one run may look at, so a run with nobody to find still ends. */
export const SIGNALS_MAX_SCAN = 200;

type Status = "success" | "partial" | "failed";
type Reason = "monthly_cap" | "apollo_insufficient_credits" | null;

export interface SignalsRunResult {
  status: Status;
  reason: Reason;
  errorDetail: Record<string, unknown> | null;
  httpStatus: number;
  error?: string;
  note?: string;
  signalsConsidered: number;
  signalsMarked: number;
  results?: unknown;
}

export interface Counters {
  searched: number; enriched: number; credits_spent: number;
  pushed: number; skipped_duplicate: number; failed: number;
}

export function personKey(p: Pick<ResolvedPerson, "prospect_id" | "apollo_person_id" | "email">): string | null {
  if (p.prospect_id) return `p:${p.prospect_id}`;
  if (p.apollo_person_id) return `a:${p.apollo_person_id}`;
  const e = normalizeEmailKey(p.email);
  return e ? `e:${e}` : null;
}

/** The contact add-contacts-to-sequence receives, with the signal as custom fields. */
export function toPushContact(p: ResolvedPerson, s: CandidateSignal): Record<string, unknown> {
  return {
    ...(p.prospect_id ? { prospect_id: p.prospect_id } : {}),
    ...(p.apollo_person_id ? { apollo_person_id: p.apollo_person_id } : {}),
    email: p.email,
    first_name: p.first_name, last_name: p.last_name, linkedin_url: p.linkedin_url,
    title: p.title, company_name: p.company_name ?? s.company_name, company_domain: p.company_domain ?? s.company_domain,
    city: p.city, state: p.state, country: p.country,
    custom_fields: signalCustomFields(s),
  };
}

export interface PlanItem { signal: CandidateSignal; people: ResolvedPerson[]; found: number }

/**
 * Steps 3-4 as a pure function over resolved pages: which people to push and
 * which signals to record as used without a push. Exported for tests.
 */
export function planPage(
  resolved: Array<{ signal: CandidateSignal; people: ResolvedPerson[]; apollo: string }>,
  state: { allowance: number; taken: number; seen: Set<string>; selections: Map<string, Set<string>> | null },
): { take: PlanItem[]; unused: Array<{ signal_id: string; outcome: "no_people" | "all_duplicates"; people_found: number }>; full: boolean } {
  const take: PlanItem[] = [];
  const unused: Array<{ signal_id: string; outcome: "no_people" | "all_duplicates"; people_found: number }> = [];
  let taken = state.taken;
  for (const r of resolved) {
    const wanted = state.selections?.get(r.signal.id) ?? null;
    let people = r.people.filter((p) => !p.pending && normalizeEmailKey(p.email));
    if (wanted) people = people.filter((p) => wanted.has(personKey(p) ?? ""));
    const fresh = people.filter((p) => {
      const keys = [`e:${normalizeEmailKey(p.email)}`, normalizeLinkedInUrl(p.linkedin_url) ? `l:${normalizeLinkedInUrl(p.linkedin_url)}` : null]
        .filter((k): k is string => !!k);
      return !keys.some((k) => state.seen.has(k));
    });
    if (!fresh.length) {
      // Retry later when the paid step did not get to run; and never record a
      // hand-picked selection as used just because its picks were filtered.
      const retry = ["budget", "insufficient_credits", "failed", "pending"].includes(r.apollo) || !!wanted;
      if (!retry) unused.push({ signal_id: r.signal.id, outcome: r.people.length ? "all_duplicates" : "no_people", people_found: r.people.length });
      continue;
    }
    const room = state.allowance - taken;
    if (room <= 0) return { take, unused, full: true };
    // Whole companies only, except the first of a run (else a per-company
    // count above max_per_run would push nobody, ever).
    if (fresh.length > room && taken > 0) return { take, unused, full: true };
    const chosen = fresh.slice(0, room);
    for (const p of chosen) {
      state.seen.add(`e:${normalizeEmailKey(p.email)}`);
      const l = normalizeLinkedInUrl(p.linkedin_url);
      if (l) state.seen.add(`l:${l}`);
    }
    take.push({ signal: r.signal, people: chosen, found: r.people.length });
    taken += chosen.length;
  }
  return { take, unused, full: taken >= state.allowance };
}

export async function runSignalsSource(args: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  supabaseUrl: string;
  agentApiKey: string;
  userId: string;
  audience: { id: string; agent_config_id: string; filters: unknown };
  runId: string | null;
  allowance: number;
  signalIds: string[] | null;
  selections: Array<{ signal_id?: unknown; person_key?: unknown }> | null;
  counters: Counters;
  push: (contacts: Record<string, unknown>[]) => Promise<{ ok: true; body: any } | { ok: false; detail: string }>;
  /** Tests inject; production builds it from the client. */
  deps?: ResolverDeps;
}): Promise<SignalsRunResult> {
  const { supabase, userId, audience, counters } = args;
  const base = { signalsConsidered: 0, signalsMarked: 0 };

  let compiled: CompiledSignalAudience;
  try {
    compiled = compileSignalAudience(audience.filters);
  } catch (e) {
    if (!(e instanceof SignalFilterError)) throw e;
    return { ...base, status: "failed", reason: null, errorDetail: { stage: "filters", detail: e.message }, httpStatus: 400, error: e.message };
  }
  if (args.allowance <= 0) {
    return { ...base, status: "success", reason: null, errorDetail: null, httpStatus: 200, note: "audience cap reached — nothing to push" };
  }

  // Selections name signals + people; the signals list is derived from them.
  let selections: Map<string, Set<string>> | null = null;
  let signalIds = args.signalIds?.filter(Boolean) ?? null;
  if (args.selections && args.selections.length) {
    selections = new Map();
    for (const s of args.selections) {
      const sid = String(s.signal_id ?? ""), pk = String(s.person_key ?? "");
      if (!sid || !/^(p|a|e):/.test(pk)) continue;
      if (!selections.has(sid)) selections.set(sid, new Set());
      selections.get(sid)!.add(pk);
    }
    signalIds = [...selections.keys()];
    if (!signalIds.length) {
      return { ...base, status: "failed", reason: null, errorDetail: { stage: "input", detail: "no valid selections" }, httpStatus: 400, error: "No valid selections" };
    }
  }

  // ---- Apollo budget, only when the fallback could run ----------------------
  let budget = 0;
  let apolloKey: string | null = null;
  if (compiled.useApollo && compiled.apollo) {
    let b;
    try {
      b = await readApolloBudget(supabase, userId, audience.agent_config_id);
    } catch (e) {
      const d = e instanceof Error ? e.message : String(e);
      return { ...base, status: "failed", reason: null, errorDetail: { stage: "budget", detail: d }, httpStatus: 500, error: "Could not read the Apollo credit budget" };
    }
    if (b) {
      budget = b.remaining;
      apolloKey = b.key;
      if (args.runId) await supabase.from("agent_audience_runs").update({ apollo_key_source: b.keySource }).eq("id", args.runId);
    } else {
      compiled = { ...compiled, useApollo: false };
    }
  }

  const deps = args.deps ?? supabaseResolverDeps(supabase, {
    userId, compiled, apolloKey, supabaseUrl: args.supabaseUrl, agentApiKey: args.agentApiKey,
  });

  // ---- 3-4. walk, resolve, plan ---------------------------------------------
  const plan: PlanItem[] = [];
  const unused: Array<{ signal_id: string; outcome: string; people_found: number; people_pushed: number }> = [];
  const state = { allowance: args.allowance, taken: 0, seen: new Set<string>(), selections };
  let reason: Reason = null;
  let offset = 0;
  let resolveError: string | null = null;
  while (state.taken < args.allowance && base.signalsConsidered < SIGNALS_MAX_SCAN) {
    const { data, error } = await supabase.rpc("signals_audience_candidates", {
      p_user_id: userId, p_query: compiled.candidates, p_audience_id: audience.id,
      p_signal_ids: signalIds, p_limit: SIGNALS_PAGE, p_offset: offset, p_count: false,
    });
    if (error) { resolveError = `signals_audience_candidates: ${error.message}`; break; }
    const page = (data?.signals ?? []) as CandidateSignal[];
    if (!page.length) break;
    base.signalsConsidered += page.length;
    offset += page.length;

    let outcome;
    try {
      outcome = await resolveSignals(page, { mode: "run", compiled, budget: budget - counters.credits_spent }, deps);
    } catch (e) {
      resolveError = e instanceof Error ? e.message : String(e);
      break;
    }
    counters.credits_spent += outcome.credits_spent;
    counters.enriched += outcome.resolved.reduce((n, r) => n + (r.apollo === "enriched" ? r.people.length : 0), 0);
    if (outcome.stop_reason) reason = outcome.stop_reason;

    const p = planPage(outcome.resolved, state);
    plan.push(...p.take);
    state.taken += p.take.reduce((n, t) => n + t.people.length, 0);
    unused.push(...p.unused.map((u) => ({ ...u, people_pushed: 0 })));
    if (p.full || page.length < SIGNALS_PAGE) break;
  }
  counters.searched = plan.reduce((n, t) => n + t.people.length, 0);

  const mark = async (rows: typeof unused): Promise<number> => {
    if (!rows.length) return 0;
    const { data, error } = await supabase.rpc("signals_mark_audience_used", {
      p_user_id: userId, p_audience_id: audience.id, p_run_id: args.runId, p_rows: rows,
    });
    if (error) console.error(`[run-agent-audience] signals_mark_audience_used failed: ${error.message}`);
    return Number(data ?? 0);
  };

  if (resolveError && !plan.length) {
    base.signalsMarked = await mark(unused);
    return { ...base, status: "failed", reason, errorDetail: { stage: "resolve", detail: resolveError.slice(0, 300) }, httpStatus: 502, error: "Signal resolution failed" };
  }

  if (!plan.length) {
    base.signalsMarked = await mark(unused);
    return {
      ...base, status: reason ? "partial" : "success", reason,
      errorDetail: reason ? { stage: "enrich", reason } : null, httpStatus: 200,
      note: reason === "monthly_cap" ? "monthly Apollo credit cap reached — nobody new to push"
        : reason === "apollo_insufficient_credits" ? "Apollo has no credits left — nobody new to push"
        : base.signalsConsidered === 0 ? "no matching signals this audience has not used yet"
        : "nobody new to reach at the matching signals' companies",
    };
  }

  // ---- 5. push (IRREVERSIBLE) -----------------------------------------------
  const contacts = plan.flatMap((t) => t.people.map((p) => toPushContact(p, t.signal)));
  const signalOfEmail = new Map<string, string>();
  for (const t of plan) for (const p of t.people) signalOfEmail.set(normalizeEmailKey(p.email)!, t.signal.id);

  const pr = await args.push(contacts);
  if (!pr.ok) {
    base.signalsMarked = await mark(unused);
    return { ...base, status: "failed", reason, errorDetail: { stage: "push", detail: pr.detail }, httpStatus: 502, error: "Push failed" };
  }
  counters.pushed = Number(pr.body.pushed ?? 0);
  counters.skipped_duplicate += Number(pr.body.tally?.skipped_duplicate ?? 0) + Number(pr.body.tally?.skipped_opted_out ?? 0);
  counters.failed += Number(pr.body.tally?.failed ?? 0);

  // ---- 6. record ------------------------------------------------------------
  const perSignal = new Map<string, { pushed: number; failed: number; other: number }>();
  for (const res of (pr.body.results ?? []) as Array<{ email: string | null; outcome: string }>) {
    const sid = signalOfEmail.get(normalizeEmailKey(res.email) ?? "");
    if (!sid) continue;
    const c = perSignal.get(sid) ?? { pushed: 0, failed: 0, other: 0 };
    if (res.outcome === "pushed") c.pushed++;
    else if (res.outcome === "failed" || res.outcome === "skipped_cap") c.failed++;
    else c.other++;
    perSignal.set(sid, c);
  }
  const rows = [...unused];
  for (const t of plan) {
    const c = perSignal.get(t.signal.id) ?? { pushed: 0, failed: 0, other: 0 };
    if (c.pushed > 0) rows.push({ signal_id: t.signal.id, outcome: "pushed", people_found: t.found, people_pushed: c.pushed });
    else if (c.failed === 0 && c.other > 0) rows.push({ signal_id: t.signal.id, outcome: "all_duplicates", people_found: t.found, people_pushed: 0 });
    // failed / capped: not recorded, retried next run
  }
  base.signalsMarked = await mark(rows);

  const status: Status = reason ? "partial" : counters.failed > 0 ? (counters.pushed > 0 ? "partial" : "failed") : "success";
  return {
    ...base, status, reason,
    errorDetail: reason ? { stage: "enrich", reason } : counters.failed > 0 ? { stage: "push", tally: pr.body.tally } : null,
    httpStatus: 200, results: pr.body.results,
  };
}
