import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanReplyPreview } from '../_shared/reply-text.ts';

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

// ---------------------------------------------------------------------------
// Reply.io v3 (deprecated v1 code removed — Foundation phase 2/6).
//
// Auth swap: X-API-Key → Authorization: Bearer (matches sync-reply-sequences
// 8a37994 + sync-reply-campaigns Step 2 8c8cd38).
//
// Endpoint history:
//   - Original: dual dance — v3 /sequences/{id}/contacts/extended (PRIMARY,
//     limit/offset + additionalColumns=Status) with /v1/campaigns/{id}/people
//     fallback.
//   - 0939c1d regressed this to workspace-wide /v3/contacts + client-side
//     sequences[] filter. That matched 0 (plain /v3/contacts omits per-contact
//     sequence membership) AND rate-limited paging all 14k+ contacts.
//   - Now: server-side scoped /v3/sequences/{id}/contacts (top/skip, Bearer).
//     The /extended suffix is a v1-era route that 404s on v3 ("No endpoint
//     matches"); the correct v3 route is /contacts with no suffix (verified
//     200 against a live dev sequence id).
//
// Scope handling: /v3/sequences/{id}/contacts is natively sequence-scoped, so
// every returned contact already belongs to this sequence — no client-side
// filter needed. external_campaign_id holds the Reply.io sequence id.
//
// ROSTER-ONLY MODE (Option A — engagement preservation).
// ------------------------------------------------------
// CONFIRMED live against CYPR: /v3/contacts returns NO engagement flags. The
// 30 top-level keys (id, email, ..., isOptedOut, sequences, ...) include
// callStatus / meetingStatus / phoneStatus / isOptedOut but OMIT replied,
// opened, clicked, bounced, finished, delivered. There is no `status:{}`
// nested object either. Per llms.txt, engagement lives on a separate
// GET /v3/contacts/{id}/statuses endpoint (would require N extra calls
// per sync).
//
// To avoid silently regressing engagement data (writing all-false would
// clobber webhook-populated state in synced_contacts.engagement_data AND
// zero-out synced_campaigns.stats.{sent,replies,opens,bounces}), this
// function now writes only what v3 actually supplies:
//
//   * synced_contacts row: writes the people-roster fields (email, name,
//     company, linkedin_url, etc.) but OMITS engagement_data and status.
//     On INSERT the column defaults apply (engagement_data={}, status=NULL).
//     On UPDATE, PostgREST preserves the existing engagement_data and
//     status verbatim — webhook-populated replied/bounced/opened state
//     survives.
//   * synced_campaigns.stats: updates peopleCount only. Spread preserves
//     existing sent/replies/opens/bounces/etc. (webhook + prior-sync
//     values stay put).
//
// Trade-off: this function no longer refreshes engagement data on demand
// — engagement comes from webhooks (reply-webhook updates engagement_data
// + status on incoming events) and from synced_campaigns' platform-level
// reporting calls (Step 3a sync-reply-campaigns writes
// per-row stats.sent/replies/etc. via /v3/reporting). A future phase
// could add a per-contact /v3/contacts/{id}/statuses fetch behind a
// flag; for now, "people roster" is what this function does.
//
// Field-name remaps (verified from live spike):
//   addingDate   ← was addedTime / addedAt
//   linkedInUrl  ← was linkedInProfile / linkedinProfile (capital I-n)
//   isOptedOut   ← was status.optedOut (top-level flat boolean)
//   company      ← was companyName (already matches v3)
//   customFields ← ARRAY of {key,value} (not flat object) — preserved
//                  as raw_data; synced_contacts.custom_fields stays {}
//                  (current behavior — feature would be a separate change).
// ---------------------------------------------------------------------------

const REPLY_API_V3 = "https://api.reply.io/v3";

// V3 Contact shape — verified field names from live spike, plus defensive
// optionals for engagement flags whose location on /v3/contacts is unknown.
interface V3Contact {
  id?: number;
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  // VERIFIED v3 field names (per spike against CYPR):
  company?: string;                                          // not companyName
  linkedInUrl?: string;                                      // not linkedInProfile (capital I-n)
  isOptedOut?: boolean;                                      // top-level flat boolean
  customFields?: Array<{ key: string; value: string }>;      // array, not flat object
  sequences?: Array<number | { id: number | string } | unknown>;
  lists?: Array<unknown>;
  addingDate?: string;                                       // not addedTime / addedAt

  // DEFENSIVE — engagement flag location uncertain across v3 endpoints.
  // First-call key log in fetchSequenceContactsV3 will surface what's
  // actually there. v3ToUnified() reads via ?? chain across top-level
  // and nested.
  status?: {
    status?: string;
    replied?: boolean;
    delivered?: boolean;
    opened?: boolean;
    clicked?: boolean;
    bounced?: boolean;
    finished?: boolean;
    optedOut?: boolean;
  };
  // Speculative top-level booleans — included so if v3 promotes them
  // out of a nested object we don't silently drop the value.
  replied?: boolean;
  delivered?: boolean;
  opened?: boolean;
  clicked?: boolean;
  bounced?: boolean;
  finished?: boolean;

  // Additional fields used by the downstream synced_contacts write.
  // Verified names where possible; otherwise carried from v1/v3 shared shape.
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
}

interface V3ContactsPage {
  items?: V3Contact[];
  hasMore?: boolean;
}

// Unified format consumed by downstream upsert logic. Field names here
// match the LOCAL variable names the original handler used — kept stable
// so the batch-upsert block at the bottom of the file requires zero
// changes. v3-specific field-name remaps happen in v3ToUnified() below.
interface UnifiedContact {
  id?: number;
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  addedAt?: string;          // remapped FROM v3 addingDate
  industry?: string;
  companySize?: string;
  domain?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedInProfile?: string;  // remapped FROM v3 linkedInUrl
  // Engagement flags
  delivered: boolean;
  replied: boolean;
  opened: boolean;
  clicked: boolean;
  bounced: boolean;
  finished: boolean;
  optedOut: boolean;
  rawData: unknown;
}

