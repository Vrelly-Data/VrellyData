// Auth helpers for sync-reply-contacts
// - Detect trusted service callers (x-agent-key or service-role API key)
// - Constant-time string compare
// - Extract API keys from standard headers
//
// No secrets are logged here. Callers must avoid printing header values.

import { timingSafeEqual } from "https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts";

const textEncoder = new TextEncoder();

export function safeEqualStrings(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(aBytes, bBytes);
}

// Pull a Supabase API key from common headers. Order:
// 1) Authorization: Bearer <token>
// 2) x-supabase-api-key
// 3) apikey
export function extractSupabaseApiKey(headers: Headers): string | null {
  const auth = headers.get("Authorization") || headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const xKey = headers.get("x-supabase-api-key");
  if (xKey) return xKey.trim();
  const apikey = headers.get("apikey");
  if (apikey) return apikey.trim();
  return null;
}

// Return true when the request is from a trusted service caller:
// - x-agent-key equals AGENT_API_KEY (constant-time)
// - Supabase API key (Authorization/apikey header) equals SUPABASE_SERVICE_ROLE_KEY (constant-time)
// The presence of sb_api_key_compatibility is NOT required and never trusted alone.
export function isTrustedServiceCaller(headers: Headers): boolean {
  // x-agent-key path
  const agentKey = headers.get("x-agent-key");
  const expectedAgentKey = Deno.env.get("AGENT_API_KEY") || "";
  if (agentKey && expectedAgentKey && safeEqualStrings(agentKey, expectedAgentKey)) {
    return true;
  }
  // Service-role API key path
  const svcKeyFromHeaders = extractSupabaseApiKey(headers);
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (svcKeyFromHeaders && serviceRoleKey && safeEqualStrings(svcKeyFromHeaders, serviceRoleKey)) {
    return true;
  }
  return false;
}

// Quick body validator used by tests; main handler throws richer errors.
export function hasIntegrationIdentifiers(body: unknown): boolean {
  const b = (body || {}) as Record<string, unknown>;
  const integrationId = b.integrationId;
  const campaignId = b.campaignId;
  return typeof integrationId === "string" && integrationId.trim() !== "" &&
         typeof campaignId === "string" && campaignId.trim() !== "";
}

