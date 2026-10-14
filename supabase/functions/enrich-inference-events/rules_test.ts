// Formats must match the backfill rows exactly (checked on prod): ET hours and
// ISO weekdays, hours_to_reply to 2 decimals, tz_basis, full country / state
// names, step matching.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cleanSubject, hoursToReply, matchReplyStep, normalizeCountry, normalizeState, pickSmartleadStat, sizeBucket,
  smartleadStepKeys, subjectMatches, timeZoneKeys, timingKeys, zonedParts,
} from "./rules.ts";

Deno.test("ET: hour and ISO weekday in America/New_York, across DST", () => {
  // Mon 2026-10-12 13:30 UTC = 09:30 EDT (UTC-4)
  assertEquals(zonedParts("2026-10-12T13:30:00Z"), { hour: 9, dow: 1 });
  // Sun 2026-01-11 03:00 UTC = Sat 22:00 EST (UTC-5)
  assertEquals(zonedParts("2026-01-11T03:00:00Z"), { hour: 22, dow: 6 });
  // Sun 2026-10-18 16:00 UTC = 12:00 EDT
  assertEquals(zonedParts("2026-10-18T16:00:00Z"), { hour: 12, dow: 7 });
  // DST starts 2026-03-08 07:00 UTC: 06:59 UTC = 01:59 EST, 07:00 UTC = 03:00 EDT
  assertEquals(zonedParts("2026-03-08T06:59:00Z")?.hour, 1);
  assertEquals(zonedParts("2026-03-08T07:00:00Z")?.hour, 3);
  assertEquals(zonedParts("not a date"), null);
});

Deno.test("timing keys: backfill names; hours_to_reply 2 decimals; a send after the reply gives no hours", () => {
  assertEquals(hoursToReply("2026-10-12T13:00:00Z", "2026-10-12T14:20:00Z"), 1.33);
  assertEquals(hoursToReply("2026-10-12T13:00:00Z", "2026-10-12T13:00:20Z"), 0.01);
  assertEquals(hoursToReply("2026-10-12T15:00:00Z", "2026-10-12T14:00:00Z"), null);
  assertEquals(timingKeys("2026-10-12T13:00:00Z", "2026-10-13T15:30:00Z"), {
    replied_at: "2026-10-13T15:30:00Z", reply_hour_et: 11, reply_dow_et: 2,
    sent_at: "2026-10-12T13:00:00Z", send_hour_et: 9, send_dow_et: 1, hours_to_reply: 26.5,
  });
  assertEquals(timingKeys(null, "2026-10-13T15:30:00Z"), { replied_at: "2026-10-13T15:30:00Z", reply_hour_et: 11, reply_dow_et: 2 });
});

Deno.test("time zone: US state → 'state'; non-US with Apollo zone → 'apollo'; else 'unknown'", () => {
  const tz = new Map([["texas", "America/Chicago"], ["tx", "America/Chicago"], ["arizona", "America/Phoenix"]]);
  assertEquals(timeZoneKeys({ state: "Texas", country: "United States", apolloTz: "America/Chicago" }, tz),
    { time_zone: "America/Chicago", tz_effective: "America/Chicago", tz_basis: "state" });
  assertEquals(timeZoneKeys({ state: "Arizona", country: null, apolloTz: null }, tz),
    { tz_effective: "America/Phoenix", tz_basis: "state" });
  assertEquals(timeZoneKeys({ state: "England", country: "United Kingdom", apolloTz: "Europe/London" }, tz),
    { time_zone: "Europe/London", tz_effective: "Europe/London", tz_basis: "apollo" });
  // US with an Apollo zone but no usable state: the backfill left these 'unknown'
  assertEquals(timeZoneKeys({ state: null, country: "United States", apolloTz: "America/New_York" }, tz),
    { time_zone: "America/New_York", tz_basis: "unknown" });
  assertEquals(timeZoneKeys({ state: null, country: null, apolloTz: null }, tz), { tz_basis: "unknown" });
});

Deno.test("country normalization: US/USA → United States; UK, UAE; other names kept; casing fixed", () => {
  for (const v of ["US", "usa", "U.S.A.", "United States of America", " united states "]) assertEquals(normalizeCountry(v), "United States");
  assertEquals(normalizeCountry("UK"), "United Kingdom");
  assertEquals(normalizeCountry("UAE"), "United Arab Emirates");
  assertEquals(normalizeCountry("Germany"), "Germany");
  assertEquals(normalizeCountry("NEW ZEALAND"), "New Zealand");
  assertEquals(normalizeCountry(""), null);
  assertEquals(normalizeCountry(null), null);
});

