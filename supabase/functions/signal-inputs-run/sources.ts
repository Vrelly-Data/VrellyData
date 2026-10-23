// Signal Inputs: one adapter per writer source. Each takes ONE input and
// returns the signals it found (or, in preview, just the count and a sample).
// Pure apart from ctx.fetchFn, so the request shapes and mappers are tested.
//
//   input_hiring           Apollo organization search (job title / job location /
//                          posted-at filters), then each company's job postings to
//                          confirm a posting matches title + location + date
//   input_github           GitHub repository search
//   input_fda_clearance    openFDA 510(k) (incl. De Novo = decision_code DENG),
//                          PMA originals, FDA Breakthrough authorizations (fda.gov table)
//   input_fda_recall       openFDA device recalls (event_date_posted)
//   input_fda_registration openFDA registrations & listings (products.created_date)
//   input_clinical_trial   ClinicalTrials.gov v2: interventional, device, first posted

import { clampScore, collapseSpaces, dedupeKey, normalizeDomain, type SignalInput, toIso } from "../_shared/signals.ts";
import { assignMarkets } from "../_shared/signal-markets.ts";
import { APOLLO_BASE, apolloHeaders } from "../_shared/apollo.ts";
import type { GithubFilters, HiringFilters, HiringLocation, InputFamily, MedicalFilters, MedicalSource } from "./filters.ts";
import { MEDICAL_WRITER } from "./filters.ts";

export interface InputRow {
  id: string;
  team_id: string;
  source_key: InputFamily;
  name: string;
  all_clients: boolean;
}

export interface AdapterCtx {
  fetchFn: typeof fetch;
  now: number;
  preview: boolean;
  /** Writer source config (signal_sources.config). */
  config: Record<string, unknown>;
  apolloKey?: string | null;
  githubToken?: string | null;
  /** Apollo credits this call may still spend. */
  apolloCreditsLeft: number;
}

export interface SampleRow { title: string; company: string | null; occurred_at: string | null; url: string | null; detail?: string | null }

export interface AdapterResult {
  signals: SignalInput[];
  /** Upstream records looked at. */
  fetched: number;
  /** Upstream total for the query (what a preview shows). */
  total: number;
  credits: number;
  sample: SampleRow[];
  error?: string | null;
  detail?: Record<string, unknown>;
}

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const empty = (): AdapterResult => ({ signals: [], fetched: 0, total: 0, credits: 0, sample: [] });

function base(input: InputRow, s: Omit<SignalInput, "visibility" | "team_id">): SignalInput {
  return {
    ...s,
    payload: { ...(s.payload ?? {}), input_id: input.id, input_name: input.name },
    visibility: input.all_clients ? "all_clients" : "team",
    team_id: input.team_id,
  };
}
const toSample = (s: SignalInput, detail?: string | null): SampleRow => ({
  title: s.title, company: s.company_name ?? null, occurred_at: s.occurred_at, url: s.url ?? null, detail: detail ?? null,
});

async function getJson(ctx: AdapterCtx, url: string, init: RequestInit = {}, timeoutMs = 30_000) {
  const res = await ctx.fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: res.status, ok: res.ok, body: body as Record<string, unknown> | null, text: text.slice(0, 300) };
}

// ================================================================== hiring ===

const US_STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut",
  DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois",
  IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york",
  NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah",
  VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};
const COUNTRY_ALIASES: Record<string, string> = { us: "united states", usa: "united states", "u.s.": "united states", uk: "united kingdom", gb: "united kingdom" };
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normState = (s: unknown) => {
  const n = norm(s);
  return US_STATES[n.toUpperCase()] ?? n;
};
const normCountry = (s: unknown) => COUNTRY_ALIASES[norm(s)] ?? norm(s);

/** Apollo organization_job_locations values: "san francisco, california", "california", "germany". */
export function apolloJobLocations(locs: HiringLocation[]): string[] {
  const out = new Set<string>();
  for (const l of locs) {
    const state = l.state ? normState(l.state) : null;
    const country = l.country ? normCountry(l.country) : null;
    if (l.city) out.add([norm(l.city), state ?? country].filter(Boolean).join(", "));
    else if (state) out.add(state);
    else if (country) out.add(country);
  }
  return [...out];
}

