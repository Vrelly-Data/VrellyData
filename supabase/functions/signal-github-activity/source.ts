// product_launch (market: saas) — new GitHub repositories and releases.
//
// config.orgs:            [{ login, company_name?, company_domain? }] (or plain login strings)
// config.search_queries:  GitHub repo-search queries, e.g. "topic:llm stars:>20"
//                         ("created:>=<since>" is appended automatically)
// config.lookback_days:   window for "new" (default 2; the run is daily)
// Uses the GITHUB_TOKEN secret when set (5000 req/h), else unauthenticated
// (60 req/h: ~2 calls per watched org + 1 per query + events pages).
// Shapes verified live 2026-10-09:
//   GET /orgs/{org}                          { login, name, blog, location, html_url }
//   GET /orgs/{org}/repos?sort=created       [{ id, full_name, html_url, description, created_at, stargazers_count, language, topics, fork }]
//   GET /orgs/{org}/events                   [{ type: 'ReleaseEvent', created_at, repo: { id, name },
//                                               payload: { action, release: { id, tag_name, name, html_url, published_at, prerelease, draft } } }]
//   GET /search/repositories?q=...           { total_count, items: [repo with owner: { login, type }] }
// Dedupe: gh:<repo id>:<new_repo|release>:<YYYY-MM-DD>.

import { clampScore, collapseSpaces, dedupeKey, type FetchResult, normalizeDomain, type SignalInput, type SourceContext, toIso } from "../_shared/signals.ts";
import { assignMarkets } from "../_shared/signal-markets.ts";

export const GITHUB_API = "https://api.github.com";

export interface OrgEntry {
  login: string;
  company_name?: string | null;
  company_domain?: string | null;
}

export interface OrgInfo {
  login: string;
  name?: string | null;
  blog?: string | null;
  location?: string | null;
}

export interface Repo {
  id: number;
  full_name: string;
  html_url: string;
  description?: string | null;
  created_at: string;
  pushed_at?: string | null;
  stargazers_count?: number;
  language?: string | null;
  topics?: string[];
  fork?: boolean;
  owner?: { login: string; type?: string };
}

export interface ReleaseEvent {
  type: string;
  created_at: string;
  repo: { id: number; name: string };
  payload?: { action?: string; release?: { id: number; tag_name?: string; name?: string | null; html_url?: string; published_at?: string | null; prerelease?: boolean; draft?: boolean } };
}

const day = (iso: string) => iso.slice(0, 10);

function recency(iso: string, now: number): number {
  const d = (now - Date.parse(iso)) / 86_400_000;
  return d <= 1 ? 20 : d <= 3 ? 10 : 0;
}

export function companyFor(entry: OrgEntry | null, org: OrgInfo | null, ownerLogin: string | null, ownerIsOrg: boolean) {
  return {
    company_name: collapseSpaces(entry?.company_name) ?? collapseSpaces(org?.name) ?? (ownerIsOrg ? ownerLogin : null),
    company_domain: normalizeDomain(entry?.company_domain) ?? normalizeDomain(org?.blog),
  };
}

export function mapNewRepo(repo: Repo, ctx: { entry: OrgEntry | null; org: OrgInfo | null; via: string; now: number }): SignalInput | null {
  const created = toIso(repo.created_at);
  if (!repo?.id || !created) return null;
  const ownerLogin = repo.owner?.login ?? repo.full_name.split("/")[0] ?? null;
  const ownerIsOrg = ctx.entry !== null || repo.owner?.type === "Organization";
  const co = companyFor(ctx.entry, ctx.org, ownerLogin, ownerIsOrg);
  const stars = Number(repo.stargazers_count ?? 0);
  return {
    signal_type: "product_launch",
    markets: assignMarkets({ signal_type: "product_launch" }),
    occurred_at: created,
    dedupe_key: dedupeKey("gh", repo.id, "new_repo", day(created)),
    title: `New repo ${repo.full_name}${repo.description ? ` — ${collapseSpaces(repo.description)}` : ""}`.slice(0, 500),
    url: repo.html_url,
    score: clampScore(40 + Math.min(stars, 100) / 5 + recency(created, ctx.now) + (ctx.entry ? 10 : 0)),
    ...co,
    payload: {
      event: "new_repo", repo_id: repo.id, repo: repo.full_name, description: collapseSpaces(repo.description),
      stars, language: repo.language ?? null, topics: repo.topics ?? [], fork: repo.fork ?? false,
      owner: ownerLogin, owner_type: repo.owner?.type ?? (ctx.entry ? "Organization" : null),
      org_location: ctx.org?.location ?? null, via: ctx.via,
    },
  };
}

