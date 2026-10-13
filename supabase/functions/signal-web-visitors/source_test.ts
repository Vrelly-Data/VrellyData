// Website visitors: visitor-day rollup → one website_visit signal, team-scoped,
// no IP anywhere.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapVisitDay, scoreVisit, type VisitDay } from "./source.ts";

const v: VisitDay = {
  site_key: "vs_0123456789abcdef0123456789abcdef", team_id: "00000000-0000-4000-8000-0000000000aa", domain: "vrelly.com",
  anon_id: "a1b2c3d4e5f6", day: "2026-10-09", first_ts: "2026-10-09T10:00:00Z", last_ts: "2026-10-09T10:07:00Z",
  pages: 3, urls: ["https://vrelly.com/", "https://vrelly.com/pricing", "https://vrelly.com/features"], referrer: "https://google.com/",
  user_agent: "Mozilla/5.0", resolved: null,
};

Deno.test("mapVisitDay: one signal per visitor per day, team visibility, pages viewed, stable dedupe", () => {
  const s = mapVisitDay(v)!;
  assertEquals(s.signal_type, "website_visit");
  assertEquals(s.markets, ["other"]);
  assertEquals(mapVisitDay({ ...v, team_default_market: "saas" })!.markets, ["saas"]);
  assertEquals(s.dedupe_key, "visit:vs_0123456789abcdef0123456789abcdef:a1b2c3d4e5f6:2026-10-09");
  assertEquals([s.visibility, s.team_id], ["team", v.team_id]);
  assertEquals(s.title, "Anonymous visitor viewed 3 pages on vrelly.com");
  assertEquals(s.payload?.paths, ["/", "/pricing", "/features"]);
  assertEquals(s.payload?.identified, false);
  const text = JSON.stringify(s);
  assert(!/ip_hash|"ip"/.test(text), "no IP or IP hash in the signal");
  assertEquals(mapVisitDay({ ...v, pages: 5 })!.dedupe_key, s.dedupe_key, "a growing visit updates the same signal");
});

Deno.test("scoreVisit: more pages and high-intent pages (pricing/demo) score higher; resolver result is used", () => {
  const oneHome = scoreVisit({ ...v, pages: 1, urls: ["https://vrelly.com/"] });
  const pricing = scoreVisit(v);
  assertEquals(oneHome, 20);
  assertEquals(pricing, 20 + 16 + 25);
  const r = mapVisitDay({ ...v, resolved: { provider: "x", company_name: "Acme", company_domain: "https://acme.io" } })!;
  assertEquals([r.company_name, r.company_domain, r.title], ["Acme", "acme.io", "Acme viewed 3 pages on vrelly.com"]);
  assertEquals(mapVisitDay({ ...v, anon_id: "" }), null);
});