const TITLE_SYNONYMS: Record<string, string[]> = {
  ceo: ["chief executive officer"], cmo: ["chief marketing officer"], cto: ["chief technology officer"],
  cfo: ["chief financial officer"], coo: ["chief operating officer"], cro: ["chief revenue officer"],
  cio: ["chief information officer"], cso: ["chief sales officer", "chief strategy officer"],
  chro: ["chief human resources officer", "chief people officer"], cpo: ["chief product officer"],
  vp: ["vice president"], svp: ["senior vice president"], evp: ["executive vice president"],
};
function titleForms(t: string): string[] {
  const n = norm(t);
  const forms = new Set([n]);
  for (const [abbr, longs] of Object.entries(TITLE_SYNONYMS)) {
    const re = new RegExp(`\\b${abbr}\\b`);
    if (re.test(n)) for (const l of longs) forms.add(n.replace(re, l));
    for (const l of longs) if (n.includes(l)) forms.add(n.replace(l, abbr));
  }
  return [...forms];
}
export function titleMatches(postingTitle: string, wanted: string[]): boolean {
  const p = ` ${norm(postingTitle)} `;
  return wanted.some((w) => titleForms(w).some((f) => f && p.includes(` ${f} `)));
}
export function locationMatches(p: { city?: unknown; state?: unknown; country?: unknown }, wanted: HiringLocation[]): boolean {
  if (!wanted.length) return true;
  const pc = norm(p.city), ps = normState(p.state), pn = normCountry(p.country);
  return wanted.some((w) =>
    (!w.city || norm(w.city) === pc) &&
    (!w.state || normState(w.state) === ps) &&
    (!w.country || normCountry(w.country) === pn || (normCountry(w.country) === "united states" && !!US_STATES[(String(p.state ?? "")).toUpperCase()]))
  );
}

interface ApolloPosting { id?: string; title?: string; url?: string; city?: string; state?: string; country?: string; posted_at?: string; last_seen_at?: string }
interface ApolloOrg {
  id?: string; organization_id?: string; name?: string; primary_domain?: string; website_url?: string; linkedin_url?: string;
  industry?: string; estimated_num_employees?: number; city?: string; state?: string; country?: string;
}

export function apolloSearchBody(f: HiringFilters, now: number, perPage: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    q_organization_job_titles: f.job_titles,
    organization_job_posted_at_range: { min: ymd(now - f.posted_within_days * DAY) },
    page: 1,
    per_page: perPage,
  };
  const locs = apolloJobLocations(f.locations);
  if (locs.length) body.organization_job_locations = locs;
  if (f.company_sizes.length) body.organization_num_employees_ranges = f.company_sizes;
  if (f.industries.length) body.q_organization_keyword_tags = f.industries;
  return body;
}

const sizeBucket = (n: unknown): string | null => {
  const e = Number(n);
  if (!Number.isFinite(e) || e <= 0) return null;
  for (const [lo, hi, label] of [[1, 10, "1-10"], [11, 50, "11-50"], [51, 200, "51-200"], [201, 500, "201-500"],
    [501, 1000, "501-1000"], [1001, 5000, "1001-5000"], [5001, 10000, "5001-10000"]] as const) {
    if (e >= lo && e <= hi) return label;
  }
  return "10001+";
};

