#!/usr/bin/env node

/**
 * Vrelly Full-Stack Integration Tests
 *
 * Tests every layer of the platform end-to-end:
 *   AUTH → DATABASE → PROSPECT SEARCH → EDGE FUNCTIONS → STRIPE → REPLY.IO → CONTENT → CLEANUP
 *
 * Required env vars (set in .env.production / .env.local or export manually):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY
 *
 * Optional (enables additional tests):
 *   SUPABASE_SERVICE_ROLE_KEY     (cleanup: delete test user)
 *   VITE_STRIPE_PUBLISHABLE_KEY   (Stripe env check)
 *   STRIPE_SECRET_KEY             (Stripe price ID validation)
 *   STRIPE_WEBHOOK_SECRET         (Stripe webhook check)
 *   AGENT_API_KEY                 (publish-resource test)
 *   TEST_USER_PASSWORD            (default: TestPass123!)
 *
 * Usage:
 *   node scripts/test-full.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load env from .env files ──────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath, { override = false } = {}) {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (override || !process.env[key]) process.env[key] = value;
    }
  } catch {
    // file not found — fine
  }
}

// .env.local wins over everything (override: true), .env.production is fallback
loadEnvFile(resolve(__dirname, "..", ".env.local"), { override: true });
loadEnvFile(resolve(__dirname, "..", ".env.production"));

// ── Config ────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AGENT_API_KEY = process.env.AGENT_API_KEY;
const STRIPE_PK = process.env.VITE_STRIPE_PUBLISHABLE_KEY;
const STRIPE_SK = process.env.STRIPE_SECRET_KEY;
const STRIPE_WH = process.env.STRIPE_WEBHOOK_SECRET;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || "TestPass123!";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error(
    "FATAL: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set."
  );
  process.exit(1);
}

const REST_URL = `${SUPABASE_URL}/rest/v1`;
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// ── Helpers ───────────────────────────────────────────────────────

const results = [];
let accessToken = null;
let testUserId = null;
const testTimestamp = Date.now();
const testEmail = `vrellytest${testTimestamp}@vrelly-test.com`;
const testArticleSlug = `vrelly-test-article-${testTimestamp}`;

async function runTest(name, fn) {
  const start = performance.now();
  try {
    await fn();
    const ms = (performance.now() - start).toFixed(0);
    console.log(`  ✅ PASS: ${name}  (${ms}ms)`);
    results.push({ name, pass: true, ms });
  } catch (err) {
    const ms = (performance.now() - start).toFixed(0);
    console.log(`  ❌ FAIL: ${name} — ${err.message}`);
    results.push({ name, pass: false, ms, error: err.message });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function warn(msg) {
  console.log(`  ⚠️  WARN: ${msg}`);
}

async function supabaseRest(path, options = {}) {
  const url = path.startsWith("http") ? path : `${SUPABASE_URL}${path}`;
  const headers = {
    apikey: ANON_KEY,
    "Content-Type": "application/json",
    ...options.headers,
  };
  return fetch(url, { ...options, headers });
}

function authHeaders(token) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function serviceHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function callRpc(fnName, params, token) {
  const hdrs = token ? authHeaders(token) : { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" };
  const res = await fetch(`${REST_URL}/rpc/${fnName}`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(params),
  });
  return res;
}

// ── 1. AUTH ───────────────────────────────────────────────────────

async function authTests() {
  console.log("\n━━━ 1. AUTH ━━━\n");

  await runTest("Sign up fresh test user", async () => {
    const res = await fetch(`${AUTH_URL}/signup`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: TEST_PASSWORD }),
    });
    const data = await res.json();
    assert(res.ok, `Signup failed: ${res.status} ${JSON.stringify(data)}`);
    testUserId = data.id || data.user?.id;
    assert(testUserId, "No user ID returned from signup");
  });

  await runTest("Sign in with test user", async () => {
    const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: TEST_PASSWORD }),
    });
    const data = await res.json();
    assert(res.ok, `Signin failed: ${res.status} ${JSON.stringify(data)}`);
    assert(data.access_token, "No access_token returned");
    accessToken = data.access_token;
  });

  await runTest("Session token is valid JWT with authenticated role", async () => {
    assert(accessToken, "No access token from previous step");
    const parts = accessToken.split(".");
    assert(parts.length === 3, "Token is not a valid JWT (expected 3 parts)");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    assert(payload.sub, "JWT payload missing sub claim");
    assert(
      payload.role === "authenticated",
      `Expected role 'authenticated', got '${payload.role}'`
    );
  });
}

// ── 2. DATABASE ──────────────────────────────────────────────────

async function databaseTests() {
  console.log("\n━━━ 2. DATABASE ━━━\n");

  await runTest("prospects table has records", async () => {
    assert(SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set — cannot query prospects count directly. Set it to enable this test.");
    const res = await fetch(
      `${REST_URL}/prospects?select=id&limit=1`,
      { headers: serviceHeaders() }
    );
    assert(res.ok, `Query failed: ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, "prospects table is empty");
  });

  await runTest("user_credits row auto-created for new user", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(
      `${REST_URL}/user_credits?select=*&user_id=eq.${testUserId}`,
      { headers: authHeaders(accessToken) }
    );
    assert(res.ok, `Query failed: ${res.status}`);
    const data = await res.json();
    assert(
      Array.isArray(data) && data.length > 0,
      "No user_credits row found for new user — trigger may not be set up"
    );
  });

  await runTest("subscription_status defaults to 'none' or null", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(
      `${REST_URL}/user_credits?select=subscription_status&user_id=eq.${testUserId}`,
      { headers: authHeaders(accessToken) }
    );
    assert(res.ok, `Query failed: ${res.status}`);
    const data = await res.json();
    if (data.length > 0) {
      const status = data[0].subscription_status;
      assert(
        status === null || status === "none",
        `Expected subscription_status 'none' or null, got '${status}'`
      );
    }
  });

  await runTest("saved_audiences table is accessible", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(
      `${REST_URL}/saved_audiences?select=id&limit=1`,
      { headers: authHeaders(accessToken) }
    );
    assert(res.ok, `saved_audiences query failed: ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), "Expected array response from saved_audiences");
  });

  await runTest("resources table has published articles", async () => {
    const res = await fetch(
      `${REST_URL}/resources?select=id,slug,is_published&is_published=eq.true&limit=5`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" } }
    );
    assert(res.ok, `resources query failed: ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), "Expected array response");
    assert(data.length > 0, "No published articles found in resources table");
  });
}

// ── 3. PROSPECT SEARCH ──────────────────────────────────────────

async function prospectSearchTests() {
  console.log("\n━━━ 3. PROSPECT SEARCH ━━━\n");

  const emptyParams = {
    p_keywords: null, p_job_titles: null, p_seniority_levels: null,
    p_company_size_ranges: null, p_industries: null, p_countries: null,
    p_cities: null, p_gender: null, p_net_worth: null, p_income: null,
    p_departments: null, p_company_revenue: null, p_person_interests: null,
    p_person_skills: null, p_technologies: null,
    p_has_personal_email: null, p_has_business_email: null, p_has_phone: null,
    p_has_linkedin: null, p_has_facebook: null, p_has_twitter: null,
    p_has_company_phone: null, p_has_company_linkedin: null,
    p_has_company_facebook: null, p_has_company_twitter: null,
    p_exclude_keywords: null, p_exclude_job_titles: null,
    p_exclude_industries: null, p_exclude_cities: null,
    p_exclude_countries: null, p_exclude_technologies: null,
    p_exclude_person_skills: null, p_exclude_person_interests: null,
    p_zip_code: null, p_children: null, p_homeowner: null, p_married: null,
    p_education: null, p_age_min: null, p_age_max: null,
    p_company_names: null, p_added_on_days_ago: null,
  };

  await runTest("search_prospects_results with no filters (limit 10)", async () => {
    const res = await callRpc("search_prospects_results", {
      ...emptyParams, p_limit: 10, p_offset: 0,
    }, accessToken);
    assert(res.ok, `RPC failed: ${res.status} ${await res.clone().text()}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, "No results returned for unfiltered search");
  });

  await runTest("search_prospects_count with no filters", async () => {
    const res = await callRpc("search_prospects_count", emptyParams, accessToken);
    assert(res.ok, `RPC failed: ${res.status} ${await res.clone().text()}`);
    const data = await res.json();
    // count RPC returns either [{total_count, is_estimate}] or {total_count, is_estimate}
    const row = Array.isArray(data) ? data[0] : data;
    assert(row && Number(row.total_count) > 0, `Expected count > 0, got ${JSON.stringify(row)}`);
  });

  await runTest("search_prospects_results with keyword filter (CEO)", async () => {
    const res = await callRpc("search_prospects_results", {
      ...emptyParams, p_keywords: ["CEO"], p_limit: 10, p_offset: 0,
    }, accessToken);
    assert(res.ok, `RPC failed: ${res.status} ${await res.clone().text()}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, "No results for keyword filter 'CEO'");
  });

  await runTest("search_prospects_results with seniority filter", async () => {
    const res = await callRpc("search_prospects_results", {
      ...emptyParams, p_seniority_levels: ["C-Level"], p_limit: 10, p_offset: 0,
    }, accessToken);
    assert(res.ok, `RPC failed: ${res.status} ${await res.clone().text()}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, "No results for seniority filter 'C-Level'");
  });

  await runTest("search_prospects_results with location filter", async () => {
    const res = await callRpc("search_prospects_results", {
      ...emptyParams, p_countries: ["United States"], p_limit: 10, p_offset: 0,
    }, accessToken);
    assert(res.ok, `RPC failed: ${res.status} ${await res.clone().text()}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, "No results for location filter 'United States'");
  });
}

// ── 4. EDGE FUNCTIONS ───────────────────────────────────────────

async function edgeFunctionTests() {
  console.log("\n━━━ 4. EDGE FUNCTIONS ━━━\n");

  await runTest("check-subscription: returns subscription status", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(`${FUNCTIONS_URL}/check-subscription`, {
      method: "POST",
      headers: authHeaders(accessToken),
    });
    const data = await res.json();
    assert(res.ok, `check-subscription failed: ${res.status} ${JSON.stringify(data)}`);
    assert("subscribed" in data || "tier" in data, "Response missing subscription fields");
  });

  await runTest("check-and-use-credits: returns credits response", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(`${FUNCTIONS_URL}/check-and-use-credits`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ credit_type: "export", amount: 0 }),
    });
    const data = await res.json();
    const validStatuses = [200, 402, 404];
    assert(
      validStatuses.includes(res.status),
      `Unexpected status ${res.status}: ${JSON.stringify(data)}`
    );
  });

  await runTest("generate-copy: returns non-500 response", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(`${FUNCTIONS_URL}/generate-copy`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        product: "CRM software",
        industries: ["Technology"],
        isBtoB: true,
        targetTitles: ["CEO"],
        companyTypes: ["Startup"],
        channels: ["Email"],
      }),
    });
    const data = await res.json();
    assert(
      res.status < 500,
      `generate-copy returned 5xx: ${res.status} ${JSON.stringify(data).slice(0, 200)}`
    );
  });

  await runTest("build-audience: returns non-500 response", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(`${FUNCTIONS_URL}/build-audience`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        targetTitles: ["CEO"],
        industries: ["retail"],
        companySizes: ["1-10"],
        locations: ["New York"],
      }),
    });
    const data = await res.json();
    assert(
      res.status < 500,
      `build-audience returned 5xx: ${res.status} ${JSON.stringify(data).slice(0, 200)}`
    );
  });

  await runTest("publish-resource: upserts article with agent key", async () => {
    if (!AGENT_API_KEY) {
      throw new Error("AGENT_API_KEY not set — set it to enable this test");
    }
    const res = await fetch(`${FUNCTIONS_URL}/publish-resource`, {
      method: "POST",
      headers: {
        "x-agent-key": AGENT_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test Article — Full Suite",
        slug: testArticleSlug,
        excerpt: "Automated test article created by test-full.mjs",
        content_markdown: "# Test\n\nCreated by test-full.mjs at " + new Date().toISOString(),
        tags: ["test"],
        is_published: false,
      }),
    });
    const data = await res.json();
    assert(res.ok, `publish-resource failed: ${res.status} ${JSON.stringify(data)}`);
    assert(data.success === true, "Response missing success:true");
  });
}

// ── 5. STRIPE ───────────────────────────────────────────────────

const PRICE_IDS = [
  { id: "price_1SPYhwRvAXonKS41WFHowijk", label: "Starter monthly" },
  { id: "price_1SPYjHRvAXonKS41B0eriTUC", label: "Professional monthly" },
  { id: "price_1SPYjTRvAXonKS41RdJr9r7I", label: "Enterprise monthly" },
  { id: "price_1T9TqvRvAXonKS41LFgEf983", label: "Starter annual" },
  { id: "price_1T9TqwRvAXonKS41vRpnp2xU", label: "Professional annual" },
  { id: "price_1T9TqwRvAXonKS41G4SCT11j", label: "Enterprise annual" },
];

async function stripeTests() {
  console.log("\n━━━ 5. STRIPE ━━━\n");

  await runTest("VITE_STRIPE_PUBLISHABLE_KEY is set and starts with pk_", async () => {
    assert(STRIPE_PK, "VITE_STRIPE_PUBLISHABLE_KEY is not set");
    assert(STRIPE_PK.startsWith("pk_"), `Key does not start with pk_: ${STRIPE_PK.slice(0, 10)}...`);
    if (STRIPE_PK.startsWith("pk_test_")) {
      warn("Stripe publishable key is a TEST key (pk_test_) — not yet live");
    }
  });

  await runTest("STRIPE_SECRET_KEY is set", async () => {
    assert(STRIPE_SK, "STRIPE_SECRET_KEY is not set");
    if (STRIPE_SK.startsWith("sk_test_")) {
      warn("Stripe secret key is a TEST key (sk_test_) — not yet live");
    }
  });

  await runTest("STRIPE_WEBHOOK_SECRET is set", async () => {
    assert(STRIPE_WH, "STRIPE_WEBHOOK_SECRET is not set");
    if (STRIPE_WH.startsWith("whsec_test_")) {
      warn("Stripe webhook secret is a TEST secret — not yet live");
    }
  });

  for (const price of PRICE_IDS) {
    await runTest(`Stripe price exists: ${price.label} (${price.id})`, async () => {
      assert(STRIPE_SK, "STRIPE_SECRET_KEY not set — cannot validate price IDs");
      const res = await fetch(`https://api.stripe.com/v1/prices/${price.id}`, {
        headers: {
          Authorization: `Bearer ${STRIPE_SK}`,
        },
      });
      const data = await res.json();
      assert(res.ok, `Price ${price.id} not found: ${res.status} ${data.error?.message || ""}`);
      assert(data.active !== false, `Price ${price.id} exists but is inactive`);
    });
  }
}

// ── 6. REPLY.IO INTEGRATION ────────────────────────────────────

async function replyIoTests() {
  console.log("\n━━━ 6. REPLY.IO INTEGRATION ━━━\n");

  await runTest("outbound_integrations table: check for connected integrations", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(
      `${REST_URL}/outbound_integrations?select=id,provider,status&limit=10`,
      { headers: authHeaders(accessToken) }
    );
    // Table might not exist or be RLS-blocked — both acceptable
    if (!res.ok) {
      const text = await res.text();
      // If table doesn't exist, that's a valid state
      if (text.includes("does not exist") || text.includes("42P01")) {
        warn("outbound_integrations table does not exist — Reply.io not set up");
        return;
      }
      assert(false, `Query failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    if (data.length === 0) {
      warn("No connected integrations found in outbound_integrations");
    }
  });

  await runTest("synced_campaigns: check count", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(
      `${REST_URL}/synced_campaigns?select=id&limit=1`,
      { headers: authHeaders(accessToken) }
    );
    if (!res.ok) {
      const text = await res.text();
      if (text.includes("does not exist") || text.includes("42P01")) {
        warn("synced_campaigns table does not exist");
        return;
      }
      // RLS blocking is fine — means table exists but no access
    }
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      // Exists and has data
    } else {
      warn("synced_campaigns has no records (or RLS blocked)");
    }
    // Pass either way — we're just checking connectivity
  });

  await runTest("synced_contacts: check count", async () => {
    assert(accessToken, "No access token");
    const res = await fetch(
      `${REST_URL}/synced_contacts?select=id&limit=1`,
      { headers: authHeaders(accessToken) }
    );
    if (!res.ok) {
      const text = await res.text();
      if (text.includes("does not exist") || text.includes("42P01")) {
        warn("synced_contacts table does not exist");
        return;
      }
    }
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      // Exists and has data
    } else {
      warn("synced_contacts has no records (or RLS blocked)");
    }
  });
}

// ── 7. CONTENT / RESOURCES ──────────────────────────────────────

async function contentTests() {
  console.log("\n━━━ 7. CONTENT / RESOURCES ━━━\n");

  await runTest("resources table has at least 1 published article", async () => {
    const res = await fetch(
      `${REST_URL}/resources?select=id,title,slug&is_published=eq.true&limit=5`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" } }
    );
    assert(res.ok, `Query failed: ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, "No published articles found");
  });

  await runTest("publish-resource upsert works (re-publish test article)", async () => {
    if (!AGENT_API_KEY) {
      throw new Error("AGENT_API_KEY not set — set it to enable this test");
    }
    // Re-publish the same slug to confirm upsert
    const res = await fetch(`${FUNCTIONS_URL}/publish-resource`, {
      method: "POST",
      headers: {
        "x-agent-key": AGENT_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test Article — Full Suite (updated)",
        slug: testArticleSlug,
        excerpt: "Updated by content test section",
        content_markdown: "# Test Updated\n\nUpserted at " + new Date().toISOString(),
        tags: ["test"],
        is_published: false,
      }),
    });
    const data = await res.json();
    assert(res.ok, `Upsert failed: ${res.status} ${JSON.stringify(data)}`);
    assert(data.success === true, "Response missing success:true");
  });
}

// ── 8. CLEANUP ──────────────────────────────────────────────────

async function cleanupTests() {
  console.log("\n━━━ 8. CLEANUP ━━━\n");

  await runTest("Delete test user", async () => {
    if (!SERVICE_ROLE_KEY) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY not set — cannot delete test user. " +
        `Manually delete user ${testEmail} (${testUserId}) from Supabase dashboard.`
      );
    }
    const res = await fetch(`${AUTH_URL}/admin/users/${testUserId}`, {
      method: "DELETE",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    });
    assert(res.ok || res.status === 204, `Delete user failed: ${res.status} ${await res.text()}`);
  });

  await runTest("Delete test article", async () => {
    if (!SERVICE_ROLE_KEY) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY not set — cannot delete test article. " +
        `Manually delete slug '${testArticleSlug}' from resources table.`
      );
    }
    const res = await fetch(
      `${REST_URL}/resources?slug=eq.${testArticleSlug}`,
      {
        method: "DELETE",
        headers: {
          ...serviceHeaders(),
          Prefer: "return=minimal",
        },
      }
    );
    assert(
      res.ok || res.status === 204,
      `Delete article failed: ${res.status} ${await res.text()}`
    );
  });
}

// ── SUMMARY ─────────────────────────────────────────────────────

function printSummary() {
  console.log("\n════════════════════════════════════════");
  console.log("           TEST SUMMARY");
  console.log("════════════════════════════════════════\n");

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;

  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    console.log(`  ${icon} ${r.name}`);
    if (!r.pass) {
      console.log(`     → ${r.error}`);
    }
  }

  console.log(
    `\n  ${passed}/${total} tests passed${failed > 0 ? `, ${failed} failed` : ""}\n`
  );

  if (failed > 0) process.exit(1);
}

// ── MAIN ────────────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════");
  console.log("   Vrelly Full-Stack Integration Tests");
  console.log("════════════════════════════════════════");
  console.log(`  Target:     ${SUPABASE_URL}`);
  console.log(`  Test email: ${testEmail}`);
  console.log(`  Timestamp:  ${new Date().toISOString()}`);
  console.log(`  Service key: ${SERVICE_ROLE_KEY ? "✓ set" : "✗ not set (cleanup will fail)"}`);
  console.log(`  Stripe SK:   ${STRIPE_SK ? "✓ set" : "✗ not set (price checks will fail)"}`);
  console.log(`  Agent key:   ${AGENT_API_KEY ? "✓ set" : "✗ not set (publish tests will fail)"}`);

  await authTests();
  await databaseTests();
  await prospectSearchTests();
  await edgeFunctionTests();
  await stripeTests();
  await replyIoTests();
  await contentTests();
  await cleanupTests();

  printSummary();
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
