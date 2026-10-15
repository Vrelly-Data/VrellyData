// The run: fill order, never re-matching Apollo, the daily cap, Apollo's 422,
// classified rows following their reply, retries with backoff.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ApolloResult, type ApplyRow, type EnrichDeps, type FreeData, type LogRow, PermanentError, parseLocation,
  type QueueRow, runEnrichment, type SiblingRow, TransientError,
} from "./enrich.ts";

const NOW = Date.parse("2026-10-14T20:00:00Z");
const TEAM = "team-1";

const row = (id: string, extra: Partial<QueueRow> = {}): QueueRow => ({
  id, team_id: TEAM, source: "poll_reply_inbox", event_type: "replied", channel: "email", person_key: `${id}@acme.io`,
  email: `${id}@acme.io`, linkedin_url: null, full_name: "Ann Lee", company_name: "Acme", job_title: null, seniority: null,
  department: null, industry: null, city: null, state: null, country: null, company_size: null, campaign_external_id: null,
  campaign_name: null, subject: null, copy_fingerprint: null, occurred_at: "2026-10-13T15:30:00Z",
  metadata: { provider: "reply_io", provider_thread_id: `t-${id}` }, intent: "interested", priority: 0, ...extra,
});

const emptyFree = (): FreeData => ({ inference: {}, apollo_tried: false, people: {}, synced: {}, prospect: {}, apollo_cache: null });

interface World {
  free?: Record<string, Partial<FreeData>>;
  thread?: (id: string) => Record<string, unknown>;
  threadError?: Error;
  apollo?: (d: Array<Record<string, string>>) => ApolloResult;
  creditsToday?: number;
  siblings?: Map<string, SiblingRow>;
}

function deps(w: World) {
  const applied: ApplyRow[] = [];
  const logs: LogRow[] = [];
  const apolloCalls: Array<Array<Record<string, string>>> = [];
  const d: EnrichDeps = {
    now: () => NOW,
    freeLookups: (rows) => Promise.resolve(Object.fromEntries(rows.map((r) => [r.id, { ...emptyFree(), ...(w.free?.[r.id] ?? {}) }]))),
    stateTz: () => Promise.resolve(new Map([["texas", "America/Chicago"], ["tx", "America/Chicago"]])),
    integration: () => Promise.resolve({ apiKey: "k", replyTeamId: "1" }),
    replyThread: (_i, id) => (w.threadError ? Promise.reject(w.threadError) : Promise.resolve(w.thread?.(id) ?? {
      sequence: { id: 55, name: "Seq A" }, category: { name: "Interested" }, contact: { id: 9, title: "CFO", companyName: "Acme" },
    })),
    replyMessages: () => Promise.resolve([
      { isOutbound: true, date: "2026-10-12T13:00:00Z", subject: "Quick question, Ann" },
      { isOutbound: false, date: "2026-10-13T15:30:00Z", subject: "Re: Quick question, Ann" },
    ]),
    replySequence: () => Promise.resolve([{ id: 1, variants: [{ id: 101, subject: "Quick question, {{FirstName}}" }] }]),
    smartleadReplied: () => Promise.resolve([]),
    heyreachAccount: () => Promise.resolve(null),
    heyreachChatroom: () => Promise.resolve({}),
    siblings: () => Promise.resolve(w.siblings ?? new Map()),
    apolloCreditsToday: () => Promise.resolve(w.creditsToday ?? 0),
    apolloMatch: (details) => {
      apolloCalls.push(details);
      return Promise.resolve(w.apollo ? w.apollo(details) : { matches: details.map(() => null), credits: 0, insufficient: false, error: null });
    },
    apply: (rows) => {
      applied.push(...rows);
      return Promise.resolve(rows.length);
    },
    log: (rows) => {
      logs.push(...rows);
      return Promise.resolve();
    },
  };
  return { d, applied, logs, apolloCalls };
}
const opts = { apolloDailyCap: 300, deadlineMs: NOW + 100_000 };