export async function runHiring(input: InputRow, f: HiringFilters, ctx: AdapterCtx): Promise<AdapterResult> {
  const out = empty();
  if (!ctx.apolloKey) return { ...out, error: "APOLLO_API_KEY is not set" };
  if (ctx.apolloCreditsLeft < 1) return { ...out, error: "Apollo credit cap for Signal Inputs reached today" };
  const perPage = ctx.preview ? 5 : Math.min(100, Number(ctx.config.apollo_per_page ?? 100));
  const r = await getJson(ctx, `${APOLLO_BASE}/mixed_companies/search`, {
    method: "POST", headers: apolloHeaders(ctx.apolloKey), body: JSON.stringify(apolloSearchBody(f, ctx.now, perPage)),
  });
  out.credits += 1;
  if (!r.ok) return { ...out, error: `Apollo organization search HTTP ${r.status}: ${r.text}` };
  const pag = (r.body?.pagination ?? {}) as Record<string, unknown>;
  out.total = Number(pag.total_entries ?? 0);
  const seen = new Set<string>();
  const orgs: ApolloOrg[] = [];
  for (const o of [...((r.body?.organizations ?? []) as ApolloOrg[]), ...((r.body?.accounts ?? []) as ApolloOrg[])]) {
    const id = String(o.organization_id ?? o.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orgs.push({ ...o, id });
  }
  out.fetched = orgs.length;

  const lookups = ctx.preview ? 0 : Math.max(0, Math.min(Number(ctx.config.apollo_max_postings_lookups ?? 10), ctx.apolloCreditsLeft - 1, orgs.length));
  const cutoff = ctx.now - f.posted_within_days * DAY;
  let verified = 0, unmatched = 0;
  for (const [i, o] of orgs.entries()) {
    const domain = normalizeDomain(o.primary_domain ?? o.website_url ?? null);
    const company = collapseSpaces(o.name);
    let posting: ApolloPosting | null = null;
    if (i < lookups) {
      const p = await getJson(ctx, `${APOLLO_BASE}/organizations/${encodeURIComponent(o.id!)}/job_postings?page=1&per_page=100`, {
        headers: apolloHeaders(ctx.apolloKey),
      });
      out.credits += 1;
      if (!p.ok) {
        out.error = `Apollo job postings HTTP ${p.status}: ${p.text}`;
        break;
      }
      const postings = ((p.body?.organization_job_postings ?? p.body?.job_postings ?? []) as ApolloPosting[]);
      posting = postings
        .filter((x) => titleMatches(x.title ?? "", f.job_titles) && locationMatches(x, f.locations) &&
          Date.parse(x.posted_at ?? x.last_seen_at ?? "") >= cutoff)
        .sort((a, b) => Date.parse(b.posted_at ?? "") - Date.parse(a.posted_at ?? ""))[0] ?? null;
      if (!posting) {
        unmatched++;
        continue; // Apollo matched the company, but no single posting matches title + location + date
      }
      verified++;
    }
    const where = posting ? [posting.city, posting.state, posting.country].filter(Boolean).join(", ") : null;
    const role = posting?.title ?? f.job_titles.join(" / ");
    const s = base(input, {
      signal_type: "hiring",
      markets: assignMarkets({ signal_type: "hiring", industry: o.industry ?? null }),
      occurred_at: toIso(posting?.posted_at) ?? new Date(ctx.now).toISOString(),
      dedupe_key: dedupeKey(`in:${input.id}:apollo-org`, o.id),
      title: `${company ?? "A company"} is hiring: ${role}${where ? ` (${where})` : ""}`.slice(0, 500),
      url: posting?.url ?? (domain ? `https://${domain}` : null),
      score: clampScore(posting ? 70 : 50),
      company_name: company,
      company_domain: domain,
      city: collapseSpaces(posting?.city ?? null),
      state: collapseSpaces(posting?.state ?? null),
      country: collapseSpaces(posting?.country ?? null),
      industry: collapseSpaces(o.industry ?? null),
      company_size: sizeBucket(o.estimated_num_employees),
      payload: {
        source: "apollo",
        verified: !!posting,
        job_title: posting?.title ?? null,
        job_location: where,
        posted_at: posting?.posted_at ?? null,
        searched_titles: f.job_titles,
        company_linkedin: o.linkedin_url ?? null,
      },
    });
    out.signals.push(s);
  }
  out.sample = (ctx.preview ? orgs.slice(0, 5).map((o) => ({
    title: `${collapseSpaces(o.name) ?? "A company"} is hiring: ${f.job_titles.join(" / ")}`, company: collapseSpaces(o.name),
    occurred_at: null, url: normalizeDomain(o.primary_domain ?? null) ? `https://${normalizeDomain(o.primary_domain ?? null)}` : null,
    detail: [o.industry, sizeBucket(o.estimated_num_employees)].filter(Boolean).join(" · ") || null,
  })) : out.signals.slice(0, 5).map((s) => toSample(s)));
  out.detail = { apollo_total: out.total, companies: orgs.length, postings_lookups: Math.min(lookups, orgs.length), verified, unmatched };
  return out;
}

// ================================================================== github ===

export function githubQueries(f: GithubFilters, now: number): string[] {
  const parts: string[] = [];
  if (f.keywords.length) parts.push(f.keywords.map((k) => (/\s/.test(k) ? `"${k}"` : k)).join(" OR "));
  for (const o of f.orgs) parts.push(`org:${o}`);
  if (f.min_stars > 0) parts.push(`stars:>=${f.min_stars}`);
  parts.push(`${f.activity}:>=${ymd(now - f.within_days * DAY)}`);
  parts.push("fork:false", "archived:false");
  const q = parts.join(" ");
  return f.topics.length ? f.topics.map((t) => `${q} topic:${t}`) : [q];
}

interface GhRepo {
  id?: number; full_name?: string; html_url?: string; description?: string | null; stargazers_count?: number;
  language?: string | null; topics?: string[]; created_at?: string; pushed_at?: string; homepage?: string | null;
  owner?: { login?: string; type?: string };
}

export async function runGithub(input: InputRow, f: GithubFilters, ctx: AdapterCtx): Promise<AdapterResult> {
  const out = empty();
  const perPage = ctx.preview ? 5 : Math.min(100, Number(ctx.config.max_results ?? 50));
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "vrelly-signals", "X-GitHub-Api-Version": "2022-11-28" };
  if (ctx.githubToken) headers.Authorization = `Bearer ${ctx.githubToken}`;
  // Repository search has no owner-type qualifier, so "organizations only" is
  // filtered here. Org repos are a few percent of results and rarely starred
  // (2026-10-23: 9 of the top 300 for "clinical trial", all 0 stars), so for
  // that filter we page through up to 3 pages of 100 (5 with a token;
  // unauthenticated search allows 10 requests a minute) and report the org
  // repos found as the total, not GitHub's count of every repo. A preview
  // counts across all those pages and returns 5.
  const orgOnly = f.owner === "org";
  const pageSize = orgOnly ? 100 : perPage;
  const maxPages = orgOnly ? (ctx.githubToken ? 5 : 3) : 1;
  const keepMax = orgOnly && ctx.preview ? Infinity : perPage;
  const seen = new Set<number>();
  let scanned = 0, githubTotal = 0;
  queries: for (const q of githubQueries(f, ctx.now)) {
    let kept = 0;
    for (let page = 1; page <= maxPages && kept < keepMax; page++) {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${pageSize}&page=${page}`;
      const r = await getJson(ctx, url, { headers });
      if (!r.ok) {
        out.error = `GitHub search HTTP ${r.status}${r.status === 403 || r.status === 429 ? " (rate limited — set GITHUB_TOKEN)" : ""}: ${r.text}`;
        break queries;
      }
      const items = (r.body?.items ?? []) as GhRepo[];
      if (page === 1) githubTotal += Number(r.body?.total_count ?? 0);
      scanned += items.length;
      for (const repo of items) {
        if (kept >= keepMax) break;
        if (!repo.id || seen.has(repo.id)) continue;
        seen.add(repo.id);
        out.fetched++;
        const at = toIso(f.activity === "pushed" ? repo.pushed_at : repo.created_at);
        if (!at || !repo.full_name) continue;
        if (orgOnly && repo.owner?.type !== "Organization") continue;
        kept++;
        const stars = Number(repo.stargazers_count ?? 0);
        const isOrg = repo.owner?.type === "Organization";
        out.signals.push(base(input, {
          signal_type: "product_launch",
          markets: ["saas"],
          occurred_at: at,
          dedupe_key: dedupeKey(`in:${input.id}:gh`, repo.id),
          title: `${f.activity === "pushed" ? "Active" : "New"} GitHub repo: ${repo.full_name}${repo.description ? ` — ${collapseSpaces(repo.description)}` : ""}`.slice(0, 500),
          url: repo.html_url ?? null,
          score: clampScore(40 + Math.round(Math.log10(stars + 1) * 15)),
          company_name: isOrg ? repo.owner?.login ?? null : null,
          company_domain: normalizeDomain(repo.homepage ?? null),
          payload: {
            repo: repo.full_name, stars, language: repo.language ?? null, topics: repo.topics ?? [],
            description: collapseSpaces(repo.description ?? null), owner_type: repo.owner?.type ?? null,
            created_at: repo.created_at ?? null, pushed_at: repo.pushed_at ?? null,
          },
        }));
      }
      if (items.length < pageSize) break;
    }
  }
  out.total = orgOnly ? out.signals.length : githubTotal;
  if (ctx.preview) out.signals = out.signals.slice(0, 5);
  out.sample = out.signals.slice(0, 5).map((s) => toSample(s, `${(s.payload as Record<string, unknown>).stars} stars`));
  out.detail = { queries: githubQueries(f, ctx.now).length, authenticated: !!ctx.githubToken, scanned, github_total: githubTotal };
  return out;
}

// ================================================================= medical ===

export const OPENFDA = "https://api.fda.gov/device";
const fdaYmd = (ms: number) => ymd(ms).replaceAll("-", "");
const quote = (v: string) => `"${v.replace(/"/g, "")}"`;
const anyOf = (field: string, vals: string[]) => (vals.length ? `(${vals.map((v) => `${field}:${quote(v)}`).join(" OR ")})` : null);
const anyOfFields = (fields: string[], vals: string[]) =>
  vals.length ? `(${fields.flatMap((fl) => vals.map((v) => `${fl}:${quote(v)}`)).join(" OR ")})` : null;

/** openFDA search=…: spaces become '+', the rest is percent-encoded. */
export function openFdaUrl(endpoint: string, clauses: Array<string | null>, sort: string, limit: number): string {
  const search = clauses.filter(Boolean).join(" AND ");
  return `${OPENFDA}/${endpoint}.json?search=${encodeURIComponent(search).replace(/%20/g, "+")}&sort=${sort}:desc&limit=${limit}`;
}

interface FdaFields { date: string; code: string; specialty: string; keywords: string[]; company: string }
const FDA_FIELDS: Record<"510k" | "pma" | "recall" | "registrationlisting", FdaFields> = {
  "510k": { date: "decision_date", code: "product_code", specialty: "advisory_committee_description", keywords: ["device_name"], company: "applicant" },
  pma: { date: "decision_date", code: "product_code", specialty: "advisory_committee_description", keywords: ["trade_name", "generic_name"], company: "applicant" },
  recall: { date: "event_date_posted", code: "product_code", specialty: "openfda.medical_specialty_description", keywords: ["product_description"], company: "recalling_firm" },
  registrationlisting: {
    date: "products.created_date", code: "products.product_code", specialty: "products.openfda.medical_specialty_description",
    keywords: ["proprietary_name", "products.openfda.device_name"], company: "registration.name",
  },
};

export function fdaClauses(endpoint: keyof typeof FDA_FIELDS, f: MedicalFilters, now: number, extra: string[] = []): string[] {
  const x = FDA_FIELDS[endpoint];
  return [
    `${x.date}:[${fdaYmd(now - f.within_days * DAY)} TO ${fdaYmd(now)}]`,
    anyOf(x.code, f.product_codes),
    anyOf(x.specialty, f.specialties),
    anyOfFields(x.keywords, f.device_keywords),
    anyOf(x.company, f.companies),
    ...extra,
  ].filter((c): c is string => !!c);
}

async function fdaQuery(ctx: AdapterCtx, endpoint: keyof typeof FDA_FIELDS, clauses: string[], limit: number) {
  const r = await getJson(ctx, openFdaUrl(endpoint, clauses, FDA_FIELDS[endpoint].date, limit));
  if (r.status === 404) return { total: 0, results: [] as Record<string, unknown>[], error: null }; // "No matches found!"
  if (!r.ok) return { total: 0, results: [], error: `openFDA ${endpoint} HTTP ${r.status}: ${r.text}` };
  const meta = (r.body?.meta as Record<string, unknown> | undefined)?.results as Record<string, unknown> | undefined;
  return { total: Number(meta?.total ?? 0), results: (r.body?.results ?? []) as Record<string, unknown>[], error: null };
}

const str = (v: unknown) => collapseSpaces(typeof v === "string" ? v : Array.isArray(v) ? (v[0] as string) : null);

export const BREAKTHROUGH_URL = "https://www.fda.gov/medical-devices/how-study-and-market-your-device/breakthrough-devices-program";

/** The fda.gov "Breakthrough Devices Program" authorizations table. */
export function parseBreakthroughTable(html: string): Array<{ manufacturer: string; trade_name: string; submission: string; decision_date: string }> {
  const out: Array<{ manufacturer: string; trade_name: string; submission: string; decision_date: string }> = [];
  const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    if (!/Marketing Submission Number/i.test(table)) continue;
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(decode);
      if (cells.length < 4 || /^Manufacturer$/i.test(cells[0])) continue;
      const m = cells[3].match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) continue;
      out.push({ manufacturer: cells[0], trade_name: cells[1], submission: cells[2].toUpperCase(), decision_date: `${m[3]}-${m[1]}-${m[2]}` });
    }
  }
  return out;
}

