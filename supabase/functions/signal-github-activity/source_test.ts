// GitHub: new-repo and release mappers against LIVE shapes (fixtures captured
// 2026-10-09), org → company/domain, and the fetch (org watchlist + search).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchGithubActivity, mapNewRepo, mapRelease, readOrgs, type ReleaseEvent, type Repo } from "./source.ts";
import type { SourceContext } from "../_shared/signals.ts";

const fx = (n: string) => JSON.parse(Deno.readTextFileSync(new URL(`../_shared/testing/signal_fixtures/${n}`, import.meta.url)));
const NOW = Date.parse("2026-10-09T19:00:00Z");
const org = { login: "supabase", name: "Supabase", blog: "https://supabase.com", location: "United States of America" };

Deno.test("mapRelease: live ReleaseEvent → repo_activity with org company + domain, dedupe gh:<repo>:release:<day>", () => {
  const ev = fx("github_org_events.json")[0] as ReleaseEvent;
  const s = mapRelease(ev, { entry: { login: "supabase" }, org, now: NOW })!;
  assertEquals(s.dedupe_key, "gh:264192686:release:2026-10-09");
  assertEquals([s.company_name, s.company_domain], ["Supabase", "supabase.com"]);
  assertEquals(s.url, "https://github.com/supabase/supabase-js/releases/tag/v2.118.0-canary.0");
  assertEquals(s.payload?.event, "release");
  assert(s.title.startsWith("supabase/supabase-js released"));
  assertEquals(mapRelease({ ...ev, type: "PushEvent" }, { entry: { login: "supabase" }, org, now: NOW }), null);
  assertEquals(mapRelease({ ...ev, payload: { release: { ...ev.payload!.release!, draft: true } } }, { entry: { login: "supabase" }, org, now: NOW }), null);
});

Deno.test("mapNewRepo: live search item (owner is a User) → no company; watched org → company from config/org", () => {
  const repo = fx("github_search.json").items[0] as Repo;
  const s = mapNewRepo(repo, { entry: null, org: null, via: "search:topic:llm", now: NOW })!;
  assertEquals(s.dedupe_key, `gh:${repo.id}:new_repo:2026-10-08`);
  assertEquals([s.company_name, s.company_domain], [null, null]);
  assertEquals(s.payload?.via, "search:topic:llm");
  const orgRepo = { ...repo, owner: { login: "acme", type: "Organization" } };
  const o = mapNewRepo(orgRepo, { entry: { login: "acme", company_name: "Acme Inc", company_domain: "acme.io" }, org: null, via: "org", now: NOW })!;
  assertEquals([o.company_name, o.company_domain], ["Acme Inc", "acme.io"]);
  assert(o.score > s.score, "a watched org scores higher");
});

Deno.test("readOrgs: strings or objects; invalid logins dropped", () => {
  assertEquals(readOrgs({ orgs: ["supabase", { login: "vercel", company_domain: "vercel.com" }, "bad login!", { nope: 1 }] }),
    [{ login: "supabase" }, { login: "vercel", company_domain: "vercel.com" }]);
});

Deno.test("fetch: org repos (only new), org releases, search with created:>= appended; errors per org", async () => {
  const urls: string[] = [];
  const recentRepo = { ...fx("github_search.json").items[0], id: 1, full_name: "supabase/new-thing", created_at: "2026-10-09T10:00:00Z" };
  const oldRepo = { ...recentRepo, id: 2, full_name: "supabase/old", created_at: "2025-01-01T00:00:00Z" };
  const fake = ((u: string, init?: RequestInit) => {
    urls.push(u);
    assertEquals((init?.headers as Record<string, string>)["User-Agent"], "vrelly-signals");
    const p = new URL(u).pathname;
    const ok = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { headers: { "x-ratelimit-remaining": "55" } }));
    if (p === "/orgs/supabase") return ok(org);
    if (p === "/orgs/supabase/repos") return ok([recentRepo, oldRepo]);
    if (p === "/orgs/supabase/events") return ok(fx("github_org_events.json"));
    if (p === "/orgs/ghost") return Promise.resolve(new Response("{}", { status: 404 }));
    if (p === "/search/repositories") return ok(fx("github_search.json"));
    return Promise.resolve(new Response("{}", { status: 500 }));
  }) as unknown as typeof fetch;
  const config = { orgs: ["supabase", "ghost"], search_queries: ["topic:llm"], lookback_days: 2 };
  const ctx: SourceContext = { supabase: null, source: { key: "github_activity", vertical: "github", kind: "api", cadence: "daily", default_visibility: "all_clients", config }, config, lastSuccessAt: null, fetchFn: fake, now: NOW };
  const r = await fetchGithubActivity(ctx);
  const keys = r.signals.map((s) => s.dedupe_key);
  assert(keys.includes("gh:1:new_repo:2026-10-09"));
  assert(!keys.some((k) => k.startsWith("gh:2:")), "old repo skipped");
  assert(keys.includes("gh:264192686:release:2026-10-09"));
  assert(urls.some((u) => decodeURIComponent(u).includes("topic:llm created:>=2026-10-07")));
  assert(r.error?.includes("ghost"));
  assertEquals(r.detail?.rate_remaining, "55");
});