const apolloPerson = (title: string) => ({
  id: "p1", title, seniority: "vp", departments: ["master_finance"], headline: `${title} at Acme`, city: "Austin", state: "Texas",
  country: "United States", time_zone: "America/Chicago", linkedin_url: "https://linkedin.com/in/ann",
  organization: { name: "Acme", industry: "Software", estimated_num_employees: 120, organization_revenue_printed: "12M", founded_year: 2010, primary_domain: "acme.io", keywords: ["saas"] },
});

Deno.test("Reply.io row: step, copy, timing, ET hours, provider fields, enriched_at + version", async () => {
  const { d, applied } = deps({});
  const s = await runEnrichment([row("a")], d, opts);
  assertEquals([s.enriched, s.errors], [1, 0]);
  const a = applied[0];
  assertEquals(a.fill.sequence_step_number, 1);
  assertEquals(a.fill.step_source, "variant_match");
  assertEquals(a.fill.variant_id, "101");
  assertEquals(a.fill.platform_category, "Interested");
  assertEquals(a.fill.emails_before_reply, 1);
  assertEquals([a.fill.send_hour_et, a.fill.send_dow_et, a.fill.reply_hour_et, a.fill.reply_dow_et, a.fill.hours_to_reply], [9, 1, 11, 2, 26.5]);
  assertEquals(a.cols.copy_fingerprint, "101");
  assertEquals(a.cols.campaign_external_id, "55");
  assertEquals(a.cols.job_title, "CFO");
  assertEquals(a.set.enrichment_version, 1);
  assert(typeof a.set.enriched_at === "string");
});

Deno.test("fill order: the row's own value, then other inference rows, people, synced, prospects; provider after; Apollo last", async () => {
  const { d, applied, apolloCalls } = deps({
    free: { a: { inference: { industry: "Banking" }, people: { industry: "Retail", job_title: "VP Finance", company_size: "51-200", seniority: "vp" }, prospect: { country: "USA", state: "TX" } } },
  });
  await runEnrichment([row("a", { job_title: "Founder" })], d, opts);
  const c = applied[0].cols;
  assertEquals([c.job_title, c.industry, c.company_size, c.country, c.state], ["Founder", "Banking", "51-200", "United States", "Texas"]);
  assertEquals(applied[0].fill.tz_basis, "state");
  assertEquals(applied[0].fill.tz_effective, "America/Chicago");
  assertEquals(apolloCalls.length, 0, "nothing important missing → no Apollo");
});

Deno.test("Apollo: only for missing fields; never for someone already tried; one record per person; 10 per call", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`p${i}`));
  rows.push(row("dup", { person_key: "p0@acme.io", email: "p0@acme.io" }));
  rows.push(row("tried"));
  const { d, applied, apolloCalls } = deps({
    free: { tried: { apollo_tried: true } },
    apollo: (det) => ({ matches: det.map(() => apolloPerson("CFO")), credits: det.length, insufficient: false, error: null }),
  });
  const s = await runEnrichment(rows, d, opts);
  assertEquals(apolloCalls.map((c) => c.length), [10, 2]);
  assertEquals([s.apollo_records, s.apollo_matched, s.apollo_credits], [12, 12, 12]);
  const dup = applied.find((a) => a.id === "dup")!;
  assertEquals(dup.fill.apollo_matched, true, "same person shares the one match");
  assertEquals(dup.cols.industry, "Software");
  assertEquals(dup.fill.revenue, "12M");
  assertEquals(dup.fill.founded_year, "2010");
  assertEquals(dup.cols.company_size, "51-200");
  const tried = applied.find((a) => a.id === "tried")!;
  assertEquals(tried.fill.apollo_matched, undefined);
  assert(!apolloCalls.flat().some((x) => x.email === "tried@acme.io"));
});

