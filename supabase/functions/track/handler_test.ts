// Pixel endpoint: payload validation, CORS, IP hashing (raw IP never sent to
// the database), status mapping, and refusing to run without the salt.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clientIp, handleTrack, hashIp, parseTrackPayload } from "./handler.ts";

const SITE = "vs_0123456789abcdef0123456789abcdef";
const body = (o: Record<string, unknown> = {}) => JSON.stringify({ site_key: SITE, url: "https://vrelly.com/pricing", referrer: "https://google.com/", ts: "2026-10-09T10:00:00Z", anon_id: "a1b2c3d4e5f6", ...o });
const req = (b: string, headers: Record<string, string> = {}, method = "POST") =>
  new Request("http://local/track", { method, body: method === "POST" ? b : undefined, headers: { "content-type": "text/plain", "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Mozilla/5.0", ...headers } });

function fakeDb(result: string) {
  const calls: Record<string, unknown>[] = [];
  return { calls, supabase: { rpc: (fn: string, args: Record<string, unknown>) => { assertEquals(fn, "signals_track_hit"); calls.push(args); return Promise.resolve({ data: result, error: null }); } } };
}

Deno.test("parseTrackPayload: requires a well-formed site_key and http(s) url; cleans the rest", () => {
  assertEquals(parseTrackPayload(body())?.site_key, SITE);
  assertEquals(parseTrackPayload(body({ site_key: "vs_nothex" })), null);
  assertEquals(parseTrackPayload(body({ url: "javascript:alert(1)" })), null);
  assertEquals(parseTrackPayload("not json"), null);
  assertEquals(parseTrackPayload(body({ referrer: "android-app://x", anon_id: "short", ts: "garbage" })),
    { site_key: SITE, url: "https://vrelly.com/pricing", referrer: null, ts: null, anon_id: null });
  assertEquals(parseTrackPayload("x".repeat(9000)), null);
});

Deno.test("clientIp / hashIp: first forwarded hop; salted sha256, not the IP", async () => {
  assertEquals(clientIp(req(body())), "203.0.113.9");
  const h1 = await hashIp("203.0.113.9", "salt-a");
  assertEquals(h1.length, 64);
  assertNotEquals(h1, await hashIp("203.0.113.9", "salt-b"));
  assert(!h1.includes("203"));
});

Deno.test("handleTrack: ok → 204 with CORS *; the RPC gets the hash, never the raw IP", async () => {
  const { calls, supabase } = fakeDb("ok");
  const res = await handleTrack(req(body()), { supabase, salt: "s3cret", resolver: () => Promise.resolve(null) });
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].p_ip_hash, await hashIp("203.0.113.9", "s3cret"));
  assert(!JSON.stringify(calls[0]).includes("203.0.113.9"), "raw IP never leaves the function");
  assertEquals([calls[0].p_site_key, calls[0].p_anon_id, calls[0].p_user_agent], [SITE, "a1b2c3d4e5f6", "Mozilla/5.0"]);
});

Deno.test("handleTrack: the resolver sees the raw IP in memory; its answer (not the IP) is stored", async () => {
  const { calls, supabase } = fakeDb("ok");
  let seenIp: string | null = null;
  await handleTrack(req(body()), { supabase, salt: "s", resolver: (h) => { seenIp = h.ip; return Promise.resolve({ provider: "test", company_name: "Acme" }); } });
  assertEquals(seenIp, "203.0.113.9");
  assertEquals(calls[0].p_resolved, { provider: "test", company_name: "Acme" });
});

Deno.test("handleTrack: status mapping, preflight, bad method, missing salt", async () => {
  for (const [result, status] of [["rate_limited", 429], ["unknown_site", 404], ["domain_mismatch", 403]] as const) {
    const { supabase } = fakeDb(result);
    assertEquals((await handleTrack(req(body()), { supabase, salt: "s", resolver: () => Promise.resolve(null) })).status, status);
  }
  const { supabase, calls } = fakeDb("ok");
  assertEquals((await handleTrack(req("", {}, "OPTIONS"), { supabase, salt: "s" })).status, 204);
  assertEquals((await handleTrack(req("", {}, "GET"), { supabase, salt: "s" })).status, 405);
  assertEquals((await handleTrack(req("{bad"), { supabase, salt: "s" })).status, 400);
  assertEquals((await handleTrack(req(body()), { supabase, salt: "" })).status, 503);
  assertEquals(calls.length, 0);
});
