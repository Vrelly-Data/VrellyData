// saas_hiring / job_posted — new postings on watched job boards.
//
// config.boards: [{ ats: 'greenhouse'|'lever'|'ashby', token, company_name?, company_domain? }]
// (starts empty; admins add companies in Admin → Inference Insights → Signals).
// Public board APIs, shapes verified live 2026-10-09:
//   Greenhouse boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
//     { jobs: [{ id, title, absolute_url, first_published, updated_at, company_name,
//                location: { name }, departments: [{ name }], offices: [...] }] }
//   Lever api.lever.co/v0/postings/{company}?mode=json
//     [{ id, text, hostedUrl, createdAt (ms), categories: { team, department?, location, commitment }, workplaceType }]
//   Ashby api.ashbyhq.com/posting-api/job-board/{name}
//     { jobs: [{ id, title, jobUrl, publishedAt, department, team, location, isListed,
//                address: { postalAddress: { addressLocality, addressRegion, addressCountry } } }] }
// One signal per posting (dedupe job:<ats>:<board>:<id>), only postings
// published within max_age_days, so adding a big board doesn't flood the feed.
// config.role_keywords (whole words, case-insensitive) raise the score.

import { clampScore, collapseSpaces, dedupeKey, type FetchResult, normalizeDomain, type SignalInput, type SourceContext, toIso } from "../_shared/signals.ts";

export type Ats = "greenhouse" | "lever" | "ashby";

export interface Board {
  ats: Ats;
  token: string;
  company_name?: string | null;
  company_domain?: string | null;
}

export interface Posting {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  url: string | null;
  published_at: string | null;
  company_name: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  extra?: Record<string, unknown>;
}

export const DEFAULT_ROLE_KEYWORDS = ["SDR", "BDR", "Account Executive", "Head of Sales", "RevOps"];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Role keywords that appear as whole words (case-insensitive) in the title. */
export function matchedKeywords(title: string, keywords: string[]): string[] {
  return keywords.filter((k) => k.trim() && new RegExp(`(^|[^a-z0-9])${esc(k.trim())}($|[^a-z0-9])`, "i").test(title));
}

export function scorePosting(p: Posting, keywords: string[], now: number): number {
  let s = 30;
  if (matchedKeywords(p.title, keywords).length) s += 40;
  if (/\b(sales|revenue|go[- ]to[- ]market|gtm|business development)\b/i.test(p.department ?? "")) s += 10;
  const at = p.published_at ? Date.parse(p.published_at) : NaN;
  const days = Number.isFinite(at) ? (now - at) / 86_400_000 : Infinity;
  if (days <= 7) s += 20;
  else if (days <= 30) s += 10;
  return clampScore(s);
}

// ------------------------------------------------------------- mappers ---

// deno-lint-ignore no-explicit-any
export function fromGreenhouse(j: any): Posting | null {
  if (j?.id === undefined || !j?.title) return null;
  return {
    id: String(j.id),
    title: collapseSpaces(j.title)!,
    department: collapseSpaces(j.departments?.[0]?.name) ?? null,
    location: collapseSpaces(j.location?.name) ?? null,
    url: j.absolute_url ?? null,
    published_at: toIso(j.first_published ?? j.updated_at),
    company_name: collapseSpaces(j.company_name),
    extra: { requisition_id: j.requisition_id ?? null, offices: (j.offices ?? []).map((o: { name?: string }) => o?.name).filter(Boolean) },
  };
}

// deno-lint-ignore no-explicit-any
export function fromLever(j: any): Posting | null {
  if (!j?.id || !j?.text) return null;
  return {
    id: String(j.id),
    title: collapseSpaces(j.text)!,
    department: collapseSpaces(j.categories?.department ?? j.categories?.team) ?? null,
    location: collapseSpaces(j.categories?.location) ?? null,
    url: j.hostedUrl ?? null,
    published_at: toIso(typeof j.createdAt === "number" ? j.createdAt : null),
    company_name: null,
    country: collapseSpaces(j.country),
    extra: { team: j.categories?.team ?? null, commitment: j.categories?.commitment ?? null, workplace_type: j.workplaceType ?? null },
  };
}

