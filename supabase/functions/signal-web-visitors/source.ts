// web_visitors / site_visit — FOUNDATION: rolls raw pixel hits into one signal
// per visitor (anon_id) per site per UTC day, with the pages they viewed.
//
// Hits arrive through the public 'track' function (signal_pixel_hits). This
// source re-rolls the last config.rollup_days days each run; the dedupe key is
// stable per visitor-day, so a growing visit updates its signal instead of
// adding one. visibility 'team': only the site owner's team can read it.
// No IP (raw or hashed) ever reaches a signal.

import { clampScore, dedupeKey, type FetchResult, normalizeDomain, type SignalInput, type SourceContext, toIso } from "../_shared/signals.ts";

export interface VisitDay {
  site_key: string;
  team_id: string;
  domain: string;
  anon_id: string;
  day: string;
  first_ts: string;
  last_ts: string;
  pages: number;
  urls: string[] | null;
  referrer: string | null;
  user_agent: string | null;
  resolved: Record<string, unknown> | null;
}

const HIGH_INTENT_PATH = /\/(pricing|plans|demo|book|contact|get-started|signup|sign-up|trial|quote)(\/|$|\?|#)/i;

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url;
  }
}

export function scoreVisit(v: VisitDay): number {
  const urls = v.urls ?? [];
  let s = 20 + Math.min(Math.max(v.pages - 1, 0), 5) * 8;
  if (urls.some((u) => HIGH_INTENT_PATH.test(pathOf(u)))) s += 25;
  if (v.resolved?.company_domain || v.resolved?.company_name) s += 15;
  return clampScore(s);
}

export function mapVisitDay(v: VisitDay): SignalInput | null {
  const at = toIso(v.last_ts);
  if (!v.anon_id || !v.team_id || !at) return null;
  const r = (v.resolved ?? {}) as Record<string, string | null | undefined>;
  const who = r.company_name ?? "Anonymous visitor";
  const paths = [...new Set((v.urls ?? []).map(pathOf))];
  return {
    signal_type: "site_visit",
    occurred_at: at,
    dedupe_key: dedupeKey("visit", v.site_key, v.anon_id, v.day),
    title: `${who} viewed ${v.pages} page${v.pages === 1 ? "" : "s"} on ${v.domain}`,
    url: (v.urls ?? [])[0] ?? `https://${v.domain}/`,
    score: scoreVisit(v),
    visibility: "team",
    team_id: v.team_id,
    company_name: r.company_name ?? null,
    company_domain: normalizeDomain(r.company_domain),
    person_name: r.person_name ?? null,
    person_title: r.person_title ?? null,
    person_email: r.person_email ?? null,
    person_linkedin: r.person_linkedin ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    country: r.country ?? null,
    payload: {
      site_key: v.site_key, domain: v.domain, day: v.day, pages_viewed: v.pages, paths,
      first_seen: toIso(v.first_ts), last_seen: at, referrer: v.referrer, user_agent: v.user_agent,
      identified: !!v.resolved, resolver: r.provider ?? null,
    },
  };
}

export async function fetchWebVisitors(ctx: SourceContext): Promise<FetchResult> {
  const days = Number(ctx.config.rollup_days ?? 2);
  const since = new Date(ctx.now - days * 86_400_000).toISOString();
  const { data, error } = await ctx.supabase.rpc("signals_pixel_visits", { p_since: since });
  if (error) return { signals: [], fetched: 0, error: `signals_pixel_visits: ${error.message}`, detail: { since } };
  const rows = (data ?? []) as VisitDay[];
  const signals = rows.map(mapVisitDay).filter((s): s is SignalInput => s !== null);
  return { signals, fetched: rows.length, detail: { since, visitor_days: rows.length } };
}
