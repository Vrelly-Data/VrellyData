// Pure rules for enrich-inference-events: the same formats the backfill rows
// carry (verified against prod inference_events):
//   * hours / days in America/New_York; day of week ISO 1 = Mon … 7 = Sun
//   * hours_to_reply = (reply − last send before it) in hours, 2 decimals
//   * tz_basis 'state' (US state → zone via inference_staging.us_state_tz),
//     'apollo' (non-US, Apollo person time_zone), else 'unknown'
//   * country full name ("United States"), US states full name ("Texas")
//   * company_size buckets 1-10 … 5001+, seniority lowercase_with_underscores
//   * copy_fingerprint = variant id (Reply.io step variant; Smartlead
//     seq_variant_id, else email_campaign_seq_id)

export const ET = "America/New_York";

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico",
};
const US_STATE_NAMES = new Map(Object.values(US_STATES).map((n) => [n.toLowerCase(), n]));

const COUNTRY_ALIASES: Record<string, string> = {
  "us": "United States", "u.s.": "United States", "u.s": "United States", "usa": "United States", "u.s.a.": "United States",
  "united states": "United States", "united states of america": "United States", "america": "United States",
  "uk": "United Kingdom", "u.k.": "United Kingdom", "gb": "United Kingdom", "great britain": "United Kingdom",
  "united kingdom": "United Kingdom", "uae": "United Arab Emirates", "u.a.e.": "United Arab Emirates",
  "ca": "Canada", "can": "Canada", "au": "Australia", "aus": "Australia", "de": "Germany", "in": "India",
};

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s : null;
};

/** "US" / "USA" / "united states of america" → "United States"; other names title-cased. */
export function normalizeCountry(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  const alias = COUNTRY_ALIASES[s.toLowerCase()];
  if (alias) return alias;
  if (s === s.toLowerCase() || s === s.toUpperCase()) {
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return s;
}

export const isUS = (country: string | null | undefined) => normalizeCountry(country) === "United States";

/**
 * US states use full names. "TX", "tx", "Texas", "Springtown, TX 76082" → "Texas".
 * Non-US (or unrecognised) values are returned trimmed, unchanged.
 */
export function normalizeState(v: unknown, country?: string | null): string | null {
  const s = clean(v);
  if (!s) return null;
  const c = normalizeCountry(country);
  if (c && c !== "United States") return s;
  const byName = US_STATE_NAMES.get(s.toLowerCase());
  if (byName) return byName;
  if (/^[A-Za-z]{2}$/.test(s) && US_STATES[s.toUpperCase()]) return US_STATES[s.toUpperCase()];
  // "City, TX 75001" / "City, TX"
  const m = /,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec(s);
  if (m && US_STATES[m[1].toUpperCase()]) return US_STATES[m[1].toUpperCase()];
  return s;
}

/** Country implied by a US state when the country is unknown. */
export function countryForState(state: string | null): string | null {
  return state && US_STATE_NAMES.has(state.toLowerCase()) ? "United States" : null;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Hour (0–23) and ISO day of week (1 = Mon … 7 = Sun) of an instant in a time zone. */
export function zonedParts(iso: string, tz = ET): { hour: number; dow: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" })
    .formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const dow = WEEKDAY[parts.find((p) => p.type === "weekday")?.value ?? ""];
  return Number.isFinite(hour) && dow ? { hour, dow } : null;
}

/** (replied − sent) in hours, 2 decimals; null when either is missing or the send is after the reply. */
export function hoursToReply(sentAt: string | null, repliedAt: string | null): number | null {
  if (!sentAt || !repliedAt) return null;
  const ms = new Date(repliedAt).getTime() - new Date(sentAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** The timing keys, exactly as the backfill names them. */
export function timingKeys(sentAt: string | null, repliedAt: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (repliedAt) {
    out.replied_at = repliedAt;
    const r = zonedParts(repliedAt);
    if (r) {
      out.reply_hour_et = r.hour;
      out.reply_dow_et = r.dow;
    }
  }
  if (sentAt) {
    out.sent_at = sentAt;
    const s = zonedParts(sentAt);
    if (s) {
      out.send_hour_et = s.hour;
      out.send_dow_et = s.dow;
    }
    const h = hoursToReply(sentAt, repliedAt);
    if (h !== null) out.hours_to_reply = h;
  }
  return out;
}

/**
 * time_zone = Apollo's person time zone (when known). tz_effective / tz_basis:
 * a US state that maps → 'state'; else a non-US person with an Apollo zone →
 * 'apollo'; else 'unknown' (no tz_effective).
 */
export function timeZoneKeys(
  p: { state: string | null; country: string | null; apolloTz: string | null },
  stateTz: Map<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.apolloTz) out.time_zone = p.apolloTz;
  const country = normalizeCountry(p.country);
  const st = p.state ? stateTz.get(p.state.trim().toLowerCase()) : undefined;
  if (st && (!country || country === "United States")) {
    out.tz_effective = st;
    out.tz_basis = "state";
  } else if (p.apolloTz && country && country !== "United States") {
    out.tz_effective = p.apolloTz;
    out.tz_basis = "apollo";
  } else {
    out.tz_basis = "unknown";
  }
  return out;
}

/** Employee count → the bucket inference_events uses; "251 to 500" → "251-500". */
export function sizeBucket(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n <= 10) return "1-10";
    if (n <= 50) return "11-50";
    if (n <= 200) return "51-200";
    if (n <= 500) return "201-500";
    if (n <= 1000) return "501-1000";
    if (n <= 5000) return "1001-5000";
    return "5001+";
  }
  const s = String(v).trim().replace(/\s+to\s+/i, "-");
  return s || null;
}

export function normalizeSeniority(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return s || null;
}

/** "Re: Fwd: Hello" → "Hello". */
export function cleanSubject(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  const out = s.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, "").trim();
  return out || null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Does a sent subject match a template subject? Template placeholders
 * ({{FirstName}}, {Company}, [[x]]) match anything.
 */
export function subjectMatches(template: string | null | undefined, sent: string | null | undefined): boolean {
  const t = cleanSubject(template);
  const s = cleanSubject(sent);
  if (!t || !s) return false;
  const parts = norm(t).split(/\{\{[^}]*\}\}|\{[^}]*\}|\[\[[^\]]*\]\]/);
  if (parts.length === 1) return parts[0] === norm(s);
  const re = new RegExp("^" + parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?") + "$");
  return re.test(norm(s));
}