Deno.test("state normalization: US codes and messy values → full names; non-US kept", () => {
  assertEquals(normalizeState("TX", "United States"), "Texas");
  assertEquals(normalizeState("tx", null), "Texas");
  assertEquals(normalizeState("texas", "US"), "Texas");
  assertEquals(normalizeState("Springtown, TX 76082", null), "Texas");
  assertEquals(normalizeState("District of Columbia", "USA"), "District of Columbia");
  assertEquals(normalizeState("ON", "Canada"), "ON");
  assertEquals(normalizeState("England", "United Kingdom"), "England");
  assertEquals(normalizeState("Greater Accra", null), "Greater Accra");
  assertEquals(normalizeState("  ", null), null);
});

Deno.test("size buckets and subjects", () => {
  assertEquals([sizeBucket(1), sizeBucket(10), sizeBucket(11), sizeBucket(250), sizeBucket(5001), sizeBucket("251 to 500")],
    ["1-10", "1-10", "11-50", "201-500", "5001+", "251-500"]);
  assertEquals(sizeBucket(0), null);
  assertEquals(cleanSubject("Re: Fwd: RE: Quick question"), "Quick question");
});

Deno.test("subject matching: placeholders match anything; case and spacing ignored; Re: stripped", () => {
  assertEquals(subjectMatches("Quick question, {{FirstName}}", "Re: quick question,  Ann"), true);
  assertEquals(subjectMatches("{{Company}} + SourceCo", "Acme Corp + SourceCo"), true);
  assertEquals(subjectMatches("Intro", "Intro call"), false);
  assertEquals(subjectMatches(null, "x"), false);
  assertEquals(subjectMatches("Deal (a+b)?", "deal (a+b)?"), true);
});

const steps = [
  { id: 1, type: "email", variants: [{ id: 101, subject: "Quick question, {{FirstName}}" }] },
  { id: 2, type: "email", variants: [{ id: 201, subject: "" }] },
  { id: 3, type: "email", variants: [{ id: 301, subject: "Last try" }, { id: 302, subject: "One more idea" }] },
  { id: 4, type: "linkedin", variants: [] },
];
const out = (subjects: Array<string | null>) =>
  subjects.map((s, i) => ({ isOutbound: true, date: `2026-10-0${i + 1}T12:00:00Z`, subject: s }));

Deno.test("Reply.io step: subject match → step + variant; A/B variant by subject; ambiguous → outbound count", () => {
  assertEquals(matchReplyStep(steps, out(["Quick question, Ann"])),
    { sequence_step_number: 1, step_source: "variant_match", variant_id: "101", variant_match: "exact_single_variant" });
  assertEquals(matchReplyStep(steps, out(["Quick question, Ann", "Re: Quick question, Ann", "One more idea"])),
    { sequence_step_number: 3, step_source: "variant_match", variant_id: "302", variant_match: "subject_match" });
  // A follow-up in the same thread ("Re: <step 1 subject>") with 2 sends: subject points at step 1 only,
  // which is not the outbound position → the thread's first subject still says step 1.
  assertEquals(matchReplyStep(steps, out(["Quick question, Ann", "Re: Quick question, Ann"]))?.sequence_step_number, 1);
  // No subject matches → number of sends before the reply
  assertEquals(matchReplyStep(steps, out(["Totally different", "Another"])),
    { sequence_step_number: 2, step_source: "thread_outbound_count", variant_id: "201", variant_match: "exact_single_variant" });
  assertEquals(matchReplyStep(steps, []), null);
  assertEquals(matchReplyStep([], out([null, null, null, null])), { sequence_step_number: 4, step_source: "thread_outbound_count" });
});

Deno.test("Smartlead step: the stats row by stats id, else the lead's last send before the reply", () => {
  const rows = [
    { stats_id: "a", lead_email: "ann@acme.io", sequence_number: 1, sent_time: "2026-10-01T10:00:00Z", email_subject: "Hi", seq_variant_id: null, email_campaign_seq_id: 900, lead_category: "Interested" },
    { stats_id: "b", lead_email: "ann@acme.io", sequence_number: 2, sent_time: "2026-10-04T10:00:00Z", email_subject: "Re: Hi", seq_variant_id: 77, email_campaign_seq_id: 901 },
    { stats_id: "c", lead_email: "ann@acme.io", sequence_number: 3, sent_time: "2026-10-09T10:00:00Z" },
  ];
  assertEquals(pickSmartleadStat(rows, "a", null, "2026-10-05T00:00:00Z")?.stats_id, "a");
  assertEquals(pickSmartleadStat(rows, "zzz", "ann@acme.io", "2026-10-05T00:00:00Z")?.stats_id, "b");
  assertEquals(pickSmartleadStat(rows, null, "bob@acme.io", "2026-10-05T00:00:00Z"), null);
  assertEquals(smartleadStepKeys(rows[0]), {
    meta: { sequence_step_number: 1, step_source: "smartlead_stats", email_campaign_seq_id: 900, platform_category: "Interested" },
    copy: "900", subject: "Hi",
  });
  // seq_variant_id wins for the copy fingerprint (as in smartlead_backfill)
  assertEquals(smartleadStepKeys(rows[1]).copy, "77");
  assertEquals(smartleadStepKeys(rows[1]).meta.variant_id, "77");
});
