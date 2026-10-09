// Filter → SQL compiler for the Vrelly audience source. Pure; no database.
//
// compileVrellyFilters produces EXACTLY the comparison values
// public.vrelly_audience_search puts into its WHERE clause (ILIKE ANY patterns,
// = ANY lists, keyword terms), so these tests pin what each stored filter will
// match on prod.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileVrellyFilters,
  containsPattern,
  wordRegex,
  normalizeVrellyFilters,
  VrellyFilterError,
  VRELLY_MAX_VALUES_PER_FILTER,
} from "./vrelly-audience.ts";

const none = {
  title_regexes: null, exclude_title_regexes: null, seniorities: null, department_patterns: null, industry_patterns: null,
  company_sizes: null, person_countries: null, person_states: null, company_countries: null,
  company_states: null, keywords: null,
};

Deno.test("titles compile to whole-word regexes; industries and departments to contains-patterns", () => {
  const q = compileVrellyFilters({
    job_titles: ["CEO", "  Owner ", "Founder"],
    industries: ["Financial Services"],
    departments: ["Sales"],
  });
  assertEquals(q, {
    ...none,
    title_regexes: ["\\mCEO\\M", "\\mOwner\\M", "\\mFounder\\M"],
    industry_patterns: ["%Financial Services%"],
    department_patterns: ["%Sales%"],
  });
});

Deno.test("whole-word title regex: semantics checked with a POSIX-like JS equivalent", () => {
  // Postgres \\m / \\M ~ JS (?<![\\p{L}\\p{N}]) / (?![\\p{L}\\p{N}]) for these cases.
  const js = (term: string) =>
    new RegExp(wordRegex(term).replace(/\\m/g, "(?<![\\p{L}\\p{N}_])").replace(/\\M/g, "(?![\\p{L}\\p{N}_])"), "iu");
  const owner = js("Owner");
  for (const t of ["Owner", "CEO & Owner", "Co-Owner", "Owner/Founder", "Product Owner"]) assertEquals(owner.test(t), true, t);
  for (const t of ["Homeownership Program Director", "Owners", "Ownership Lead"]) assertEquals(owner.test(t), false, t);
  const cto = js("CTO");
  assertEquals(cto.test("Director of Sales"), false);
  assertEquals(cto.test("CTO & Co-founder"), true);
  assertEquals(js("Chief  Executive").test("Chief Executive Officer"), true);
});

Deno.test("regex metacharacters in a title are literal; boundaries only next to letters/digits", () => {
  assertEquals(wordRegex("C++"), "\\mC\\+\\+");
  assertEquals(wordRegex("(Interim) CEO"), "\\(Interim\\)\\s+CEO\\M");
  assertEquals(wordRegex("V.P."), "\\mV\\.P\\.");
  assertEquals(wordRegex("a|b"), "\\ma\\|b\\M");
});

Deno.test("values are trimmed, inner whitespace collapsed, blanks dropped, case-insensitive duplicates removed", () => {
  const f = normalizeVrellyFilters({ job_titles: ["  Chief   Executive ", "", "chief executive", "CFO"] });
  assertEquals(f.job_titles, ["Chief Executive", "CFO"]);
});

Deno.test("seniority keys expand to the values prod stores (Cxo also covers 'C suite')", () => {
  assertEquals(compileVrellyFilters({ seniorities: ["CXO", "vp"] }).seniorities, ["cxo", "c suite", "vp"]);
  assertThrows(() => compileVrellyFilters({ seniorities: ["c_suite"] }), VrellyFilterError, "Unknown seniority");
});

Deno.test("company size uses prod's band labels exactly; anything else is rejected", () => {
  assertEquals(compileVrellyFilters({ company_sizes: ["26 to 50", "10000+"] }).company_sizes, ["26 to 50", "10000+"]);
  assertThrows(() => compileVrellyFilters({ company_sizes: ["11,20"] }), VrellyFilterError, "Unknown company size");
});