// ------------------------------------------------------------- Reply.io step ---

export interface ReplyStep {
  id?: number | string;
  type?: string;
  variants?: Array<{ id?: number | string; subject?: string | null }>;
}
export interface ThreadMessage {
  isOutbound?: boolean;
  date?: string;
  subject?: string | null;
}
export interface StepMatch {
  sequence_step_number: number;
  step_source: "variant_match" | "thread_outbound_count" | "smartlead_stats";
  variant_id?: string;
  variant_match?: "subject_match" | "exact_single_variant";
}

/** Outbound messages strictly before the reply, oldest first. */
export function outboundBefore(messages: ThreadMessage[], repliedAt: string): ThreadMessage[] {
  const r = new Date(repliedAt).getTime();
  return messages
    .filter((m) => m.isOutbound && m.date && new Date(m.date).getTime() <= r)
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());
}

/**
 * Which sequence step was the prospect replying to?
 *  1. the last outbound subject matches exactly one step's variant subject →
 *     that step ('variant_match'); several steps share the subject → the one at
 *     position = outbound count, if it is among them
 *  2. else the number of outbound messages before the reply
 *     ('thread_outbound_count')
 * Steps are numbered by position (1-based), as sync-reply-sequences does.
 * Within the step: one variant → 'exact_single_variant'; several → the one
 * whose subject matches ('subject_match').
 */
export function matchReplyStep(steps: ReplyStep[], outbound: ThreadMessage[]): StepMatch | null {
  const count = outbound.length;
  const lastSubject = outbound.length ? outbound[outbound.length - 1].subject ?? null : null;
  // Follow-ups in the same thread are usually "Re: <first subject>": match on
  // the last subject first, then on the thread's first subject.
  const candidatesFor = (subject: string | null) =>
    subject
      ? steps.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => (s.variants ?? []).some((v) => subjectMatches(v.subject, subject)))
      : [];
  let cands = candidatesFor(lastSubject);
  if (!cands.length && outbound.length) cands = candidatesFor(outbound[0].subject ?? null);

  let chosen: { s: ReplyStep; n: number } | null = null;
  if (cands.length === 1) chosen = cands[0];
  else if (cands.length > 1) chosen = cands.find((c) => c.n === count) ?? null;

  if (chosen) {
    const vs = chosen.s.variants ?? [];
    const out: StepMatch = { sequence_step_number: chosen.n, step_source: "variant_match" };
    if (vs.length === 1 && vs[0].id !== undefined) {
      out.variant_id = String(vs[0].id);
      out.variant_match = "exact_single_variant";
    } else {
      const v = vs.filter((x) => subjectMatches(x.subject, lastSubject) || subjectMatches(x.subject, outbound[0]?.subject));
      if (v.length === 1 && v[0].id !== undefined) {
        out.variant_id = String(v[0].id);
        out.variant_match = "subject_match";
      }
    }
    return out;
  }
  if (count > 0) {
    const out: StepMatch = { sequence_step_number: count, step_source: "thread_outbound_count" };
    const s = steps[count - 1];
    if (s && (s.variants ?? []).length === 1 && s.variants![0].id !== undefined) {
      out.variant_id = String(s.variants![0].id);
      out.variant_match = "exact_single_variant";
    }
    return out;
  }
  return null;
}