export function mapRelease(ev: ReleaseEvent, ctx: { entry: OrgEntry; org: OrgInfo | null; now: number }): SignalInput | null {
  const rel = ev.payload?.release;
  if (ev.type !== "ReleaseEvent" || !rel || rel.draft) return null;
  const at = toIso(rel.published_at ?? ev.created_at);
  if (!at || !ev.repo?.id) return null;
  const co = companyFor(ctx.entry, ctx.org, ctx.entry.login, true);
  const label = collapseSpaces(rel.name) ?? rel.tag_name ?? "release";
  return {
    signal_type: "product_launch",
    markets: assignMarkets({ signal_type: "product_launch" }),
    occurred_at: at,
    dedupe_key: dedupeKey("gh", ev.repo.id, "release", day(at)),
    title: `${ev.repo.name} released ${label}`.slice(0, 500),
    url: rel.html_url ?? `https://github.com/${ev.repo.name}/releases`,
    score: clampScore(50 + recency(at, ctx.now) + 10 - (rel.prerelease ? 15 : 0)),
    ...co,
    payload: {
      event: "release", repo_id: ev.repo.id, repo: ev.repo.name, tag: rel.tag_name ?? null, release_name: rel.name ?? null,
      prerelease: rel.prerelease ?? false, owner: ctx.entry.login, org_location: ctx.org?.location ?? null, via: "org",
    },
  };
}

export function readOrgs(config: Record<string, unknown>): OrgEntry[] {
  const raw = Array.isArray(config.orgs) ? config.orgs : [];
  return raw
    .map((o) => (typeof o === "string" ? { login: o } : o as OrgEntry))
    .filter((o) => o && typeof o.login === "string" && /^[A-Za-z0-9-]{1,39}$/.test(o.login.trim()))
    .map((o) => ({ ...o, login: o.login.trim() }));
}

export async function fetchGithubActivity(ctx: SourceContext): Promise<FetchResult> {
  const token = Deno.env.get("GITHUB_TOKEN") ?? "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "vrelly-signals",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const lookbackMs = Number(ctx.config.lookback_days ?? 2) * 86_400_000;
  const sinceMs = ctx.now - lookbackMs;
  const sinceDay = new Date(sinceMs).toISOString().slice(0, 10);
  const maxSearch = Math.min(Number(ctx.config.max_search_results ?? 50), 100);
  const orgs = readOrgs(ctx.config);
  const queries = (Array.isArray(ctx.config.search_queries) ? ctx.config.search_queries : []).filter((q): q is string => typeof q === "string" && !!q.trim());

  const signals: SignalInput[] = [];
  const errors: string[] = [];
  let fetched = 0, calls = 0, rateRemaining: string | null = null;
  const get = async (path: string) => {
    calls++;
    const res = await ctx.fetchFn(`${GITHUB_API}${path}`, { headers, signal: AbortSignal.timeout(30_000) });
    rateRemaining = res.headers.get("x-ratelimit-remaining") ?? rateRemaining;
    if (!res.ok) throw new Error(`GET ${path.split("?")[0]} HTTP ${res.status}`);
    return res.json();
  };

  for (const entry of orgs) {
    let org: OrgInfo | null = null;
    try {
      org = await get(`/orgs/${encodeURIComponent(entry.login)}`);
      const repos = (await get(`/orgs/${encodeURIComponent(entry.login)}/repos?sort=created&direction=desc&per_page=30`)) as Repo[];
      fetched += repos.length;
      for (const r of repos) {
        if (Date.parse(r.created_at) < sinceMs) continue;
        const s = mapNewRepo(r, { entry, org, via: "org", now: ctx.now });
        if (s) signals.push(s);
      }
      for (let page = 1; page <= 3; page++) {
        const events = (await get(`/orgs/${encodeURIComponent(entry.login)}/events?per_page=100&page=${page}`)) as ReleaseEvent[];
        fetched += events.length;
        for (const ev of events) {
          if (Date.parse(ev.created_at) < sinceMs) continue;
          const s = mapRelease(ev, { entry, org, now: ctx.now });
          if (s) signals.push(s);
        }
        if (events.length < 100 || Date.parse(events[events.length - 1].created_at) < sinceMs) break;
      }
    } catch (e) {
      errors.push(`${entry.login}: ${e instanceof Error ? e.message : e}`);
    }
  }

  for (const q of queries) {
    try {
      const qs = encodeURIComponent(`${q.trim()} created:>=${sinceDay}`);
      const body = await get(`/search/repositories?q=${qs}&sort=stars&order=desc&per_page=${maxSearch}`);
      const items = (body?.items ?? []) as Repo[];
      fetched += items.length;
      for (const r of items) {
        const s = mapNewRepo(r, { entry: null, org: null, via: `search:${q.trim()}`, now: ctx.now });
        if (s) signals.push(s);
      }
    } catch (e) {
      errors.push(`search "${q}": ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    signals, fetched,
    error: errors.length ? errors.join("; ").slice(0, 1000) : null,
    detail: { orgs: orgs.length, queries: queries.length, calls, authenticated: !!token, rate_remaining: rateRemaining, since: sinceDay },
  };
}
