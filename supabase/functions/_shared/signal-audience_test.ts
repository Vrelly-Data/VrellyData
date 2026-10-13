import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileSignalAudience, normalizeSignalFilters, SignalFilterError, titleMatcher,
} from "./signal-audience.ts";

const persona = { job_titles: ["CEO"] };

Deno.test("filters: defaults filled in, empty lists dropped", () => {
  const f = normalizeSignalFilters({ types: ["fda_clearance"], persona, fda: { states: [] } });
  assertEquals(f.recency_days, 30);
  assertEquals(f.min_score, 0);
  assertEquals(f.max_per_company, 2);
  assertEquals(f.use_apollo, false); // paid fallback is opt-in
  assertEquals(f.us_only, true);
  assertEquals(f.fda, undefined);
});

Deno.test("filters: unknown keys are rejected, at every level", () => {
  assertThrows(() => normalizeSignalFilters({ person_titles: ["CEO"] }), SignalFilterError, "Unknown");
  assertThrows(() => normalizeSignalFilters({ fda: { device: ["x"] } }), SignalFilterError, "Unknown fda");
  assertThrows(() => normalizeSignalFilters({ persona: { titles: ["CEO"] } }), SignalFilterError, "Unknown persona");
  assertThrows(() => normalizeSignalFilters({ verticals: ["medical_device"] }), SignalFilterError, "Unknown");
  assertThrows(() => normalizeSignalFilters({ types: ["crypto"] }), SignalFilterError, "Unknown signal type");
  assertThrows(() => normalizeSignalFilters({ markets: ["crypto"] }), SignalFilterError, "Unknown market");
  assertThrows(() => normalizeSignalFilters({ types: ["fast_growth"] }), SignalFilterError, "coming soon");
  assertThrows(() => normalizeSignalFilters({ github: { topics: ["x"] } }), SignalFilterError, "Unknown");
});

Deno.test("filters: types stored as PUBLIC keys (high_intent), compiled to internal keys for SQL", () => {
  const f = normalizeSignalFilters({ types: ["high_intent", "positive_response", "FDA_CLEARANCE"], markets: ["SaaS", "private_equity"] });
  assertEquals(f.types, ["high_intent", "fda_clearance"]);
  assertEquals(f.markets, ["saas", "private_equity"]);
  const c = compileSignalAudience({ ...f, persona });
  assertEquals(c.candidates.signal_types, ["positive_response", "fda_clearance"]);
  assertEquals(c.candidates.markets, ["saas", "private_equity"]);
  assertEquals(compileSignalAudience({ persona }).candidates.signal_types, null);
});

Deno.test("filters: ranges and FDA product codes validated", () => {
  assertThrows(() => normalizeSignalFilters({ recency_days: 0 }), SignalFilterError);
  assertThrows(() => normalizeSignalFilters({ max_per_company: 11 }), SignalFilterError);
  assertThrows(() => normalizeSignalFilters({ min_score: 101 }), SignalFilterError);
  assertThrows(() => normalizeSignalFilters({ fda: { product_codes: ["LLZZ"] } }), SignalFilterError, "three letters");
  assertEquals(normalizeSignalFilters({ fda: { product_codes: ["llz"] } }).fda?.product_codes, ["LLZ"]);
});

Deno.test("compile: a target persona is required", () => {
  assertThrows(() => compileSignalAudience({ types: ["fda_clearance"] }), SignalFilterError, "Choose who to reach");
  assertThrows(() => compileSignalAudience({ persona: { exclude_job_titles: ["Assistant"] } }), SignalFilterError);
});

Deno.test("compile: candidate query — per-type filters, since, states expanded", () => {
  const now = Date.parse("2026-10-13T00:00:00Z");
  const c = compileSignalAudience({
    types: ["fda_clearance", "hiring"], recency_days: 7, min_score: 60,
    fda: { product_codes: ["llz"], device_keywords: ["catheter"], states: ["TX"] },
    hiring: { role_keywords: ["SDR"] }, product_launch: { topics: ["Kubernetes"] }, persona,
  }, now);
  assertEquals(c.candidates.since, "2026-10-06T00:00:00.000Z");
  assertEquals(c.candidates.min_score, 60);
  assertEquals(c.candidates.fda_product_codes, ["LLZ"]);
  assertEquals(c.candidates.fda_device_regexes, ["\\mcatheter\\M"]);
  assertEquals(c.candidates.fda_state_keys?.sort(), ["texas", "tx"]);
  assertEquals(c.candidates.hiring_role_regexes, ["\\mSDR\\M"]);
  assertEquals(c.candidates.launch_topics, ["kubernetes"]);
});

Deno.test("compile: persona — whole-word titles, seniority expanded, Apollo terms mapped", () => {
  const c = compileSignalAudience({
    persona: { job_titles: ["VP Sales"], exclude_job_titles: ["Assistant"], seniorities: ["cxo", "staff"], departments: ["Sales"] },
  });
  assertEquals(c.persona.title_regexes, ["\\mVP\\s+Sales\\M"]);
  assertEquals(c.persona.exclude_title_regexes, ["\\mAssistant\\M"]);
  assertEquals(c.persona.seniorities, ["cxo", "c suite", "staff"]);
  assertEquals(c.persona.department_patterns, ["%Sales%"]);
  assertEquals(c.apollo, { person_titles: ["VP Sales"], person_seniorities: ["c_suite", "owner", "founder", "entry"] });
});

Deno.test("compile: a department-only persona cannot use the Apollo fallback", () => {
  const c = compileSignalAudience({ persona: { departments: ["Regulatory"] }, use_apollo: true });
  assertEquals(c.apollo, null);
});

Deno.test("titleMatcher: whole words, like the SQL", () => {
  const m = titleMatcher(["CTO", "Owner", "VP Sales", "C++"])!;
  assert(m("CTO & Co-Founder"));
  assert(!m("Director"));
  assert(m("Owner"));
  assert(!m("Homeownership Advisor"));
  assert(m("Senior VP  Sales"));
  assert(!m("VP Salesforce"));
  assert(m("Lead C++ Engineer"));
  assert(!m(null));
  assertEquals(titleMatcher([]), null);
});
