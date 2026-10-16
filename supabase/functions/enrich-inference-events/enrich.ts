// One enrichment run over a queue of inference_events rows. All I/O is in
// EnrichDeps (see index.ts), so the order and the failure handling are
// unit-tested.
//
// Per row:
//   1. provider (sequence/copy + timing + provider contact fields)
//        Reply.io  GET /v3/inbox/threads/{id}, …/messages, /v3/sequences/{id}
//        Smartlead GET /campaigns/{id}/statistics (email_status=replied)
//        HeyReach  GET /inbox/GetChatroom/{account}/{conversation}
//   2. person/company, first non-empty value wins:
//        the row itself → the person's other inference rows → people →
//        synced_contacts → prospects → Apollo cache → provider contact →
//        Apollo bulk_match (only if fields are still missing, never for a
//        person Apollo was already tried on, ≤10 per call, daily cap)
//   3. geography: person → provider → Apollo person → Apollo org;
//      normalized country / US state; time zone keys
//   4. saved: metadata keys (never overwriting a key already on the row) +
//      empty columns; enriched_at, enrichment_version = 1
// 'classified' rows carry no provider ids: they take the step/timing/copy of
// the same person's 'replied' row (processed first, or already enriched).
//
// A transient provider failure (429 / 5xx / timeout) is a row error: the row is
// retried with backoff (5, 10, 20, 40 min) and marked 'failed' after 5. A
// permanent one (404, no key, no ids) only skips that step.
//
// Apollo order is priority (interested, other, not interested). When the daily
// cap or Apollo's credits run out, the rows still needing Apollo are NOT
// enriched: they get apollo_pending = true and enrichment_next_at = the next
// UTC midnight, and the queue takes apollo_pending rows at any age. Rows the
// run deadline cut off are left for the next run. Everyone else finishes.

import {
  apolloPersonFields, APOLLO_WORTHY, countryForState, matchReplyStep, normalizeCountry, normalizeSeniority,
  normalizeState, outboundBefore, pickSmartleadStat, type ReplyStep, type SmartleadStat, sizeBucket, smartleadStepKeys,
  type ThreadMessage, timeZoneKeys, timingKeys,
} from "./rules.ts";

export const ENRICHMENT_VERSION = 1;
export const MAX_ATTEMPTS = 5;
export const APOLLO_BATCH = 10;

export interface QueueRow {
  id: string;
  team_id: string | null;
  source: string;
  event_type: string;
  channel: string;
  person_key: string;
  email: string | null;
  linkedin_url: string | null;
  full_name: string | null;
  company_name: string | null;
  job_title: string | null;
  seniority: string | null;
  department: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  company_size: string | null;
  campaign_external_id: string | null;
  campaign_name: string | null;
  subject: string | null;
  copy_fingerprint: string | null;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
  intent: string | null;
  priority: number;
}

type Fields = Record<string, unknown>;
export interface FreeData {
  inference: Fields;
  apollo_tried: boolean;
  people: Fields;
  synced: Fields;
  prospect: Fields;
  apollo_cache: unknown;
}

export interface Integration { apiKey: string; replyTeamId: string | null }
export class TransientError extends Error {}
export class PermanentError extends Error {}

export interface ApolloResult {
  matches: unknown[];
  credits: number;
  insufficient: boolean;
  error: string | null;
}

export interface SiblingRow {
  id: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
  campaign_external_id: string | null;
  campaign_name: string | null;
  subject: string | null;
  copy_fingerprint: string | null;
}