Deno.test("countries expand synonyms both ways (prod has 'US' and 'United States')", () => {
  const us = ["united states", "us", "usa", "united states of america", "u.s.", "u.s.a."];
  assertEquals(compileVrellyFilters({ person_countries: ["United States"] }).person_countries, us);
  assertEquals(compileVrellyFilters({ person_countries: ["US"] }).person_countries, us);
  assertEquals(compileVrellyFilters({ company_countries: ["Germany"] }).company_countries, ["germany"]);
});

Deno.test("US states match by name or code; other regions pass through lower-cased", () => {
  assertEquals(compileVrellyFilters({ person_states: ["Texas"] }).person_states, ["texas", "tx"]);
  assertEquals(compileVrellyFilters({ company_states: ["NY", "ENG"] }).company_states, ["ny", "new york", "eng"]);
});

Deno.test("keywords stay terms (lower-cased); Postgres stems them", () => {
  assertEquals(
    compileVrellyFilters({ keywords: ["Finance", "Money Lending"] }).keywords,
    ["finance", "money lending"],
  );
});

Deno.test("excluded titles compile to contains-patterns; an exclusion alone is not a filter", () => {
  const q = compileVrellyFilters({ job_titles: ["Owner"], exclude_job_titles: ["Product Owner", "product owner"] });
  assertEquals(q.title_regexes, ["\\mOwner\\M"]);
  assertEquals(q.exclude_title_regexes, ["\\mProduct\\s+Owner\\M"]);
  assertThrows(() => compileVrellyFilters({ exclude_job_titles: ["Product Owner"] }), VrellyFilterError, "At least one filter");
});

Deno.test("no filter at all is refused — it would walk the whole database", () => {
  assertThrows(() => compileVrellyFilters({}), VrellyFilterError, "At least one filter");
  assertThrows(() => compileVrellyFilters({ job_titles: ["  "] }), VrellyFilterError, "At least one filter");
  assertThrows(() => compileVrellyFilters(null), VrellyFilterError, "At least one filter");
});

Deno.test("Apollo-shaped filters are rejected, not silently ignored", () => {
  assertThrows(
    () => compileVrellyFilters({ person_titles: ["CEO"], q_keywords: "finance" }),
    VrellyFilterError,
    'Unknown Vrelly filter "person_titles"',
  );
});

Deno.test("list sizes and value lengths are bounded", () => {
  const many = Array.from({ length: VRELLY_MAX_VALUES_PER_FILTER + 1 }, (_, i) => `t${i}`);
  assertThrows(() => compileVrellyFilters({ job_titles: many }), VrellyFilterError, "at most");
  assertThrows(() => compileVrellyFilters({ keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }), VrellyFilterError, "at most 10");
  assertThrows(() => compileVrellyFilters({ job_titles: ["x".repeat(101)] }), VrellyFilterError, "longer than");
  assertThrows(() => compileVrellyFilters({ job_titles: "CEO" }), VrellyFilterError, "must be a list");
  assertThrows(() => compileVrellyFilters({ job_titles: [42] }), VrellyFilterError, "must be text");
});

Deno.test("the Agent Upload equivalent compiles to the expected query", () => {
  const q = compileVrellyFilters({
    job_titles: ["CEO", "Owner", "Founder"],
    person_countries: ["United States"],
    industries: ["Financial Services"],
    keywords: ["finance", "loans", "lending", "money lending"],
  });
  assertEquals(q.title_regexes, ["\\mCEO\\M", "\\mOwner\\M", "\\mFounder\\M"]);
  assertEquals(q.person_countries?.slice(0, 3), ["united states", "us", "usa"]);
  assertEquals(q.industry_patterns, ["%Financial Services%"]);
  assertEquals(q.keywords, ["finance", "loans", "lending", "money lending"]);
  assertEquals(q.seniorities, null);
});
