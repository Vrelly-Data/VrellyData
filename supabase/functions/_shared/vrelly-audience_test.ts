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
  normalizeVrellyFilters,
  VrellyFilterError,
  VRELLY_MAX_VALUES_PER_FILTER,
} from "./vrelly-audience.ts";

const none = {
  title_patterns: null, seniorities: null, department_patterns: null, industry_patterns: null,
  company_sizes: null, person_countries: null, person_states: null, company_countries: null,
  company_states: null, keywords: null,
};

Deno.test("titles, industries, departments compile to contains-patterns; unused filters are null", () => {
  const q = compileVrellyFilters({
    job_titles: ["CEO", "  Owner ", "Founder"],
    industries: ["Financial Services"],
    departments: ["Sales"],
  });
  assertEquals(q, {
    ...none,
    title_patterns: ["%CEO%", "%Owner%", "%Founder%"],
    industry_patterns: ["%Financial Services%"],
    department_patterns: ["%Sales%"],
  });
});

Deno.test("the operator's %, _ and \\ are literal, not wildcards", () => {
  assertEquals(containsPattern("100%"), "%100\\%%");
  assertEquals(containsPattern("c_level"), "%c\\_level%");
  assertEquals(containsPattern("a\\b"), "%a\\\\b%");
  assertEquals(compileVrellyFilters({ job_titles: ["VP_%"] }).title_patterns, ["%VP\\_\\%%"]);
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
  assertEquals(q.title_patterns, ["%CEO%", "%Owner%", "%Founder%"]);
  assertEquals(q.person_countries?.slice(0, 3), ["united states", "us", "usa"]);
  assertEquals(q.industry_patterns, ["%Financial Services%"]);
  assertEquals(q.keywords, ["finance", "loans", "lending", "money lending"]);
  assertEquals(q.seniorities, null);
});