Deno.test("Apollo 422 insufficient credits: stop Apollo for the run, still save the free data, no row fails", async () => {
  const rows = Array.from({ length: 15 }, (_, i) => row(`p${i}`));
  const { d, applied, logs, apolloCalls } = deps({
    free: { p3: { people: { industry: "Retail" } } },
    apollo: (det) => ({ matches: det.map(() => null), credits: 0, insufficient: true, error: null }),
  });
  const s = await runEnrichment(rows, d, opts);
  assertEquals(apolloCalls.length, 1);
  assertEquals([s.apollo_insufficient_credits, s.enriched, s.errors], [true, 15, 0]);
  assert(logs.some((l) => l.step === "apollo" && l.status === "apollo_insufficient_credits"));
  assertEquals(applied.find((a) => a.id === "p3")!.cols.industry, "Retail");
  assertEquals(applied.find((a) => a.id === "p3")!.fill.apollo_matched, undefined, "not tried → may be tried later");
});

Deno.test("Apollo daily cap: never past the cap across runs", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(`p${i}`));
  const { d, apolloCalls, logs } = deps({
    creditsToday: 295,
    apollo: (det) => ({ matches: det.map(() => apolloPerson("CFO")), credits: det.length, insufficient: false, error: null }),
  });
  const s = await runEnrichment(rows, d, opts);
  assertEquals(apolloCalls.map((c) => c.length), [5]);
  assertEquals(s.apollo_cap_reached, true);
  assert(logs.some((l) => l.status === "daily_cap_reached"));
});

Deno.test("transient provider error → retry with backoff, 'failed' after 5; permanent → step skipped, row still enriched", async () => {
  const t = deps({ threadError: new TransientError("reply.io thread HTTP 429") });
  await runEnrichment([row("a", { metadata: { provider: "reply_io", provider_thread_id: "t", enrichment_attempts: 1 } })], t.d, opts);
  assertEquals(t.applied[0].set.enrichment_attempts, 2);
  assertEquals(t.applied[0].set.enrichment_next_at, new Date(NOW + 10 * 60_000).toISOString());
  assertEquals(t.applied[0].set.enriched_at, undefined);

  const f = deps({ threadError: new TransientError("reply.io thread HTTP 503") });
  const s = await runEnrichment([row("a", { metadata: { provider: "reply_io", provider_thread_id: "t", enrichment_attempts: 4 } })], f.d, opts);
  assertEquals([f.applied[0].set.enrichment_status, s.failed], ["failed", 1]);

  const p = deps({ threadError: new PermanentError("reply.io thread HTTP 404") });
  await runEnrichment([row("a")], p.d, opts);
  assert(typeof p.applied[0].set.enriched_at === "string");
  assertEquals(p.applied[0].fill.reply_hour_et, 11);
  assert(p.logs.some((l) => l.step === "provider" && l.status === "skipped"));
});

Deno.test("classified rows take their reply's step/timing; wait while the reply is still queued", async () => {
  const reply = row("r");
  const cls = row("c", { source: "classify_reply", event_type: "classified", metadata: {} });
  const sib: SiblingRow = { id: "r", occurred_at: reply.occurred_at, metadata: {}, campaign_external_id: null, campaign_name: null, subject: null, copy_fingerprint: null };
  const { d, applied } = deps({ siblings: new Map([["c", sib]]) });
  await runEnrichment([reply, cls], d, opts);
  const c = applied.find((a) => a.id === "c")!;
  assertEquals([c.fill.sequence_step_number, c.fill.hours_to_reply, c.cols.copy_fingerprint], [1, 26.5, "101"]);

  const w = deps({ siblings: new Map([["c", sib]]) });
  const s = await runEnrichment([cls], w.d, opts);
  assertEquals([s.deferred, w.applied.length], [1, 0]);
});

Deno.test("HeyReach location strings", () => {
  assertEquals(parseLocation("Austin, Texas, United States"), { city: "Austin", state: "Texas", country: "United States" });
  assertEquals(parseLocation("Austin, TX"), { city: "Austin", state: "Texas", country: "United States" });
  assertEquals(parseLocation("London, United Kingdom"), { city: "London", country: "United Kingdom" });
  assertEquals(parseLocation(null), {});
});