export interface EnrichDeps {
  freeLookups(rows: QueueRow[]): Promise<Record<string, FreeData>>;
  stateTz(): Promise<Map<string, string>>;
  integration(teamId: string, platform: "reply.io" | "smartlead" | "heyreach"): Promise<Integration | null>;
  replyThread(i: Integration, threadId: string): Promise<Record<string, unknown>>;
  replyMessages(i: Integration, threadId: string): Promise<ThreadMessage[]>;
  replySequence(i: Integration, sequenceId: string): Promise<ReplyStep[]>;
  smartleadReplied(i: Integration, campaignId: string, sinceIso: string, wantStatsIds: Set<string>): Promise<SmartleadStat[]>;
  heyreachAccount(conversationId: string): Promise<string | null>;
  heyreachChatroom(i: Integration, accountId: string, conversationId: string): Promise<Record<string, unknown>>;
  siblings(rows: QueueRow[]): Promise<Map<string, SiblingRow>>;
  apolloCreditsToday(): Promise<number>;
  apolloMatch(details: Array<Record<string, string>>): Promise<ApolloResult>;
  apply(rows: ApplyRow[]): Promise<number>;
  log(rows: LogRow[]): Promise<void>;
  now(): number;
}

export interface ApplyRow { id: string; fill: Fields; set: Fields; cols: Fields }
export interface LogRow { event_id: string | null; step: string; status: string; error?: string | null; credits?: number }

export interface RunOptions { apolloDailyCap: number; deadlineMs: number }

export interface RunSummary {
  queued: number;
  enriched: number;
  deferred: number;
  errors: number;
  failed: number;
  apollo_records: number;
  apollo_matched: number;
  apollo_credits: number;
  apollo_insufficient_credits: boolean;
  apollo_cap_reached: boolean;
  /** Rows left for Apollo after the next UTC midnight (cap or credits ran out). */
  apollo_deferred: number;
}