function fdaSubmissionUrl(n: string): string {
  if (/^DEN/i.test(n)) return `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=${encodeURIComponent(n)}`;
  if (/^P/i.test(n)) return `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=${encodeURIComponent(n)}`;
  return `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${encodeURIComponent(n)}`;
}

export async function runMedical(writer: string, input: InputRow, f: MedicalFilters, ctx: AdapterCtx): Promise<AdapterResult> {
  const out = empty();
  const sources = f.sources.filter((s) => MEDICAL_WRITER[s] === writer);
  if (!sources.length) return out;
  const limit = ctx.preview ? 5 : Math.min(1000, Number(ctx.config.max_results ?? 200));
  const errors: string[] = [];
  const bySource: Record<string, number> = {};
  const push = (_src: MedicalSource, s: SignalInput) => out.signals.push(s);
  const medBase = (s: Omit<SignalInput, "visibility" | "team_id" | "markets">) =>
    base(input, { ...s, markets: ["medical_device"] });

  const want = new Set(sources);
  // ---- 510(k) and De Novo share /device/510k.json (De Novo = decision_code DENG)
  if (want.has("510k") || want.has("denovo")) {
    const only = want.has("510k") && want.has("denovo") ? [] : want.has("denovo") ? ["decision_code:DENG"] : [];
    const q = await fdaQuery(ctx, "510k", fdaClauses("510k", f, ctx.now, only), limit);
    if (q.error) errors.push(q.error);
    for (const r of q.results) {
      const k = str(r.k_number);
      const at = toIso(str(r.decision_date));
      if (!k || !at) continue;
      const denovo = str(r.decision_code) === "DENG" || /^DEN/i.test(k);
      if (denovo ? !want.has("denovo") : !want.has("510k")) continue;
      out.fetched++;
      const applicant = str(r.applicant);
      push(denovo ? "denovo" : "510k", medBase({
        signal_type: "fda_clearance", occurred_at: at,
        dedupe_key: dedupeKey(`in:${input.id}:510k`, k),
        title: `${applicant ?? "Unknown applicant"} ${denovo ? "De Novo granted" : "510(k) cleared"} ${k}${str(r.device_name) ? `: ${str(r.device_name)}` : ""}`.slice(0, 500),
        url: fdaSubmissionUrl(k), score: denovo ? 80 : 70, company_name: applicant,
        city: str(r.city), state: str(r.state), country: str(r.country_code),
        payload: { kind: denovo ? "de_novo" : "510k", k_number: k, device_name: str(r.device_name), product_code: str(r.product_code),
          specialty: str(r.advisory_committee_description), decision_code: str(r.decision_code) },
      }));
    }
    // one query covers both kinds; when only 510(k) was asked for, the total includes De Novo grants
    bySource[want.has("510k") && want.has("denovo") ? "510k+denovo" : want.has("denovo") ? "denovo" : "510k"] = q.total;
    out.total += q.total;
  }
  // ---- PMA originals (supplements have a supplement_number; originals are '')
  if (want.has("pma")) {
    const q = await fdaQuery(ctx, "pma", fdaClauses("pma", f, ctx.now), ctx.preview ? 100 : 1000);
    if (q.error) errors.push(q.error);
    const originals = q.results.filter((r) => !str(r.supplement_number));
    bySource.pma = originals.length;
    out.total += originals.length;
    for (const r of originals.slice(0, limit)) {
      const p = str(r.pma_number);
      const at = toIso(str(r.decision_date));
      if (!p || !at) continue;
      out.fetched++;
      const applicant = str(r.applicant);
      push("pma", medBase({
        signal_type: "fda_clearance", occurred_at: at, dedupe_key: dedupeKey(`in:${input.id}:pma`, p),
        title: `${applicant ?? "Unknown applicant"} PMA approved ${p}${str(r.trade_name) ? `: ${str(r.trade_name)}` : ""}`.slice(0, 500),
        url: fdaSubmissionUrl(p), score: 85, company_name: applicant, city: str(r.city), state: str(r.state),
        payload: { kind: "pma", pma_number: p, trade_name: str(r.trade_name), generic_name: str(r.generic_name),
          product_code: str(r.product_code), specialty: str(r.advisory_committee_description) },
      }));
    }
  }
  // ---- Breakthrough authorizations (fda.gov table; no API). Filter: companies / device keywords.
  if (want.has("breakthrough")) {
    try {
      const res = await ctx.fetchFn(BREAKTHROUGH_URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; vrelly-signals)" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`fda.gov HTTP ${res.status}`);
      const rows = parseBreakthroughTable(await res.text());
      const cutoff = ymd(ctx.now - f.within_days * DAY);
      const kw = f.device_keywords.map(norm), co = f.companies.map(norm);
      const hits = rows.filter((r) => r.decision_date >= cutoff &&
        (!kw.length || kw.some((k) => norm(r.trade_name).includes(k))) &&
        (!co.length || co.some((c) => norm(r.manufacturer).includes(c))));
      bySource.breakthrough = hits.length;
      out.total += hits.length;
      for (const r of hits.slice(0, limit)) {
        out.fetched++;
        push("breakthrough", medBase({
          signal_type: "fda_clearance", occurred_at: `${r.decision_date}T00:00:00.000Z`,
          dedupe_key: dedupeKey(`in:${input.id}:bt`, r.submission),
          title: `${r.manufacturer} — Breakthrough Device authorized (${r.submission}): ${r.trade_name}`.slice(0, 500),
          url: fdaSubmissionUrl(r.submission), score: 85, company_name: r.manufacturer,
          payload: { kind: "breakthrough", submission_number: r.submission, trade_name: r.trade_name, breakthrough: true },
        }));
      }
    } catch (e) {
      errors.push(`breakthrough: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // ---- Recalls
  if (want.has("recalls")) {
    const q = await fdaQuery(ctx, "recall", fdaClauses("recall", f, ctx.now), limit);
    if (q.error) errors.push(q.error);
    bySource.recalls = q.total;
    out.total += q.total;
    for (const r of q.results) {
      const id = str(r.product_res_number) ?? str(r.cfres_id);
      const at = toIso(str(r.event_date_posted));
      if (!id || !at) continue;
      out.fetched++;
      const firm = str(r.recalling_firm);
      push("recalls", medBase({
        signal_type: "fda_recall", occurred_at: at, dedupe_key: dedupeKey(`in:${input.id}:recall`, id),
        title: `${firm ?? "A firm"} recall ${id}: ${(str(r.product_description) ?? "").slice(0, 160)}`.slice(0, 500),
        url: str(r.cfres_id) ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm?id=${encodeURIComponent(str(r.cfres_id)!)}` : null,
        score: 65, company_name: firm,
        payload: { product_res_number: id, product_code: str(r.product_code), reason: str(r.reason_for_recall),
          root_cause: str(r.root_cause_description), status: str(r.recall_status), k_numbers: r.k_numbers ?? null },
      }));
    }
  }
  // ---- Registrations & listings: one signal per newly listed product in the window
  if (want.has("registrations")) {
    const q = await fdaQuery(ctx, "registrationlisting", fdaClauses("registrationlisting", f, ctx.now), limit);
    if (q.error) errors.push(q.error);
    bySource.registrations = q.total;
    out.total += q.total;
    const cutoff = ymd(ctx.now - f.within_days * DAY);
    for (const r of q.results) {
      const reg = (r.registration ?? {}) as Record<string, unknown>;
      const firm = str(reg.name);
      const regNo = str(reg.registration_number) ?? str(reg.fei_number);
      for (const p of (r.products ?? []) as Array<Record<string, unknown>>) {
        const created = str(p.created_date);
        const code = str(p.product_code);
        if (!regNo || !created || created < cutoff || !code) continue;
        if (f.product_codes.length && !f.product_codes.includes(code)) continue;
        out.fetched++;
        const device = str(((p.openfda ?? {}) as Record<string, unknown>).device_name) ?? str(r.proprietary_name);
        push("registrations", medBase({
          signal_type: "fda_registration", occurred_at: `${created}T00:00:00.000Z`,
          dedupe_key: dedupeKey(`in:${input.id}:reg`, regNo, code, created),
          title: `${firm ?? "A firm"} listed a new device (${code})${device ? `: ${device}` : ""}`.slice(0, 500),
          url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRL/rl.cfm?lid=&rid=${encodeURIComponent(regNo)}`,
          score: 50, company_name: firm, city: str(reg.city), state: str(reg.state_code), country: str(reg.iso_country_code),
          payload: { registration_number: regNo, product_code: code, device_name: device, proprietary_name: r.proprietary_name ?? null,
            establishment_type: r.establishment_type ?? null },
        }));
      }
    }
  }
  // ---- ClinicalTrials.gov: interventional device studies first posted in the window
  if (want.has("clinical_trials")) {
    const adv = [
      "AREA[StudyType]INTERVENTIONAL", "AREA[InterventionType]DEVICE",
      `AREA[StudyFirstPostDate]RANGE[${ymd(ctx.now - f.within_days * DAY)},${ymd(ctx.now)}]`,
      ...(f.industry_sponsors_only ? ["AREA[LeadSponsorClass]INDUSTRY"] : []),
    ].join(" AND ");
    const terms = [...f.device_keywords, ...f.specialties];
    const qs = new URLSearchParams({
      "filter.advanced": adv, pageSize: String(ctx.preview ? 5 : Math.min(1000, limit)), countTotal: "true",
      fields: "NCTId,BriefTitle,LeadSponsorName,LeadSponsorClass,Condition,InterventionName,LocationCountry,StudyFirstPostDate,OverallStatus",
      sort: "StudyFirstPostDate:desc",
    });
    if (terms.length) qs.set("query.term", terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" OR "));
    if (f.companies.length) qs.set("query.spons", f.companies.join(" OR "));
    const r = await getJson(ctx, `https://clinicaltrials.gov/api/v2/studies?${qs}`);
    if (!r.ok) errors.push(`ClinicalTrials.gov HTTP ${r.status}: ${r.text}`);
    else {
      bySource.clinical_trials = Number(r.body?.totalCount ?? 0);
      out.total += bySource.clinical_trials;
      for (const st of (r.body?.studies ?? []) as Array<Record<string, any>>) {
        const ps = st.protocolSection ?? {};
        const nct = str(ps.identificationModule?.nctId);
        const at = toIso(str(ps.statusModule?.studyFirstPostDateStruct?.date));
        if (!nct || !at) continue;
        out.fetched++;
        const sponsor = ps.sponsorCollaboratorsModule?.leadSponsor ?? {};
        const countries = [...new Set(((ps.contactsLocationsModule?.locations ?? []) as Array<{ country?: string }>).map((l) => l.country).filter(Boolean))];
        push("clinical_trials", medBase({
          signal_type: "clinical_trial", occurred_at: at, dedupe_key: dedupeKey(`in:${input.id}:nct`, nct),
          title: `New device trial (${nct}): ${str(sponsor.name) ?? "Unknown sponsor"} — ${str(ps.identificationModule?.briefTitle) ?? ""}`.slice(0, 500),
          url: `https://clinicaltrials.gov/study/${nct}`, score: sponsor.class === "INDUSTRY" ? 70 : 50,
          company_name: sponsor.class === "INDUSTRY" ? str(sponsor.name) : null,
          country: countries.length === 1 ? String(countries[0]) : null,
          payload: { nct_id: nct, sponsor: str(sponsor.name), sponsor_class: sponsor.class ?? null,
            conditions: ps.conditionsModule?.conditions ?? [], interventions: (ps.armsInterventionsModule?.interventions ?? []).map((i: { name?: string }) => i.name),
            countries, status: str(ps.statusModule?.overallStatus) },
        }));
      }
    }
  }
  out.sample = out.signals.slice(0, 5).map((s) => toSample(s, String((s.payload as Record<string, unknown>).kind ?? s.signal_type).replace(/_/g, " ")));
  if (errors.length) out.error = errors.join("; ");
  out.detail = { by_source: bySource };
  return out;
}

export async function runAdapter(writer: string, input: InputRow, filters: unknown, ctx: AdapterCtx): Promise<AdapterResult> {
  if (writer === "input_hiring") return runHiring(input, filters as HiringFilters, ctx);
  if (writer === "input_github") return runGithub(input, filters as GithubFilters, ctx);
  return runMedical(writer, input, filters as MedicalFilters, ctx);
}