// deno-lint-ignore no-explicit-any
export function fromAshby(j: any): Posting | null {
  if (!j?.id || !j?.title || j?.isListed === false) return null;
  const pa = j.address?.postalAddress ?? {};
  return {
    id: String(j.id),
    title: collapseSpaces(j.title)!,
    department: collapseSpaces(j.department) ?? null,
    location: collapseSpaces(j.location) ?? null,
    url: j.jobUrl ?? null,
    published_at: toIso(j.publishedAt),
    company_name: null,
    city: collapseSpaces(pa.addressLocality),
    state: collapseSpaces(pa.addressRegion),
    country: collapseSpaces(pa.addressCountry),
    extra: { team: j.team ?? null, employment_type: j.employmentType ?? null, workplace_type: j.workplaceType ?? null, is_remote: j.isRemote ?? null },
  };
}

export function mapPosting(board: Board, p: Posting, keywords: string[], now = Date.now()): SignalInput | null {
  if (!p.published_at) return null;
  const company = collapseSpaces(board.company_name) ?? p.company_name ?? board.token;
  const matched = matchedKeywords(p.title, keywords);
  return {
    signal_type: "job_posted",
    occurred_at: p.published_at,
    dedupe_key: dedupeKey("job", board.ats, board.token, p.id),
    title: `${company} is hiring: ${p.title}${p.location ? ` (${p.location})` : ""}`.slice(0, 500),
    url: p.url,
    score: scorePosting(p, keywords, now),
    company_name: company,
    company_domain: normalizeDomain(board.company_domain),
    city: p.city ?? null,
    state: p.state ?? null,
    country: p.country ?? null,
    payload: {
      ats: board.ats, board: board.token, job_id: p.id, job_title: p.title,
      department: p.department, location: p.location, matched_keywords: matched, ...(p.extra ?? {}),
    },
  };
}

export function boardUrl(b: Board): string {
  const t = encodeURIComponent(b.token);
  switch (b.ats) {
    case "greenhouse": return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`;
    case "lever": return `https://api.lever.co/v0/postings/${t}?mode=json`;
    case "ashby": return `https://api.ashbyhq.com/posting-api/job-board/${t}`;
  }
}

// deno-lint-ignore no-explicit-any
export function parseBoard(ats: Ats, body: any): Posting[] {
  const list = ats === "lever" ? (Array.isArray(body) ? body : []) : (body?.jobs ?? []);
  const fn = ats === "greenhouse" ? fromGreenhouse : ats === "lever" ? fromLever : fromAshby;
  return list.map(fn).filter((p: Posting | null): p is Posting => p !== null);
}

export function readBoards(config: Record<string, unknown>): Board[] {
  const raw = Array.isArray(config.boards) ? config.boards : [];
  return raw
    .filter((b): b is Board => !!b && typeof b === "object" && ["greenhouse", "lever", "ashby"].includes((b as Board).ats) && !!(b as Board).token)
    .map((b) => ({ ...b, token: String(b.token).trim() }));
}

export async function fetchSaasHiring(ctx: SourceContext): Promise<FetchResult> {
  const boards = readBoards(ctx.config);
  const keywords = Array.isArray(ctx.config.role_keywords) ? (ctx.config.role_keywords as string[]) : DEFAULT_ROLE_KEYWORDS;
  const maxAgeMs = Number(ctx.config.max_age_days ?? 30) * 86_400_000;
  const signals: SignalInput[] = [];
  const perBoard: Record<string, unknown>[] = [];
  const errors: string[] = [];
  let fetched = 0;
  for (const b of boards) {
    const label = `${b.ats}:${b.token}`;
    try {
      const res = await ctx.fetchFn(boardUrl(b), { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        errors.push(`${label} HTTP ${res.status}`);
        perBoard.push({ board: label, status: res.status });
        continue;
      }
      const postings = parseBoard(b.ats, await res.json());
      fetched += postings.length;
      let kept = 0;
      for (const p of postings) {
        if (!p.published_at || ctx.now - Date.parse(p.published_at) > maxAgeMs) continue;
        const s = mapPosting(b, p, keywords, ctx.now);
        if (s) { signals.push(s); kept++; }
      }
      perBoard.push({ board: label, postings: postings.length, recent: kept });
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : e}`);
      perBoard.push({ board: label, error: true });
    }
  }
  return {
    signals, fetched,
    error: errors.length ? errors.join("; ").slice(0, 1000) : null,
    detail: { boards: perBoard, watchlist_size: boards.length },
  };
}
