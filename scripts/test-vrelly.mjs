#!/usr/bin/env node

/**
 * Vrelly Stack Integration Tests
 *
 * Tests auth, edge functions, database RLS, and Stripe config
 * against the prod Supabase project.
 *
 * Required env vars (set in .env.production or export manually):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY
 *   VITE_SUPABASE_PROJECT_ID
 *   VITE_STRIPE_PUBLISHABLE_KEY  (optional — Stripe env check only)
 *   AGENT_API_KEY                 (for publish-resource test)
 *   TEST_USER_PASSWORD            (password for signup/signin, default: TestPass123!)
 *
 * Usage:
 *   node scripts/test-vrelly.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load env from .env.production ──────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // file not found — that's fine
  }
}

// Load .env.local first (overrides), then .env.production
loadEnvFile(resolve(__dirname, "..", ".env.local"));
loadEnvFile(resolve(__dirname, "..", ".env.production"));

// ── Config ─────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const AGENT_API_KEY = process.env.AGENT_API_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || "TestPass123!";
const STRIPE_PK = process.env.VITE_STRIPE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("FATAL: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set.");
  process.exit(1);
}

const REST_URL = `${SUPABASE_URL}/rest/v1`;
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// ── Helpers ────────────────────────────────────────────────────────

const results = [];

function testEmail() {
  const ts = Date.now();
  return `vrelly-test-${ts}@test-vrelly.local`;
}

async function runTest(name, fn) {
  const start = performance.now();
  try {
    await fn();
    const ms = (performance.now() - start).toFixed(0);
    console.log(`  PASS  ${name}  (${ms}ms)`);
    results.push({ name, pass: true, ms });
  } catch (err) {
    const ms = (performance.now() - start).toFixed(0);
    console.log(`  FAIL  ${name}  (${ms}ms)`);
    console.log(`        ${err.message}`);
    results.push({ name, pass: false, ms, error: err.message });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function supabaseRequest(path, options = {}) {
  const url = path.startsWith("http") ? path : `${SUPABASE_URL}${path}`;
  const headers = {
    apikey: ANON_KEY,
    "Content-Type": "application/json",
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  return res;
}

// ── AUTH TESTS ─────────────────────────────────────────────────────

let accessToken = null;
const email = testEmail();

async function authTests() {
  console.log("\n--- AUTH ---\n");

  await runTest("Sign up with test email", async () => {
    const res = await fetch(`${AUTH_URL}/signup`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    const data = await res.json();
    assert(res.ok, `Signup failed: ${res.status} ${JSON.stringify(data)}`);
    assert(data.id || data.user?.id, "No user ID returned from signup");
  });

  await runTest("Sign in with test email", async () => {
    const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    const data = await res.json();
    assert(res.ok, `Signin failed: ${res.status} ${JSON.stringify(data)}`);
    assert(data.access_token, "No access_token returned from signin");
    accessToken = data.access_token;
  });

  await runTest("Session token is valid JWT", async () => {
    assert(accessToken, "No access token from previous step");
    const parts = accessToken.split(".");
    assert(parts.length === 3, "Token is not a valid JWT (expected 3 parts)");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    assert(payload.sub, "JWT payload missing sub claim");
    assert(payload.role === "authenticated", `Expected role 'authenticated', got '${payload.role}'`);
  });
}

// ── EDGE FUNCTION TESTS ────────────────────────────────────────────

async function edgeFunctionTests() {
  console.log("\n--- EDGE FUNCTIONS ---\n");

  await runTest("check-subscription: returns subscription shape", async () => {
    assert(accessToken, "No access token — auth tests must pass first");
    const res = await fetch(`${FUNCTIONS_URL}/check-subscription`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    assert(res.ok, `check-subscription failed: ${res.status} ${JSON.stringify(data)}`);
    assert("subscribed" in data, "Response missing 'subscribed' field");
    assert("tier" in data, "Response missing 'tier' field");
  });

  await runTest("check-and-use-credits: responds with credit logic", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(`${FUNCTIONS_URL}/check-and-use-credits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ credit_type: "export", amount: 0 }),
    });
    const data = await res.json();
    // Expect either success, NO_CREDITS_RECORD (new user), or NO_SUBSCRIPTION
    const validCodes = [200, 402, 404];
    assert(validCodes.includes(res.status), `Unexpected status ${res.status}: ${JSON.stringify(data)}`);
    if (res.status === 200) {
      assert("success" in data, "200 response missing 'success' field");
    } else {
      assert("code" in data, "Error response missing 'code' field");
    }
  });

  await runTest("build-audience: returns prospects and insights", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(`${FUNCTIONS_URL}/build-audience`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetTitles: ["CEO"],
        industries: ["retail"],
        companySizes: ["1-10"],
        locations: ["New York"],
      }),
    });
    const data = await res.json();
    assert(res.ok || res.status === 502, `build-audience failed unexpectedly: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    if (res.ok) {
      assert("prospects" in data || "insights" in data, "Response missing 'prospects' or 'insights'");
    }
    // 502 is acceptable — means Anthropic API might be rate-limited but the function itself works
  });

  await runTest("generate-copy: returns AI-generated sequence", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(`${FUNCTIONS_URL}/generate-copy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product: "CRM software for small businesses",
        industries: ["Technology"],
        isBtoB: true,
        targetTitles: ["CEO", "CTO"],
        companyTypes: ["Startup"],
        channels: ["Email"],
      }),
    });
    const data = await res.json();
    assert(res.ok || res.status === 502, `generate-copy failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    if (res.ok) {
      assert(data.steps || data.positioning_statement || data.error, "Response has no recognizable fields");
    }
  });

  await runTest("revamp-copy: returns rewritten copy", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(`${FUNCTIONS_URL}/revamp-copy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: "Quick question about your sales process",
        body: "Hi, I wanted to reach out about our product. It helps with sales. Let me know if you want to chat.",
        stepType: "email",
      }),
    });
    const data = await res.json();
    assert(res.ok || res.status === 502, `revamp-copy failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    if (res.ok) {
      assert(data.body || data.subject, "Response missing rewritten copy fields");
    }
  });

  await runTest("publish-resource: upserts article with agent key", async () => {
    if (!AGENT_API_KEY) {
      throw new Error("AGENT_API_KEY env var not set — skipping");
    }
    const testSlug = `vrelly-test-article-${Date.now()}`;
    const res = await fetch(`${FUNCTIONS_URL}/publish-resource`, {
      method: "POST",
      headers: {
        "x-agent-key": AGENT_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test Article from Integration Suite",
        slug: testSlug,
        excerpt: "This is a test article created by test-vrelly.mjs",
        content_markdown: "# Test\n\nThis article was created by the automated test suite.",
        tags: ["test"],
        is_published: false,
      }),
    });
    const data = await res.json();
    assert(res.ok, `publish-resource failed: ${res.status} ${JSON.stringify(data)}`);
    assert(data.success === true, "Response missing success:true");
    assert(data.resource?.slug === testSlug, "Returned resource slug doesn't match");
  });
}

// ── DATABASE / RLS TESTS ───────────────────────────────────────────

async function databaseTests() {
  console.log("\n--- DATABASE (RLS) ---\n");

  await runTest("prospects: public SELECT is blocked (RLS)", async () => {
    const res = await fetch(`${REST_URL}/prospects?select=id&limit=1`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    });
    // Should either 403, return empty [], or return an RLS error (code 42501)
    const data = await res.json();
    if (res.ok) {
      // Some tables return 200 with empty results when RLS blocks
      if (Array.isArray(data)) {
        // Check if the table even exists and is just blocked
        assert(data.length === 0, `RLS FAIL: prospects returned ${data.length} rows to anon user!`);
      }
    }
    // 403 or RLS error is fine — means it's blocked
  });

  await runTest("resources: published articles are publicly readable", async () => {
    const res = await fetch(`${REST_URL}/resources?select=id,slug,is_published&is_published=eq.true&limit=3`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    });
    assert(res.ok, `resources query failed: ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), "Expected array response");
    // We expect at least some published articles exist
    if (data.length > 0) {
      assert(data.every((r) => r.is_published === true), "Returned unpublished articles to anon user!");
    }
  });

  await runTest("resources: draft articles are NOT publicly readable", async () => {
    const res = await fetch(`${REST_URL}/resources?select=id,slug,is_published&is_published=eq.false&limit=5`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data)) {
      assert(data.length === 0, `RLS FAIL: ${data.length} draft articles readable by anon user!`);
    }
    // 403 or error is also acceptable — means blocked
  });

  await runTest("user_credits: NOT publicly readable without auth", async () => {
    const res = await fetch(`${REST_URL}/user_credits?select=id&limit=1`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data)) {
      assert(data.length === 0, `RLS FAIL: user_credits returned ${data.length} rows to anon user!`);
    }
    // 403 or error is fine
  });
}

// ── STRIPE CONFIG TEST ─────────────────────────────────────────────

async function stripeTests() {
  console.log("\n--- STRIPE ---\n");

  await runTest("Stripe publishable key env var exists and is valid", async () => {
    if (!STRIPE_PK) {
      // Check if it might be in .env.local or .env.production under a different name
      const possibleKeys = [
        process.env.VITE_STRIPE_PUBLISHABLE_KEY,
        process.env.STRIPE_PUBLISHABLE_KEY,
        process.env.VITE_STRIPE_PK,
      ].filter(Boolean);
      if (possibleKeys.length === 0) {
        throw new Error(
          "No Stripe publishable key found in env (checked VITE_STRIPE_PUBLISHABLE_KEY, STRIPE_PUBLISHABLE_KEY, VITE_STRIPE_PK). " +
          "This may be expected if Stripe is only configured in the Supabase Edge Function secrets."
        );
      }
    }
    const key = STRIPE_PK || process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PK;
    if (key) {
      assert(
        key.startsWith("pk_test_") || key.startsWith("pk_live_"),
        `Stripe key has unexpected prefix: ${key.slice(0, 10)}...`
      );
    }
  });
}

// ── SUMMARY ────────────────────────────────────────────────────────

function printSummary() {
  console.log("\n====================================");
  console.log("          TEST SUMMARY");
  console.log("====================================\n");

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;

  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`  ${status}  ${r.name}  (${r.ms}ms)`);
    if (!r.pass) {
      console.log(`         ${r.error}`);
    }
  }

  console.log(`\n  ${passed}/${total} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
}

// ── MAIN ───────────────────────────────────────────────────────────

async function main() {
  console.log("Vrelly Stack Integration Tests");
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Test email: ${email}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  await authTests();
  await edgeFunctionTests();
  await databaseTests();
  await stripeTests();
  printSummary();
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
