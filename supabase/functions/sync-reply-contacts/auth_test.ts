import {
  isTrustedServiceCaller,
  safeEqualStrings,
  extractSupabaseApiKey,
  hasIntegrationIdentifiers,
} from "./auth.ts";
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("safeEqualStrings: constant-time equality works and rejects length mismatch", () => {
  assert(safeEqualStrings("abc", "abc"));
  assertFalse(safeEqualStrings("abc", "abcd"));
  assertFalse(safeEqualStrings("", "x"));
  assertFalse(safeEqualStrings("x", ""));
});

Deno.test("extractSupabaseApiKey: pulls from Authorization, x-supabase-api-key, or apikey", () => {
  const h1 = new Headers({ Authorization: "Bearer token123" });
  assertEquals(extractSupabaseApiKey(h1), "token123");
  const h2 = new Headers({ "x-supabase-api-key": "xyz" });
  assertEquals(extractSupabaseApiKey(h2), "xyz");
  const h3 = new Headers({ apikey: "abc" });
  assertEquals(extractSupabaseApiKey(h3), "abc");
  const h4 = new Headers();
  assertEquals(extractSupabaseApiKey(h4), null);
});

Deno.test("isTrustedServiceCaller: x-agent-key path", () => {
  Deno.env.set("AGENT_API_KEY", "s3cret");
  const headers = new Headers({ "x-agent-key": "s3cret" });
  assert(isTrustedServiceCaller(headers));
});

Deno.test("isTrustedServiceCaller: service-role key via Authorization", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc_key_123");
  const headers = new Headers({ Authorization: "Bearer svc_key_123" });
  assert(isTrustedServiceCaller(headers));
});

Deno.test("isTrustedServiceCaller: rejects user JWT and random keys", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "known_service_key");
  Deno.env.set("AGENT_API_KEY", "known_agent_key");
  // User JWT-looking token should not match service key
  const userHeaders = new Headers({ Authorization: "Bearer user.jwt.token" });
  assertFalse(isTrustedServiceCaller(userHeaders));
  // Wrong x-agent-key
  const wrongAgent = new Headers({ "x-agent-key": "nope" });
  assertFalse(isTrustedServiceCaller(wrongAgent));
});

Deno.test("hasIntegrationIdentifiers: requires both integrationId and campaignId", () => {
  assertFalse(hasIntegrationIdentifiers({}));
  assertFalse(hasIntegrationIdentifiers({ integrationId: "i1" }));
  assertFalse(hasIntegrationIdentifiers({ campaignId: "c1" }));
  assert(hasIntegrationIdentifiers({ integrationId: "i1", campaignId: "c1" }));
});