/** The next UTC midnight after `ms`, when the daily Apollo cap resets. */
export function nextUtcMidnight(ms: number): string {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export function platformOf(row: Pick<QueueRow, "source" | "metadata">): "reply_io" | "smartlead" | "heyreach" | null {
  const p = text(row.metadata?.provider);
  if (p === "reply_io" || p === "smartlead" || p === "heyreach") return p;
  if (row.source === "poll_reply_inbox" || row.source === "reply_webhook") return "reply_io";
  if (row.source === "smartlead_webhook") return "smartlead";
  if (row.source === "heyreach_webhook") return "heyreach";
  return null;
}

interface ProviderOut {
  meta: Fields;
  cols: Fields;
  person: Fields; // provider contact fields (title, company, location …)
}

async function providerStep(row: QueueRow, deps: EnrichDeps, cache: Map<string, unknown>): Promise<ProviderOut> {
  const out: ProviderOut = { meta: {}, cols: {}, person: {} };
  const platform = platformOf(row);
  const md = row.metadata ?? {};
  if (!platform) throw new PermanentError("no provider for this source");
  if (!row.team_id) throw new PermanentError("row has no team");

  if (platform === "reply_io") {
    const threadId = text(md.provider_thread_id);
    if (!threadId) throw new PermanentError("no provider_thread_id");
    const integ = await deps.integration(row.team_id, "reply.io");
    if (!integ) throw new PermanentError("no active Reply.io integration for the team");
    // deno-lint-ignore no-explicit-any
    const thread: any = await deps.replyThread(integ, threadId);
    const messages = await deps.replyMessages(integ, threadId);
    const outbound = outboundBefore(messages, row.occurred_at);
    const seqId = text(thread?.sequence?.id);
    if (seqId) {
      out.cols.campaign_external_id = seqId;
      if (text(thread?.sequence?.name)) out.cols.campaign_name = text(thread.sequence.name);
      const key = `reply:${integ.replyTeamId ?? ""}:seq:${seqId}`;
      let steps = cache.get(key) as ReplyStep[] | undefined;
      if (!steps) {
        steps = await deps.replySequence(integ, seqId);
        cache.set(key, steps);
      }
      const m = matchReplyStep(steps, outbound);
      if (m) {
        out.meta.sequence_step_number = m.sequence_step_number;
        out.meta.step_source = m.step_source;
        if (m.variant_id) {
          out.meta.variant_id = m.variant_id;
          out.cols.copy_fingerprint = m.variant_id;
        }
        if (m.variant_match) out.meta.variant_match = m.variant_match;
      }
    } else if (outbound.length) {
      out.meta.sequence_step_number = outbound.length;
      out.meta.step_source = "thread_outbound_count";
    }
    out.meta.emails_before_reply = outbound.length;
    if (text(thread?.category?.name)) out.meta.platform_category = text(thread.category.name);
    if (text(thread?.contact?.id)) out.meta.provider_contact_id = text(thread.contact.id);
    const last = outbound[outbound.length - 1];
    const subj = text(last?.subject) ?? text(outbound[0]?.subject) ?? text(thread?.subject);
    if (subj) out.cols.subject = subj;
    Object.assign(out.meta, timingKeys(last?.date ?? null, row.occurred_at));
    out.person = {
      job_title: text(thread?.contact?.title),
      company_name: text(thread?.contact?.companyName),
      linkedin_url: text(thread?.contact?.linkedInProfileUrl),
    };
    return out;
  }

  if (platform === "smartlead") {
    const campaignId = text(row.campaign_external_id);
    if (!campaignId) throw new PermanentError("no campaign_external_id");
    const integ = await deps.integration(row.team_id, "smartlead");
    if (!integ) throw new PermanentError("no active Smartlead integration for the team");
    const statsId = text(md.provider_thread_id);
    const key = `smartlead:${campaignId}`;
    let rows = cache.get(key) as SmartleadStat[] | undefined;
    if (!rows) {
      const want = (cache.get(`${key}:want`) as Set<string> | undefined) ?? new Set(statsId ? [statsId] : []);
      const since = (cache.get(`${key}:since`) as string | undefined) ?? new Date(new Date(row.occurred_at).getTime() - 60 * 86_400_000).toISOString();
      rows = await deps.smartleadReplied(integ, campaignId, since, want);
      cache.set(key, rows);
    }
    const stat = pickSmartleadStat(rows, statsId, text(row.email)?.toLowerCase() ?? null, row.occurred_at);
    if (stat) {
      const k = smartleadStepKeys(stat);
      Object.assign(out.meta, k.meta);
      if (k.copy) out.cols.copy_fingerprint = k.copy;
      if (k.subject) out.cols.subject = k.subject;
      Object.assign(out.meta, timingKeys(text(stat.sent_time), row.occurred_at));
    } else {
      Object.assign(out.meta, timingKeys(null, row.occurred_at));
    }
    return out;
  }

  // heyreach
  const conv = text(md.conversation_id) ?? text(md.provider_thread_id);
  if (!conv) throw new PermanentError("no conversation id");
  const integ = await deps.integration(row.team_id, "heyreach");
  if (!integ) throw new PermanentError("no active HeyReach integration for the team");
  const account = await deps.heyreachAccount(conv);
  if (!account) throw new PermanentError("no HeyReach account for the conversation");
  // deno-lint-ignore no-explicit-any
  const room: any = await deps.heyreachChatroom(integ, account, conv);
  const msgs: ThreadMessage[] = (Array.isArray(room?.messages) ? room.messages : []).map((m: Record<string, unknown>) => ({
    isOutbound: m.sender === "ME",
    date: text(m.createdAt) ?? undefined,
  }));
  const outbound = outboundBefore(msgs, row.occurred_at);
  if (outbound.length) {
    out.meta.sequence_step_number = outbound.length;
    out.meta.step_source = "thread_outbound_count";
  }
  out.meta.emails_before_reply = outbound.length;
  if (text(md.lead_category)) out.meta.platform_category = text(md.lead_category);
  Object.assign(out.meta, timingKeys(outbound[outbound.length - 1]?.date ?? null, row.occurred_at));
  const prof = room?.correspondentProfile ?? room?.leadProfile ?? {};
  const loc = parseLocation(text(prof?.location));
  out.person = {
    job_title: text(prof?.position),
    headline: text(prof?.headline) ?? text(prof?.summary),
    company_name: text(prof?.companyName),
    linkedin_url: text(prof?.profileUrl),
    ...loc,
  };
  return out;
}

/** "Austin, Texas, United States" / "Austin, TX" / "Greater London, England, United Kingdom". */
export function parseLocation(v: string | null): Fields {
  if (!v) return {};
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return { city: parts[0], state: parts[parts.length - 2], country: parts[parts.length - 1] };
  if (parts.length === 2) {
    const c = normalizeCountry(parts[1]);
    const st = normalizeState(parts[1], null);
    if (st && countryForState(st)) return { city: parts[0], state: st, country: "United States" };
    return { city: parts[0], country: c };
  }
  const st = normalizeState(parts[0], null);
  if (st && countryForState(st)) return { state: st, country: "United States" };
  return { country: normalizeCountry(parts[0]) };
}

const PERSON_KEYS = [
  "job_title", "seniority", "department", "industry", "company_size", "company_name", "linkedin_url",
  "headline", "employees", "revenue", "founded_year", "company_domain", "company_linkedin", "company_keywords",
] as const;
const GEO_KEYS = ["city", "state", "country"] as const;

function firstFill(target: Fields, src: Fields | null | undefined, keys: readonly string[]) {
  if (!src) return;
  for (const k of keys) if (isEmpty(target[k]) && !isEmpty(src[k])) target[k] = src[k];
}

function stillMissing(v: Fields): boolean {
  return APOLLO_WORTHY.some((k) => isEmpty(v[k]));
}

/** The whole run. */
export async function runEnrichment(queue: QueueRow[], deps: EnrichDeps, opts: RunOptions): Promise<RunSummary> {
  const summary: RunSummary = {
    queued: queue.length, enriched: 0, deferred: 0, errors: 0, failed: 0, apollo_records: 0, apollo_matched: 0,
    apollo_credits: 0, apollo_insufficient_credits: false, apollo_cap_reached: false, apollo_deferred: 0,
  };
  if (!queue.length) return summary;
  const logs: LogRow[] = [];
  const cache = new Map<string, unknown>();
  const stateTz = await deps.stateTz();
  const free = await deps.freeLookups(queue);

  // Smartlead: one statistics walk per campaign, for every stats id this run needs.
  for (const r of queue) {
    if (platformOf(r) !== "smartlead" || !r.campaign_external_id) continue;
    const key = `smartlead:${r.campaign_external_id}`;
    const want = (cache.get(`${key}:want`) as Set<string>) ?? new Set<string>();
    const sid = text(r.metadata?.provider_thread_id);
    if (sid) want.add(sid);
    cache.set(`${key}:want`, want);
    const since = new Date(new Date(r.occurred_at).getTime() - 60 * 86_400_000).toISOString();
    const prev = cache.get(`${key}:since`) as string | undefined;
    if (!prev || since < prev) cache.set(`${key}:since`, since);
  }

  interface Staged { row: QueueRow; meta: Fields; cols: Fields; values: Fields; provider: Fields; apolloTz: string | null }
  const staged: Staged[] = [];
  const replied = queue.filter((r) => r.event_type !== "classified");
  const classified = queue.filter((r) => r.event_type === "classified");

  const fail = (row: QueueRow, e: unknown) => {
    const attempts = Number(row.metadata?.enrichment_attempts ?? 0) + 1;
    const set: Fields = { enrichment_attempts: attempts, enrichment_error: errMsg(e) };
    if (attempts >= MAX_ATTEMPTS) {
      set.enrichment_status = "failed";
      summary.failed++;
    } else {
      set.enrichment_next_at = new Date(deps.now() + 5 * 60_000 * 2 ** (attempts - 1)).toISOString();
    }
    summary.errors++;
    logs.push({ event_id: row.id, step: "row", status: attempts >= MAX_ATTEMPTS ? "failed" : "error", error: errMsg(e) });
    return { id: row.id, fill: {}, set, cols: {} } as ApplyRow;
  };
  const errorRows: ApplyRow[] = [];

  const baseValues = (row: QueueRow): Fields => {
    const v: Fields = {
      job_title: row.job_title, seniority: row.seniority, department: row.department, industry: row.industry,
      company_size: row.company_size, company_name: row.company_name, linkedin_url: row.linkedin_url,
      city: row.city, state: row.state, country: row.country,
    };
    for (const k of PERSON_KEYS) if (isEmpty(v[k]) && !isEmpty(row.metadata?.[k])) v[k] = row.metadata![k];
    const f = free[row.id];
    for (const src of [f?.inference, f?.people, f?.synced, f?.prospect]) {
      firstFill(v, src, PERSON_KEYS);
      firstFill(v, src, GEO_KEYS);
    }
    const cached = f?.apollo_cache ? apolloPersonFields(f.apollo_cache) : null;
    if (cached) {
      firstFill(v, cached.person, PERSON_KEYS);
      firstFill(v, cached.org, PERSON_KEYS);
    }
    return v;
  };

  // ---- 1. replied rows: provider + free
  for (const row of replied) {
    if (deps.now() > opts.deadlineMs) {
      summary.deferred++;
      continue;
    }
    let prov: ProviderOut = { meta: {}, cols: {}, person: {} };
    try {
      prov = await providerStep(row, deps, cache);
      logs.push({ event_id: row.id, step: "provider", status: "ok" });
    } catch (e) {
      if (e instanceof PermanentError) {
        logs.push({ event_id: row.id, step: "provider", status: "skipped", error: errMsg(e) });
        prov.meta = timingKeys(null, row.occurred_at);
      } else {
        errorRows.push(fail(row, e));
        continue;
      }
    }
    const values = baseValues(row);
    const f = free[row.id];
    const cachedTz = f?.apollo_cache ? apolloPersonFields(f.apollo_cache)?.person.time_zone : null;
    staged.push({
      row, meta: prov.meta, cols: prov.cols, values, provider: prov.person,
      apolloTz: text(f?.inference?.time_zone) ?? text(cachedTz),
    });
  }

  // ---- 2. classified rows: copy the sibling reply's step / timing / copy
  const sib = classified.length ? await deps.siblings(classified) : new Map<string, SiblingRow>();
  const stagedById = new Map(staged.map((s) => [s.row.id, s]));
  const SIBLING_KEYS = [
    "sequence_step_number", "step_source", "variant_id", "variant_match", "emails_before_reply", "platform_category",
    "provider_contact_id", "sent_at", "replied_at", "hours_to_reply", "send_hour_et", "send_dow_et", "reply_hour_et",
    "reply_dow_et", "email_campaign_seq_id",
  ];
  const queuedIds = new Set(queue.map((r) => r.id));
  for (const row of classified) {
    if (deps.now() > opts.deadlineMs) {
      summary.deferred++;
      continue;
    }
    const s = sib.get(row.id);
    const fromRun = s ? stagedById.get(s.id) : undefined;
    // The reply is still waiting (queued but not processed this run, or not enriched yet): wait for it.
    const sibInWindow = s ? deps.now() - new Date(s.occurred_at).getTime() < 30 * 86_400_000 : false;
    // The reply waits for Apollo until a later time: wait with it instead of re-queuing every run.
    const sibNext = Date.parse(String(s?.metadata?.enrichment_next_at ?? ""));
    if (s && !fromRun && !s.metadata?.enriched_at && Number.isFinite(sibNext) && sibNext > deps.now()) {
      summary.deferred++;
      errorRows.push({ id: row.id, fill: {}, set: { enrichment_next_at: new Date(sibNext).toISOString() }, cols: {} });
      logs.push({ event_id: row.id, step: "sibling", status: "deferred" });
      continue;
    }
    if (s && !fromRun && !s.metadata?.enriched_at && s.metadata?.enrichment_status !== "failed" && (queuedIds.has(s.id) || sibInWindow)) {
      summary.deferred++;
      logs.push({ event_id: row.id, step: "sibling", status: "deferred" });
      continue;
    }
    const meta: Fields = {};
    const cols: Fields = {};
    const sm = fromRun ? fromRun.meta : (s?.metadata ?? {});
    for (const k of SIBLING_KEYS) if (!isEmpty(sm[k])) meta[k] = sm[k];
    const sc = fromRun ? fromRun.cols : (s ?? {}) as Fields;
    for (const k of ["campaign_external_id", "campaign_name", "subject", "copy_fingerprint"]) if (!isEmpty(sc[k])) cols[k] = sc[k];
    if (!s) Object.assign(meta, timingKeys(null, row.occurred_at));
    logs.push({ event_id: row.id, step: "sibling", status: s ? "copied" : "none" });
    const f = free[row.id];
    const cachedTz = f?.apollo_cache ? apolloPersonFields(f.apollo_cache)?.person.time_zone : null;
    staged.push({
      row, meta, cols, values: baseValues(row), provider: fromRun?.provider ?? {},
      apolloTz: text(f?.inference?.time_zone) ?? text(cachedTz),
    });
  }

  // ---- 3. provider contact fields, then Apollo for what is still missing
  for (const s of staged) {
    firstFill(s.values, s.provider, PERSON_KEYS);
  }
  const apolloFor = new Map<string, { details: Record<string, string>; rows: Staged[] }>();
  for (const s of staged) {
    const f = free[s.row.id];
    if (f?.apollo_tried || s.row.metadata?.apollo_matched !== undefined) continue;
    if (!stillMissing(s.values)) continue;
    const email = text(s.row.email);
    const li = text(s.values.linkedin_url) ?? text(s.row.linkedin_url);
    if (!email && !li) continue;
    const pk = `${s.row.team_id ?? ""}|${s.row.person_key}`;
    const ent = apolloFor.get(pk);
    if (ent) {
      ent.rows.push(s);
      continue;
    }
    const d: Record<string, string> = {};
    if (email) d.email = email;
    if (li) d.linkedin_url = li;
    if (text(s.row.full_name)) d.name = text(s.row.full_name)!;
    if (text(s.values.company_name)) d.organization_name = text(s.values.company_name)!;
    if (text(s.values.company_domain)) d.domain = text(s.values.company_domain)!;
    apolloFor.set(pk, { details: d, rows: [s] });
  }
  const apolloOrg = new Map<string, Fields>();
  // Rows Apollo did not reach: id → enrichment_next_at (null = just the next run).
  const apolloWait = new Map<string, string | null>();
  if (apolloFor.size) {
    let used = await deps.apolloCreditsToday();
    const prio = (p: { rows: Staged[] }) => Math.min(...p.rows.map((s) => s.row.priority ?? 1));
    const people = [...apolloFor.values()].sort((a, b) => prio(a) - prio(b)); // stable: queue order within a priority
    let stopAt = -1;
    let until: string | null = null;
    for (let i = 0; i < people.length;) {
      if (deps.now() > opts.deadlineMs) {
        stopAt = i;
        break;
      }
      const left = opts.apolloDailyCap - used;
      if (left <= 0) {
        summary.apollo_cap_reached = true;
        logs.push({ event_id: null, step: "apollo", status: "daily_cap_reached" });
        [stopAt, until] = [i, nextUtcMidnight(deps.now())];
        break;
      }
      const batch = people.slice(i, i + Math.min(APOLLO_BATCH, left));
      i += batch.length;
      let res: ApolloResult;
      try {
        res = await deps.apolloMatch(batch.map((b) => b.details));
      } catch (e) {
        logs.push({ event_id: null, step: "apollo", status: "error", error: errMsg(e) });
        continue;
      }
      if (res.insufficient) {
        summary.apollo_insufficient_credits = true;
        logs.push({ event_id: null, step: "apollo", status: "apollo_insufficient_credits" });
        [stopAt, until] = [i - batch.length, nextUtcMidnight(deps.now())];
        break;
      }
      if (res.error) {
        logs.push({ event_id: null, step: "apollo", status: "error", error: res.error });
        continue;
      }
      used += res.credits;
      summary.apollo_credits += res.credits;
      summary.apollo_records += batch.length;
      batch.forEach((b, k) => {
        const m = apolloPersonFields(res.matches[k]);
        if (m) summary.apollo_matched++;
        for (const s of b.rows) {
          s.meta.apollo_matched = !!m;
          if (m) {
            firstFill(s.values, m.person, PERSON_KEYS);
            firstFill(s.values, m.org, PERSON_KEYS);
            firstFill(s.provider, m.person, GEO_KEYS); // Apollo person geography after the provider's
            apolloOrg.set(s.row.id, m.org);
            if (!s.apolloTz && text(m.person.time_zone)) s.apolloTz = text(m.person.time_zone);
          }
        }
        logs.push({
          event_id: b.rows[0].row.id, step: "apollo", status: m ? "matched" : "no_match",
          credits: k === 0 ? res.credits : 0,
        });
      });
    }
    if (stopAt >= 0) for (const p of people.slice(stopAt)) for (const s of p.rows) apolloWait.set(s.row.id, until);
  }

  // ---- 4. geography, time zone, save
  const applyRows: ApplyRow[] = [...errorRows];
  for (const s of staged) {
    if (apolloWait.has(s.row.id)) {
      const next = apolloWait.get(s.row.id);
      if (next) {
        applyRows.push({ id: s.row.id, fill: {}, set: { apollo_pending: true, enrichment_next_at: next }, cols: {} });
        logs.push({ event_id: s.row.id, step: "apollo", status: "deferred" });
        summary.apollo_deferred++;
      } else {
        summary.deferred++;
      }
      continue;
    }
    const geo: Fields = { city: s.values.city, state: s.values.state, country: s.values.country };
    firstFill(geo, s.provider, GEO_KEYS);
    firstFill(geo, apolloOrg.get(s.row.id), GEO_KEYS);
    let country = normalizeCountry(geo.country);
    const state = normalizeState(geo.state, country);
    if (!country) country = countryForState(state);
    const size = text(s.values.company_size) ?? sizeBucket(s.values.employees);

    const fill: Fields = { ...s.meta };
    for (const k of ["headline", "employees", "revenue", "founded_year", "company_domain", "company_linkedin", "company_keywords"]) {
      if (!isEmpty(s.values[k])) fill[k] = s.values[k];
    }
    Object.assign(fill, timeZoneKeys({ state, country, apolloTz: s.apolloTz }, stateTz));
    for (const k of Object.keys(fill)) if (fill[k] === null || fill[k] === undefined) delete fill[k];

    const cols: Fields = {
      ...s.cols,
      job_title: text(s.values.job_title),
      seniority: s.values.seniority ? normalizeSeniority(s.values.seniority) : null,
      department: text(s.values.department),
      industry: text(s.values.industry),
      company_size: size,
      company_name: text(s.values.company_name),
      linkedin_url: text(s.values.linkedin_url),
      city: text(geo.city),
      state,
      country,
    };
    if (cols.subject) cols.subject = String(cols.subject);
    for (const k of Object.keys(cols)) if (cols[k] === null || cols[k] === undefined) delete cols[k];

    applyRows.push({
      id: s.row.id, fill, cols,
      set: {
        enriched_at: new Date(deps.now()).toISOString(), enrichment_version: ENRICHMENT_VERSION,
        ...(s.row.metadata?.apollo_pending === true ? { apollo_pending: false } : {}),
      },
    });
    logs.push({ event_id: s.row.id, step: "done", status: "enriched" });
    summary.enriched++;
  }

  for (let i = 0; i < applyRows.length; i += 100) await deps.apply(applyRows.slice(i, i + 100));
  // Credits are counted on the 'apollo' rows only; the run row carries the summary.
  logs.push({ event_id: null, step: "run", status: "done", error: JSON.stringify(summary).slice(0, 500) });
  for (let i = 0; i < logs.length; i += 500) await deps.log(logs.slice(i, i + 500));
  return summary;
}