// ------------------------------------------------------------ Smartlead step ---

export interface SmartleadStat {
  stats_id?: string | number | null;
  lead_email?: string | null;
  sequence_number?: number | null;
  sent_time?: string | null;
  reply_time?: string | null;
  email_subject?: string | null;
  lead_category?: string | null;
  seq_variant_id?: string | number | null;
  email_campaign_seq_id?: string | number | null;
}

/**
 * The statistics row of the email the prospect replied to: by stats id (what
 * the webhook stores as provider_thread_id), else the lead's latest send
 * before the reply.
 */
export function pickSmartleadStat(rows: SmartleadStat[], statsId: string | null, email: string | null, repliedAt: string): SmartleadStat | null {
  if (statsId) {
    const hit = rows.find((r) => r.stats_id !== null && r.stats_id !== undefined && String(r.stats_id) === statsId);
    if (hit) return hit;
  }
  if (!email) return null;
  const r = new Date(repliedAt).getTime();
  const mine = rows
    .filter((x) => (x.lead_email ?? "").trim().toLowerCase() === email && x.sent_time && new Date(x.sent_time).getTime() <= r)
    .sort((a, b) => new Date(b.sent_time!).getTime() - new Date(a.sent_time!).getTime());
  return mine[0] ?? null;
}

export function smartleadStepKeys(stat: SmartleadStat): { meta: Record<string, unknown>; copy: string | null; subject: string | null } {
  const meta: Record<string, unknown> = {};
  if (typeof stat.sequence_number === "number") {
    meta.sequence_step_number = stat.sequence_number;
    meta.step_source = "smartlead_stats";
  }
  const variant = stat.seq_variant_id !== null && stat.seq_variant_id !== undefined ? String(stat.seq_variant_id) : null;
  const seqId = stat.email_campaign_seq_id !== null && stat.email_campaign_seq_id !== undefined ? String(stat.email_campaign_seq_id) : null;
  if (variant) meta.variant_id = variant;
  if (seqId) meta.email_campaign_seq_id = Number.isFinite(Number(seqId)) ? Number(seqId) : seqId;
  if (clean(stat.lead_category)) meta.platform_category = clean(stat.lead_category);
  return { meta, copy: variant ?? seqId, subject: clean(stat.email_subject) };
}

// --------------------------------------------------------------- Apollo map ---

// deno-lint-ignore no-explicit-any
export function apolloPersonFields(raw: any): { person: Record<string, unknown>; org: Record<string, unknown> } | null {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const o = raw.organization ?? {};
  const keywords = Array.isArray(o.keywords) ? o.keywords.filter((k: unknown) => typeof k === "string" && k.trim()) : null;
  const person = {
    job_title: clean(raw.title),
    seniority: normalizeSeniority(raw.seniority),
    department: Array.isArray(raw.departments) && raw.departments.length ? clean(raw.departments[0]) : null,
    headline: clean(raw.headline),
    city: clean(raw.city),
    state: clean(raw.state),
    country: clean(raw.country),
    time_zone: clean(raw.time_zone),
    linkedin_url: clean(raw.linkedin_url),
  };
  const org = {
    company_name: clean(o.name),
    industry: clean(o.industry),
    employees: typeof o.estimated_num_employees === "number" ? o.estimated_num_employees : null,
    revenue: clean(o.organization_revenue_printed),
    founded_year: o.founded_year !== null && o.founded_year !== undefined ? String(o.founded_year) : null,
    company_domain: clean(o.primary_domain),
    company_linkedin: clean(o.linkedin_url),
    company_keywords: keywords && keywords.length ? keywords : null,
    city: clean(o.city),
    state: clean(o.state),
    country: clean(o.country),
  };
  return { person, org };
}

/** Fields that justify an Apollo call when still missing after the free sources. */
export const APOLLO_WORTHY = ["job_title", "seniority", "industry", "company_size", "country"] as const;