interface EngagementStats {
  deliveredCount: number;
  repliesCount: number;
  opensCount: number;
  clicksCount: number;
  bouncesCount: number;
  optedOutCount: number;
}

// Bearer-authed v3 fetcher — identical shape to sync-reply-campaigns'
// fetchV3 / fetchV3WithRetry (preserves retry semantics per spec).
async function fetchV3<T = unknown>(endpoint: string, apiKey: string): Promise<T> {
  const response = await fetch(`${REPLY_API_V3}${endpoint}`, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reply.io v3 API error (${response.status}): ${errorText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchV3WithRetry<T = unknown>(
  endpoint: string,
  apiKey: string,
  maxRetries: number = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchV3<T>(endpoint, apiKey);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isRateLimit = msg.includes("Too much requests") || msg.includes("(429)");
      if (isRateLimit && attempt < maxRetries) {
        const waitMs = 5000 * attempt;
        console.log(`Rate limited on ${endpoint}, waiting ${waitMs / 1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Fetch contacts for ONE sequence via the v3 endpoint:
//   GET /v3/sequences/{id}/contacts  (items[]/hasMore, top + skip).
//
// Replaces the prior workspace-wide /v3/contacts fetch + client-side
// isInSequence() filter, which matched 0 contacts (plain /v3/contacts does
// not return per-contact sequence membership in the {id}/bare-number shape
// isInSequence expected) and paged all 14k+ workspace contacts to skip=10000
// (rate-limited) on every sync. This endpoint is natively sequence-scoped, so
// we only walk the contacts in THIS sequence — fixing both the zero-match and
// the rate-limiting at once. Same {items[], hasMore} envelope + top/skip
// convention as sync-reply-campaigns' fetchAllSequencesV3.
//
// NOTE: the path is /contacts, NOT /contacts/extended — the latter is a
// v1-era route that 404s ("No endpoint matches") on v3. Verified 200 against
// a live dev sequence id before shipping.
//
// First-call key log: prints the top-level keys of the first contact —
// tripwire to confirm the endpoint's field names match the v3ToUnified()
// remaps (company / linkedInUrl / status{}). Once per sync.
async function fetchSequenceContactsV3(
  apiKey: string,
  sequenceId: string,
  pageSize: number = 100,
): Promise<V3Contact[]> {
  const all: V3Contact[] = [];
  let skip = 0;
  let loggedFirstKeys = false;
  for (let page = 1; page <= 1000; page++) {
    const url = `/sequences/${sequenceId}/contacts?top=${pageSize}&skip=${skip}`;
    const resp = await fetchV3WithRetry<V3ContactsPage>(url, apiKey);
    const items = Array.isArray(resp.items) ? resp.items : [];

    if (!loggedFirstKeys && items[0]) {
      const first = items[0] as unknown as Record<string, unknown>;
      console.log(`[/v3/sequences/${sequenceId}/contacts] first-call top-level keys:`, Object.keys(first));
      const status = first.status;
      if (status && typeof status === "object") {
        console.log(`[/v3/sequences/${sequenceId}/contacts] first-call status nested keys:`, Object.keys(status));
      } else {
        console.log(`[/v3/sequences/${sequenceId}/contacts] first-call status: ${status === undefined ? "(absent)" : typeof status}`);
      }
      loggedFirstKeys = true;
    }

    if (items.length === 0) break;
    all.push(...items);
    console.log(`  seq ${sequenceId} page ${page} (skip=${skip}): fetched ${items.length}, total ${all.length}`);
    if (resp.hasMore === false) break;
    if (items.length < pageSize) break;
    skip += items.length;
    if (all.length > 100000) {
      console.warn(`Reached safety cap (100k contacts); stopping pagination`);
      break;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

// Convert v3 contact to unified format. Field-name remaps:
//   linkedInUrl   → linkedInProfile  (UnifiedContact var name; writes to .linkedin_url)
//   addingDate    → addedAt          (UnifiedContact var name; writes to .added_at)
//   isOptedOut    → optedOut         (Boolean polarity unchanged)
// Engagement flag extraction uses ?? chain across:
//   - Top-level v3 booleans (e.g. contact.replied)        — speculative
//   - Nested status object (legacy shape)                 — defensive
//   - Defaults to false                                   — safe under uncertainty
// ── Firmographic extraction from Reply.io customFields ─────────────────────
// Reply.io delivers industry / company size / location as user-defined
// customFields ({key,value}[]), NOT top-level contact fields — and key names
// vary per account. Match keys case-insensitively against alias sets. Company
// location is PREFERRED over personal location. Any unmapped key is collected
// (logged once per sync) so we can extend the aliases.
const unmappedCustomFieldKeys = new Set<string>();

const normKey = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ").replace(/[_-]+/g, " ").trim();

const INDUSTRY_ALIASES = new Set(["industry", "company industry", "vertical", "sector"].map(normKey));
const COMPANY_SIZE_ALIASES = new Set(
  ["company size", "employees", "employee count", "number of employees", "no of employees",
   "size", "headcount", "company headcount", "employee range", "company size range", "employees count"].map(normKey),
);
const COMPANY_CITY_ALIASES = new Set(["company city", "hq city", "headquarters city"].map(normKey));
const COMPANY_STATE_ALIASES = new Set(["company state", "hq state", "headquarters state", "company region"].map(normKey));
const COMPANY_COUNTRY_ALIASES = new Set(["company country", "hq country", "headquarters country"].map(normKey));
const COMPANY_LOCATION_ALIASES = new Set(
  ["company location", "hq", "headquarters", "hq location", "company hq", "company address", "company headquarters"].map(normKey),
);
const PERSONAL_CITY_ALIASES = new Set(["city"].map(normKey));
const PERSONAL_STATE_ALIASES = new Set(["state", "region", "province"].map(normKey));
const PERSONAL_COUNTRY_ALIASES = new Set(["country"].map(normKey));

const ALL_ALIAS_SETS = [
  INDUSTRY_ALIASES, COMPANY_SIZE_ALIASES, COMPANY_CITY_ALIASES, COMPANY_STATE_ALIASES,
  COMPANY_COUNTRY_ALIASES, COMPANY_LOCATION_ALIASES, PERSONAL_CITY_ALIASES,
  PERSONAL_STATE_ALIASES, PERSONAL_COUNTRY_ALIASES,
];

interface Firmographics {
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
}

function extractFirmographics(customFields: Array<{ key?: string; value?: string }> | undefined): Firmographics {
  if (!Array.isArray(customFields) || customFields.length === 0) return {};
  // Normalized key → value (first non-empty wins).
  const map = new Map<string, string>();
  for (const f of customFields) {
    const k = typeof f?.key === "string" ? normKey(f.key) : "";
    const v = typeof f?.value === "string" ? f.value.trim() : "";
    if (!k) continue;
    if (v && !map.has(k)) map.set(k, v);
    // Track keys that match NO alias set — for extending the alias list.
    if (!ALL_ALIAS_SETS.some((s) => s.has(k))) unmappedCustomFieldKeys.add(k);
  }
  const pick = (aliases: Set<string>): string | undefined => {
    for (const [k, v] of map) if (aliases.has(k) && v) return v;
    return undefined;
  };

  const industry = pick(INDUSTRY_ALIASES);
  const companySize = pick(COMPANY_SIZE_ALIASES);

  // Location: prefer COMPANY over personal. If company city/state/country exist
  // use them; else a combined company-location string → city; else personal.
  const cCity = pick(COMPANY_CITY_ALIASES);
  const cState = pick(COMPANY_STATE_ALIASES);
  const cCountry = pick(COMPANY_COUNTRY_ALIASES);
  let city: string | undefined, state: string | undefined, country: string | undefined;
  if (cCity || cState || cCountry) {
    city = cCity; state = cState; country = cCountry;
  } else {
    const combined = pick(COMPANY_LOCATION_ALIASES);
    if (combined) {
      city = combined; // store the whole company-location string; analysis buckets on it
    } else {
      city = pick(PERSONAL_CITY_ALIASES);
      state = pick(PERSONAL_STATE_ALIASES);
      country = pick(PERSONAL_COUNTRY_ALIASES);
    }
  }
  return { industry, companySize, city, state, country };
}

function v3ToUnified(contact: V3Contact): UnifiedContact {
  const toBool = (val: unknown): boolean => {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") return val.toLowerCase() === "true";
    return false;
  };

  const status = contact.status ?? {};

  const replied = toBool(contact.replied ?? status.replied);
  const opened = toBool(contact.opened ?? status.opened);
  const clicked = toBool(contact.clicked ?? status.clicked);
  const bounced = toBool(contact.bounced ?? status.bounced);
  const finished = toBool(contact.finished ?? status.finished);
  const optedOut = toBool(contact.isOptedOut ?? status.optedOut);

  // Delivered: explicit flag, OR inferred from other email activity
  // (opened/replied/clicked implies a successful delivery happened).
  // Same inference the old code used.
  const deliveredExplicit = toBool(contact.delivered ?? status.delivered);
  const hasEmailActivity = opened || replied || clicked;
  const delivered = deliveredExplicit || hasEmailActivity;

  // Firmographics come from customFields (varying key names), not top-level —
  // extract them and prefer over the (usually-empty) top-level fields.
  const fg = extractFirmographics(contact.customFields);

  return {
    id: contact.id,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    company: contact.company,
    addedAt: contact.addingDate,         // ← REMAP: v3 'addingDate' → UnifiedContact 'addedAt'
    industry: fg.industry ?? contact.industry,
    companySize: fg.companySize ?? contact.companySize,
    city: fg.city ?? contact.city,
    state: fg.state ?? contact.state,
    country: fg.country ?? contact.country,
    phone: contact.phone,
    linkedInProfile: contact.linkedInUrl, // ← REMAP: v3 'linkedInUrl' → UnifiedContact 'linkedInProfile'
    delivered,
    replied,
    opened,
    clicked,
    bounced,
    finished,
    optedOut,
    rawData: contact,
  };
}

function mapContactStatus(contact: UnifiedContact): string {
  if (contact.replied) return "replied";
  if (contact.bounced) return "bounced";
  if (contact.optedOut) return "opted_out";
  if (contact.finished) return "finished";
  if (contact.opened) return "opened";
  return "active";
}

function computeEngagementStats(contacts: UnifiedContact[]): EngagementStats {
  let deliveredCount = 0;
  let repliesCount = 0;
  let opensCount = 0;
  let clicksCount = 0;
  let bouncesCount = 0;
  let optedOutCount = 0;

  for (const contact of contacts) {
    if (contact.delivered) deliveredCount++;
    if (contact.replied) repliesCount++;
    if (contact.opened) opensCount++;
    if (contact.clicked) clicksCount++;
    if (contact.bounced) bouncesCount++;
    if (contact.optedOut) optedOutCount++;
  }

  return { deliveredCount, repliesCount, opensCount, clicksCount, bouncesCount, optedOutCount };
}

// ── Firmographic enrichment from the bulk /v3/contacts list ────────────────
// The sequence roster (/v3/sequences/{id}/contacts) is lean — no firmographics.
// The workspace list GET /v3/contacts DOES carry industry/companySize/domain/
// location per item (top/skip, max top=1000). Fetch it once, build lookup maps
// by contact id + email, and enrich the roster. Page-capped so a huge workspace
// degrades gracefully (logs if capped) rather than looping forever.
interface Firmo { industry?: string; companySize?: string; domain?: string; city?: string; state?: string; country?: string }
const cleanStr = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "Empty" ? v.trim() : undefined);

// Pull result. `incomplete` is TRUE whenever the walk stopped for any reason
// other than the API telling us it was done — a page cap, an exhausted retry
// budget, or a run out of time. It is observability only: an incomplete pull is
// SAFE, because the write path never nulls a firmographic (see
// applyFirmographics). Fewer contacts get enriched; none get erased.
interface FirmoPull {
  byId: Map<string, Firmo>;
  byEmail: Map<string, Firmo>;
  total: number;
  pages: number;
  incomplete: boolean;
  stopReason: string;
}

const FIRMO_PAGE = 1000;
const FIRMO_MAX_PAGES = 50; // 50k contacts
const FIRMO_PAGE_DELAY_MS = 250; // gentle pacing; Reply.io throttles bursts
const FIRMO_REQUEST_TIMEOUT_MS = 30_000;
const FIRMO_MAX_ATTEMPTS = 4;

// Reply.io throttles by STALLING as well as by 429 — a single page was measured
// at 57s against a live workspace. Without a timeout one slow page can eat the
// whole function budget, so each attempt is bounded and then retried.
async function fetchContactsPage(
  apiKey: string,
  skip: number,
): Promise<{ items: any[]; hasMore: boolean | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FIRMO_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${REPLY_API_V3}/contacts?top=${FIRMO_PAGE}&skip=${skip}`,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        signal: ctrl.signal,
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const err = new Error(`Reply.io v3 API error (${response.status}): ${body.slice(0, 200)}`);
      // Tag what the caller needs to decide retry-vs-abort, plus the server's
      // own Retry-After when it bothers to send one.
      (err as any).status = response.status;
      (err as any).retryAfterMs = Number(response.headers.get("retry-after") ?? 0) * 1000;
      throw err;
    }
    const body = await response.json();
    const items = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
    // hasMore is authoritative when present; null means "fall back to a
    // short-page check".
    const hasMore = body && typeof body === "object" && "hasMore" in body
      ? Boolean(body.hasMore)
      : null;
    return { items, hasMore };
  } finally {
    clearTimeout(timer);
  }
}

// Retry 429 AND 5xx AND timeouts with exponential backoff. The previous
// implementation retried only 429 and treated everything else — including a
// transient 502 — as "the pull is finished", silently truncating the map.
async function fetchContactsPageWithRetry(
  apiKey: string,
  skip: number,
  page: number,
): Promise<{ items: any[]; hasMore: boolean | null }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FIRMO_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchContactsPage(apiKey, skip);
    } catch (e) {
      lastErr = e;
      const status = Number((e as any)?.status ?? 0);
      const aborted = (e as any)?.name === "AbortError";
      const retryable = aborted || status === 429 || status === 408 || status >= 500;
      if (!retryable || attempt === FIRMO_MAX_ATTEMPTS) throw e;
      const serverAsked = Number((e as any)?.retryAfterMs ?? 0);
      const backoff = Math.max(serverAsked, 2000 * Math.pow(2, attempt - 1)); // 2s, 4s, 8s
      console.warn(
        `[sync-reply-contacts] page ${page} attempt ${attempt}/${FIRMO_MAX_ATTEMPTS} failed ` +
        `(${aborted ? "timeout" : `HTTP ${status || "?"}`}) — retrying in ${Math.round(backoff / 1000)}s`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchWorkspaceFirmographics(apiKey: string): Promise<FirmoPull> {
  const byId = new Map<string, Firmo>();
  const byEmail = new Map<string, Firmo>();
  let total = 0;
  let page = 0;
  let incomplete = false;
  let stopReason = "exhausted";

  for (; page < FIRMO_MAX_PAGES; page++) {
    let items: any[];
    let hasMore: boolean | null;
    try {
      ({ items, hasMore } = await fetchContactsPageWithRetry(apiKey, page * FIRMO_PAGE, page));
    } catch (e) {
      // Retries are spent. Stop, but KEEP everything already collected and mark
      // the pull incomplete — partial enrichment is safe by construction.
      incomplete = true;
      stopReason = `page ${page} failed after ${FIRMO_MAX_ATTEMPTS} attempts: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`[sync-reply-contacts] ${stopReason} — continuing with ${total} contacts already fetched`);
      break;
    }

    for (const c of items) {
      const firmo: Firmo = {
        industry: cleanStr(c.industry),
        companySize: cleanStr(c.companySize),
        domain: cleanStr(c.domain),
        city: cleanStr(c.city),
        state: cleanStr(c.state),
        country: cleanStr(c.country),
      };
      if (c.id !== undefined && c.id !== null) byId.set(String(c.id), firmo);
      if (typeof c.email === "string" && c.email.trim()) byEmail.set(c.email.trim().toLowerCase(), firmo);
    }
    total += items.length;
    console.log(
      `[sync-reply-contacts] workspace /contacts page ${page} -> ${items.length} contacts, running total ${total}` +
      (hasMore === null ? "" : ` (hasMore=${hasMore})`),
    );

    // hasMore is the API's own signal and wins. Only when it is absent do we
    // fall back to inferring exhaustion from a short page.
    if (hasMore === false) break;
    if (hasMore === null && items.length < FIRMO_PAGE) break;
    if (items.length === 0) break; // defensive: never spin on an empty page

    await new Promise((r) => setTimeout(r, FIRMO_PAGE_DELAY_MS));
  }

  if (page >= FIRMO_MAX_PAGES) {
    incomplete = true;
    stopReason = `hit the ${FIRMO_MAX_PAGES}-page cap`;
    console.error(
      `[sync-reply-contacts] WORKSPACE PULL CAPPED at ${FIRMO_MAX_PAGES} pages ` +
      `(${total} contacts). Contacts beyond this point were NOT enriched this run. ` +
      `Raise FIRMO_MAX_PAGES if this workspace is legitimately larger.`,
    );
  }

  console.log(
    `[sync-reply-contacts] workspace firmographics: ${total} contacts across ${Math.min(page + 1, FIRMO_MAX_PAGES)} page(s), ` +
    `${byEmail.size} unique emails${incomplete ? ` — INCOMPLETE (${stopReason})` : ""}`,
  );
  return { byId, byEmail, total, pages: Math.min(page + 1, FIRMO_MAX_PAGES), incomplete, stopReason };
}

// ── Non-destructive firmographic write ────────────────────────────────────
// Firmographics are WRITE-ONLY. This runs AFTER the roster upsert (which no
// longer carries these columns) and issues one targeted UPDATE per contact
// that the workspace pull actually enriched, containing ONLY the fields that
// came back non-empty.
//
// Two properties this guarantees, and the reasons they are load-bearing:
//   1. A contact missing from the bulk map is never touched — its stored
//      firmographics survive untouched. That is what makes a partial pull safe.
//   2. A contact present with only SOME fields updates only those fields — a
//      contact carrying an industry but no companySize cannot null the stored
//      companySize, because company_size is never put in the patch.
//
// Scoped by campaign_id + email (the roster upsert's conflict identity) AND
// team_id, so a shared email under another client's team can never be written.
// deno-lint-ignore no-explicit-any
async function applyFirmographics(
  serviceClient: any,
  campaignId: string,
  teamId: string,
  contacts: UnifiedContact[],
): Promise<{ updated: number; failed: number; skipped: number }> {
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const contact of contacts) {
    if (!contact.email) { skipped++; continue; }

    // Build the patch from non-empty values ONLY. An absent or blank field is
    // left out of the object entirely — never set to null.
    const patch: Record<string, string> = {};
    const put = (col: string, val: unknown) => {
      const v = cleanStr(val);
      if (v) patch[col] = v;
    };
    put("industry", contact.industry);
    put("company_size", contact.companySize);
    put("domain", contact.domain);
    put("city", contact.city);
    put("state", contact.state);
    put("country", contact.country);

    if (Object.keys(patch).length === 0) { skipped++; continue; } // nothing learned

    const { error } = await serviceClient
      .from("synced_contacts")
      .update(patch)
      .eq("campaign_id", campaignId)
      .eq("team_id", teamId)
      .eq("email", contact.email.toLowerCase());

    if (error) {
      failed++;
      if (failed <= 3) console.warn(`[sync-reply-contacts] firmographic update failed for ${contact.email}: ${error.message}`);
    } else {
      updated++;
    }
  }

  return { updated, failed, skipped };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Reset the per-run unmapped-customField-key collector.
  unmappedCustomFieldKeys.clear();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    const { campaignId, integrationId, userId: bodyUserId } = body;

    if (!campaignId || !integrationId) {
      throw new Error("Missing campaignId or integrationId");
    }

    // Check for internal service-role call via x-agent-key
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");
    const isInternalCall = !!(agentKey && expectedAgentKey && agentKey === expectedAgentKey);

    let queryClient;
    if (isInternalCall) {
      // Internal call from auto-sync: use service role client (bypasses RLS)
      queryClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      console.log("Using service role client (internal auto-sync call)");
    } else {
      // Frontend call: use user JWT (RLS enforced)
      queryClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
    }

    // Fetch the integration (RLS enforced for frontend calls, bypassed for internal)
    const { data: integration, error: integrationError } = await queryClient
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, reply_team_id")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      throw new Error("Integration not found or access denied");
    }

    // Fetch the campaign
    const { data: campaign, error: campaignError } = await queryClient
      .from("synced_campaigns")
      .select("id, external_campaign_id, team_id")
      .eq("id", campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error("Campaign not found");
    }

    // Service role for bulk operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get the user's ID for agent_leads — prefer auth token, fall back to body param
    // (webhook invocations use service role key and pass userId explicitly).
    //
    // NOTE: this branch referenced a pre-existing typo `userClient` (no
    // such variable was ever declared — the auth client is `queryClient`).
    // The typo would have thrown ReferenceError if any caller ever omitted
    // bodyUserId. Renamed to queryClient as a typo fix; the behavior change
    // is FROM "throws on missing bodyUserId" TO "actually resolves user
    // from JWT" — the obviously-intended behavior. Required for deno check
    // to pass on this file (was failing in the original too).
    let userId = bodyUserId;
    if (!userId) {
      const { data: { user }, error: userError } = await queryClient.auth.getUser();
      if (userError || !user) {
        throw new Error("Unable to resolve authenticated user");
      }
      userId = user.id;
    }

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const externalCampaignId = campaign.external_campaign_id;

    console.log(`Syncing contacts for campaign ${externalCampaignId} via v3`);

    // Fetch contacts for THIS sequence directly via the v3
    // /v3/sequences/{id}/contacts endpoint (server-side scoped).
    // external_campaign_id is the Reply.io sequence id (written as
    // String(sequence.id) by sync-reply-campaigns). No client-side filter
    // needed — every returned contact is already in this sequence.
    const sequenceContacts = await fetchSequenceContactsV3(apiKey, externalCampaignId);
    console.log(`Fetched ${sequenceContacts.length} contacts for sequence ${externalCampaignId}`);

    // Convert to unified format + dedupe by email (lowercase).
    const contactsMap = new Map<string, UnifiedContact>();
    for (const c of sequenceContacts) {
      if (c.email) {
        contactsMap.set(c.email.toLowerCase(), v3ToUnified(c));
      }
    }
    const contacts = Array.from(contactsMap.values());

    // Enrich firmographics from the bulk workspace list (the roster endpoint
    // omits them). One paginated pull, matched by contact id then email; the
    // bulk value wins, else keep whatever v3ToUnified already had (customFields
    // fallback). Bulk fetch errors degrade to no-enrichment, never fail the sync.
    let firmoIncomplete = false;
    let firmoStopReason = "";
    let firmoWorkspaceTotal = 0;
    try {
      const pull = await fetchWorkspaceFirmographics(apiKey);
      firmoIncomplete = pull.incomplete;
      firmoStopReason = pull.stopReason;
      firmoWorkspaceTotal = pull.total;
      const { byId, byEmail } = pull;
      let enriched = 0;
      for (const c of contacts) {
        const f =
          (c.id !== undefined && c.id !== null ? byId.get(String(c.id)) : undefined) ??
          (c.email ? byEmail.get(c.email.toLowerCase()) : undefined);
        if (!f) continue;
        if (f.industry) c.industry = f.industry;
        if (f.companySize) c.companySize = f.companySize;
        if (f.domain) c.domain = f.domain;
        if (f.city) c.city = f.city;
        if (f.state) c.state = f.state;
        if (f.country) c.country = f.country;
        if (f.industry || f.companySize || f.city || f.state || f.country || f.domain) enriched++;
      }
      console.log(`[sync-reply-contacts] firmographics enriched ${enriched}/${contacts.length} roster contacts for sequence ${externalCampaignId}`);
    } catch (e) {
      // Enrichment is best-effort and must never fail the roster sync. With
      // firmographics omitted from the upsert, skipping it simply leaves the
      // stored values alone.
      firmoIncomplete = true;
      firmoStopReason = e instanceof Error ? e.message : String(e);
      console.warn(`[sync-reply-contacts] firmographic enrichment skipped: ${firmoStopReason}`);
    }
    console.log(`Total contacts to sync: ${contacts.length} (source: v3 /contacts + client-side sequence filter)`);

    // Compute engagement stats from contacts
    const engagementStats = computeEngagementStats(contacts);
    console.log(`Engagement stats: delivered=${engagementStats.deliveredCount}, replies=${engagementStats.repliesCount}, opens=${engagementStats.opensCount}`);

    // Batch upsert contacts — UNCHANGED from prior behavior, just fed from
    // a v3-only contacts pipeline.
    const BATCH_SIZE = 100;
    let contactsSynced = 0;
    let contactsFailed = 0;

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(contacts.length / BATCH_SIZE);

      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} contacts)`);

      const records = batch.map(contact => {
        // ROSTER-ONLY: deliberately omit `engagement_data` and `status`
        // from the record. v3 /contacts doesn't supply engagement flags
        // (see file header). PostgREST upsert preserves these columns'
        // existing values on UPDATE; INSERTs get the column defaults
        // (engagement_data={}, status=NULL). Webhook-populated state
        // (reply-webhook writes engagement_data + status on inbound
        // events) survives. mapContactStatus / engagementData helpers
        // are retained for the future per-contact /v3/contacts/{id}/statuses
        // enrichment path but currently unused here.
        //
        // The SIX FIRMOGRAPHIC COLUMNS (industry, company_size, domain, city,
        // state, country) are omitted for the same reason, and it matters far
        // more here. They used to be written as `contact.industry || null`,
        // which meant every contact the bulk workspace pull did not cover had
        // its stored firmographics UPDATEd to NULL on conflict — one partial
        // pull erased good data for the whole roster. Measured on prod: 100%
        // of Avania's matched contacts held NULL locally while Reply.io still
        // had an industry for every one of them.
        //
        // Firmographics are now WRITE-ONLY, applied afterwards by
        // applyFirmographics() for the contacts this run actually enriched.
        // Omitting them here is what makes an incomplete pull harmless.
        return {
          campaign_id: campaignId,
          team_id: teamId,
          external_contact_id: contact.id ? String(contact.id) : null,
          email: contact.email.toLowerCase(),
          first_name: contact.firstName || null,
          last_name: contact.lastName || null,
          company: contact.company || null,
          job_title: contact.title || null,
          // status: omitted — see comment above
          // engagement_data: omitted — see comment above
          // industry / company_size / domain / city / state / country:
          //   omitted — see comment above; written by applyFirmographics()
          custom_fields: {},
          raw_data: contact.rawData,
          updated_at: new Date().toISOString(),
          phone: contact.phone || null,
          linkedin_url: contact.linkedInProfile || null,
          added_at: contact.addedAt || null,
        };
      });

      try {
        const { error: upsertError } = await serviceClient
          .from("synced_contacts")
          .upsert(records, {
            onConflict: "campaign_id,email",
          });

        if (upsertError) {
          console.error(`Batch ${batchNumber} failed:`, upsertError);
          contactsFailed += batch.length;
        } else {
          contactsSynced += batch.length;
        }
      } catch (err) {
        console.error(`Error in batch ${batchNumber}:`, err);
        contactsFailed += batch.length;
      }
    }

    // Firmographics, applied AFTER the roster upsert so the rows exist. Only
    // contacts this run actually enriched are touched, and only with the
    // fields that came back non-empty — nothing is ever nulled, so a partial
    // workspace pull enriches fewer contacts rather than erasing any.
    const firmoResult = await applyFirmographics(serviceClient, campaignId, teamId, contacts);
    console.log(
      `[sync-reply-contacts] firmographics written: ${firmoResult.updated} updated, ` +
      `${firmoResult.skipped} skipped (nothing to write), ${firmoResult.failed} failed` +
      (firmoIncomplete ? ` — workspace pull was INCOMPLETE (${firmoStopReason}); unenriched contacts kept their existing values` : ""),
    );

    // Upsert replied contacts with reply text into agent_leads
    const { data: repliedContacts } = await serviceClient
      .from("synced_contacts")
      .select("external_contact_id, first_name, last_name, email, engagement_data")
      .eq("campaign_id", campaignId)
      .eq("status", "replied")
      .not("engagement_data->lastReplyText", "is", null);

    if (repliedContacts && repliedContacts.length > 0) {
      const agentLeadRows = repliedContacts
        .filter((c) => c.external_contact_id && c.engagement_data?.lastReplyText)
        .map((c) => ({
          user_id: userId,
          external_id: c.external_contact_id!,
          full_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
          email: c.email,
          last_reply_text: cleanReplyPreview(c.engagement_data.lastReplyText),
          inbox_status: "pending",
          channel: "email",
          source: "reply_io",
        }));

      if (agentLeadRows.length > 0) {
        const { error: leadsError } = await serviceClient
          .from("agent_leads")
          .upsert(agentLeadRows, {
            onConflict: "user_id,external_id",
            ignoreDuplicates: false,
          });

        if (leadsError) {
          console.error("agent_leads upsert error:", leadsError);
        } else {
          console.log(`Upserted ${agentLeadRows.length} agent_leads`);
        }
      }
    }

    // Verify count in database
    const { count: verifiedCount } = await serviceClient
      .from("synced_contacts")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    const peopleCount = verifiedCount || contacts.length;

    // ROSTER-ONLY stats update — peopleCount ONLY. v3 /contacts doesn't
    // give us engagement counts (sent/replies/opens/bounces); writing
    // computed zeros here would clobber values populated by webhooks +
    // Step 3a's reporting fetch in sync-reply-campaigns. The spread
    // preserves every existing key.
    const { data: existingCampaign } = await serviceClient
      .from("synced_campaigns")
      .select("stats")
      .eq("id", campaignId)
      .maybeSingle();

    const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};

    const updatedStats = {
      ...existingStats,
      peopleCount,
      // sent / delivered / replies / opens / clicks / bounces / optedOut
      // INTENTIONALLY NOT WRITTEN — preserved from existingStats so
      // webhook + Step 3a reporting numbers stay intact.
    };

    await serviceClient
      .from("synced_campaigns")
      .update({
        stats: updatedStats,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`Contacts sync complete: ${contactsSynced} synced, ${contactsFailed} failed`);
    // Surface customFields keys we did NOT map to a firmographic — so the alias
    // sets can be extended to whatever this client actually uses.
    if (unmappedCustomFieldKeys.size > 0) {
      console.log(
        `[sync-reply-contacts] Unmapped customField keys (extend aliases if any are firmographic): ${JSON.stringify([...unmappedCustomFieldKeys].sort())}`,
      );
    }
    console.log(`Campaign stats updated: peopleCount=${peopleCount} (engagement counts preserved from prior values)`);

    // --- Agent Leads Population Block (OPT-IN, DEFAULT OFF) ---
    // DISABLED BY DEFAULT as of the 2026-08-04 incident. This block wrote
    // agent_leads directly from synced_contacts and caused two live failures:
    //
    //   1. DUPLICATES. external_id was `sc.external_contact_id || sc.email`
    //      (line ~1056) and the upsert relied on onConflict "user_id,external_id"
    //      instead of the shared resolveExistingLead. Real Reply.io leads key on
    //      the numeric THREAD id, so the conflict target never matched and the
    //      sync inserted second rows for contacts the operator had already
    //      handled — 14 phantom `pending` leads for Avania Clinical on 2026-08-04,
    //      every one duplicating an intact dismissed/sent lead.
    //
    //   2. UNSENDABLE LEADS. Those same external_ids are contact ids or email
    //      addresses, but send-agent-reply posts to
    //      /v3/inbox/threads/{external_id}/messages — so any such lead 404s with
    //      inboxThread.notFound the moment a rep clicks Send.
    //
    // The contacts/campaign sync above is unaffected and still runs: this gate
    // only stops the sync from MINTING INBOX LEADS. Capture is owned by
    // reply-webhook (real-time) and poll-reply-inbox (15-min backstop), both of
    // which write a real thread id and share resolveExistingLead for dedup.
    //
    // Set `populateAgentLeads: true` in the request body to re-enable for a
    // one-off run once this block writes thread ids and uses the shared dedup.
    const populateAgentLeads = body?.populateAgentLeads === true;
    let agentLeadsCreated = 0;
    if (!populateAgentLeads) {
      console.log(
        "[sync-reply-contacts] agent_leads population SKIPPED (opt-in flag off). " +
        "Contacts/campaign sync completed normally; inbox capture is owned by " +
        "reply-webhook + poll-reply-inbox.",
      );
    }
    try {
      // Single gate: everything below writes agent_leads / agent_activity and is
      // skipped entirely unless explicitly opted in.
      if (!populateAgentLeads) {
        // no-op — see the block comment above
      } else {
      // 1. Find the user_id for this integration
      const { data: integrationOwner } = await serviceClient
        .from("outbound_integrations")
        .select("created_by")
        .eq("id", integrationId)
        .single();

      if (integrationOwner?.created_by) {
        const ownerUserId = integrationOwner.created_by;

        // 2. Check if this user has an active agent config
        const { data: agentConfig } = await serviceClient
          .from("agent_configs")
          .select("*")
          .eq("user_id", ownerUserId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (agentConfig) {
          console.log(`Active agent config found (${agentConfig.id}) for user ${ownerUserId}, populating agent_leads`);

          // 3. Find all synced_contacts for this integration where the contact has replied
          const { data: repliedSyncedContacts } = await serviceClient
            .from("synced_contacts")
            .select("*")
            .eq("team_id", teamId)
            .or("engagement_data->>replied.eq.true,status.eq.replied");

          if (repliedSyncedContacts && repliedSyncedContacts.length > 0) {
            console.log(`Found ${repliedSyncedContacts.length} replied contacts to upsert into agent_leads`);

            const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

            for (const sc of repliedSyncedContacts) {
              try {
                // 4. Extract fields from synced_contacts
                const fullName = [sc.first_name, sc.last_name].filter(Boolean).join(" ") || "Unknown";
                const email = sc.email || "";
                const linkedinUrl = sc.linkedin_url || null;
                const company = sc.company || null;
                const jobTitle = sc.job_title || null;
                const externalId = sc.external_contact_id || sc.email;

                // Determine channel from engagement_data
                const engData = (sc.engagement_data as Record<string, unknown>) || {};
                const linkedinReplies = Number(engData.linkedinReplies) || 0;
                const channel = linkedinReplies > 0 ? "linkedin" : "email";

                const lastReplyAt = (engData.repliedAt as string) || sc.updated_at || new Date().toISOString();
                const lastReplyText = ""; // Not available from sync, only from webhooks

                // Upsert into agent_leads — only update if inbox_status is still 'pending'
                // Don't overwrite existing draft_response or intent if already classified
                const { data: upsertedLead, status: upsertStatus } = await serviceClient
                  .from("agent_leads")
                  .upsert(
                    {
                      user_id: agentConfig.user_id,
                      agent_config_id: agentConfig.id,
                      external_id: externalId,
                      full_name: fullName,
                      email,
                      linkedin_url: linkedinUrl,
                      company,
                      job_title: jobTitle,
                      channel,
                      source: "reply_io",
                      pipeline_stage: "replied",
                      inbox_status: "pending",
                      last_reply_at: lastReplyAt,
                      last_reply_text: cleanReplyPreview(lastReplyText),
                    },
                    {
                      onConflict: "user_id,external_id",
                      ignoreDuplicates: false,
                    }
                  )
                  .select()
                  .single();

                // 5. Log agent_activity only for newly created rows (HTTP 201)
                if (upsertedLead && upsertStatus === 201) {
                  agentLeadsCreated++;
                  await serviceClient.from("agent_activity").insert({
                    user_id: agentConfig.user_id,
                    agent_config_id: agentConfig.id,
                    lead_id: upsertedLead.id,
                    lead_name: fullName,
                    lead_company: company,
                    activity_type: "reply_received",
                    description: `Reply synced from Data Playground for ${fullName}${company ? " at " + company : ""}`,
                    metadata: { channel, source: "playground_sync" },
                  });
                }

                // 6. NO classify-reply call here — deliberately.
                //
                // There used to be one. It was dead twice over:
                //   * the whole agent_leads block is behind `populateAgentLeads`,
                //     which defaults to false and which NOTHING in the codebase
                //     ever sets — so it never ran on the 6h cron, the
                //     reply-webhook fire-and-forget, or the Playground button;
                //   * and it could not have worked if it had run. `lastReplyText`
                //     is hard-coded "" above ("Not available from sync, only from
                //     webhooks"), so its own `upsertedLead.last_reply_text` guard
                //     was always falsy.
                //
                // It also passed no `thread_history` and no `lead_id`, so even on
                // success it would have classified a reply it could not see and
                // then thrown the draft away — classify-reply's write-back is
                // gated on `if (lead_id)`.
                //
                // Drafting belongs to the paths that actually hold the reply and
                // the thread: reply-webhook (real-time) and poll-reply-inbox
                // (15-min backstop). This function syncs contacts and
                // firmographics; it has no reply text to reason about.
              } catch (contactErr) {
                console.warn(`Failed to upsert agent_lead for contact ${sc.email}:`, contactErr);
              }
            }

            console.log(`Agent leads: ${agentLeadsCreated} new leads created from ${repliedSyncedContacts.length} replied contacts`);
          } else {
            console.log("No replied contacts found for agent_leads population");
          }
        } else {
          console.log("No active agent config found, skipping agent_leads population");
        }
      }
      }
    } catch (agentLeadsErr) {
      // 7. Don't affect the existing sync response if anything fails
      console.error("Agent leads population failed (non-fatal):", agentLeadsErr);
    }
    // --- End Agent Leads Population Block ---

    return new Response(
      JSON.stringify({
        success: true,
        contactsSynced,
        contactsFailed,
        verifiedCount: peopleCount,
        source: "v3_contacts",
        // Roster-only mode (Option A engagement preservation). Engagement
        // counts are intentionally omitted from the response because v3
        // /contacts doesn't supply them — see file header. Downstream
        // engagement reads should go through synced_contacts.engagement_data
        // (webhook-populated) or synced_campaigns.stats (Step 3a reporting).
        mode: "roster_only",
        agentLeadsCreated,
        // Firmographic observability. `incomplete` means the workspace pull
        // stopped early (retries spent, page cap, or enrichment threw) and
        // some contacts were not enriched THIS run. It never means data was
        // lost — firmographics are write-only. Re-running the sync picks up
        // whatever was missed.
        firmographics: {
          updated: firmoResult.updated,
          skipped: firmoResult.skipped,
          failed: firmoResult.failed,
          workspaceContactsFetched: firmoWorkspaceTotal,
          incomplete: firmoIncomplete,
          ...(firmoIncomplete ? { stopReason: firmoStopReason } : {}),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Contacts sync error:", err);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
