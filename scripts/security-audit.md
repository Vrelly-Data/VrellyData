# Vrelly Security Audit Checklist

Audit date: ___________
Auditor: ___________

---

## 1. Supabase RLS (Row Level Security)

Check that every table has RLS enabled and policies are correct.

| Table | RLS Enabled? | Policies Correct? | Notes |
|-------|-------------|-------------------|-------|
| `prospects` | [ ] | [ ] | Must block anon SELECT. Only authenticated users via RPC functions should access. |
| `resources` | [ ] | [ ] | Published articles (`is_published=true`) should be publicly readable. Drafts must be blocked from anon. |
| `user_credits` | [ ] | [ ] | Must NOT be publicly readable. Only the owning user (or service role) should read/write. |
| `profiles` | [ ] | [ ] | Users should only read/update their own profile. |
| `user_roles` | [ ] | [ ] | Should not be writable by users (admin-only). |
| `team_memberships` | [ ] | [ ] | Users should only see teams they belong to. |
| `audiences` | [ ] | [ ] | Scoped to owning user/team. |
| `lists` | [ ] | [ ] | Scoped to owning user/team. |
| `list_items` | [ ] | [ ] | Scoped to owning list/user. |
| `credit_transactions` | [ ] | [ ] | Scoped to owning user. |
| `sales_knowledge` | [ ] | [ ] | Should not be publicly readable (proprietary KB data). |
| `api_keys` | [ ] | [ ] | Only owning user should read. Must never be publicly accessible. |
| `external_projects` | [ ] | [ ] | Scoped to owning user/team. |
| `synced_campaigns` | [ ] | [ ] | Scoped to integration owner. |
| `synced_contacts` | [ ] | [ ] | Scoped to integration owner. |
| `outbound_integrations` | [ ] | [ ] | Scoped to owning user/team. |
| `received_contacts` | [ ] | [ ] | Scoped to owning user. |
| `campaigns` | [ ] | [ ] | Scoped to owning user. |
| `webhook_events` | [ ] | [ ] | Should not be publicly readable. |

**How to verify:**
```sql
-- Run in Supabase SQL Editor to check RLS status for all tables:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

---

## 2. Edge Function JWT Verification

Every JWT-authenticated function must verify the token before processing.

| Function | Requires Auth? | Verifies JWT? | Method | Notes |
|----------|---------------|---------------|--------|-------|
| `check-subscription` | Yes | [ ] | `supabaseClient.auth.getUser(token)` | Uses service role client to verify token extracted from Authorization header |
| `check-and-use-credits` | Yes | [ ] | `supabase.auth.getUser()` via anon client with auth header forwarded | Returns 401 if auth fails |
| `build-audience` | Yes | [ ] | Checks `Authorization` header exists | **AUDIT**: Does it actually verify the JWT or just check the header is present? Currently only checks `if (!authHeader)` — token is not validated against Supabase Auth. Uses service role key directly. |
| `generate-copy` | Yes | [ ] | Checks `Authorization` header exists | **AUDIT**: Same concern as build-audience — header presence check only, no `getUser()` call. |
| `revamp-copy` | Yes | [ ] | Checks `Authorization` header exists | **AUDIT**: Same concern — header presence check only. |
| `publish-resource` | No (agent key) | N/A | `x-agent-key` header vs `AGENT_API_KEY` env | Authenticated via static API key, not JWT. |
| `create-checkout` | Yes | [ ] | Verify auth pattern used |
| `customer-portal` | Yes | [ ] | Verify auth pattern used |
| `manage-subscription` | Yes | [ ] | Verify auth pattern used |
| `stripe-webhook` | No | N/A | Stripe signature verification | Should verify `stripe-signature` header |
| `receive-contacts` | No (API key) | N/A | Validates via `api_keys` table | |
| `send-contacts` | Yes | [ ] | Verify auth pattern used |
| `admin-delete-user` | Yes | [ ] | Must verify user is admin |
| `reset-monthly-credits` | ? | [ ] | Should be cron-only or service-role-only |

**Critical finding to investigate:**
`build-audience`, `generate-copy`, and `revamp-copy` check for the presence of the `Authorization` header but do NOT call `supabase.auth.getUser()` to validate the token. An attacker could pass any string as the Bearer token and the function would proceed. These functions use the `SUPABASE_SERVICE_ROLE_KEY` to query data, so the JWT is never actually validated.

---

## 3. Service Role Key Exposure

The `SUPABASE_SERVICE_ROLE_KEY` must NEVER appear in frontend code.

- [ ] Search all files in `src/` for `service_role`, `SERVICE_ROLE`, or the actual key value
- [ ] Verify `src/integrations/supabase/client.ts` uses only `VITE_SUPABASE_PUBLISHABLE_KEY` (the anon key)
- [ ] Verify no `.env` files containing the service role key are committed to git (check `.gitignore`)
- [ ] Verify edge functions access the service role key only via `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`

**Verification commands:**
```bash
# Search frontend for service role references
grep -r "service_role\|SERVICE_ROLE" src/
# Should return no results

# Verify the Supabase client only uses the anon key
grep -n "PUBLISHABLE_KEY\|ANON_KEY\|service_role" src/integrations/supabase/client.ts
```

**Current status:** No `service_role` references found in `src/` as of last scan.

---

## 4. Agent API Key Exposure

The `AGENT_API_KEY` (used by `publish-resource`) must not be in frontend code.

- [ ] Search `src/` for `x-agent-key`, `AGENT_API_KEY`, or the key value (`xokfyb-Jurpyd-8muwgu`)
- [ ] Verify the key is only referenced in `supabase/functions/publish-resource/index.ts` (server-side)
- [ ] Verify the key is stored as a Supabase Edge Function secret, not in any committed file

**Verification commands:**
```bash
grep -r "x-agent-key\|AGENT_API_KEY\|xokfyb" src/
# Should return no results
```

**Current status:** No agent key references found in `src/` as of last scan.

---

## 5. React Router — Unprotected Routes

All paid/authenticated routes must be wrapped with `ProtectedRoute` and `SubscriptionGuard`.

| Route | Auth Guard? | Sub Guard? | Correct? | Notes |
|-------|-----------|-----------|----------|-------|
| `/` | No | No | [ ] OK | Public landing page |
| `/resources` | No | No | [ ] OK | Public content |
| `/resources/:slug` | No | No | [ ] OK | Public content |
| `/comparisons` | No | No | [ ] OK | Public content |
| `/agents` | No | No | [ ] OK | Public content |
| `/terms` | No | No | [ ] OK | Public legal page |
| `/privacy` | No | No | [ ] OK | Public legal page |
| `/auth` | No | No | [ ] OK | Login/signup page |
| `/reset-password` | No | No | [ ] OK | Password reset |
| `/checkout-success` | No | No | [ ] | **AUDIT**: Should this require auth? Could someone access it without being logged in? |
| `/checkout/success` | No | No | [ ] | **AUDIT**: Same concern — duplicate route, no auth guard. |
| `/pricing` | No | No | [ ] OK | Public pricing page |
| `/choose-plan` | `ProtectedRoute` | No | [ ] OK | Auth required, no sub needed (choosing a plan) |
| `/dashboard` | `ProtectedRoute` | `SubscriptionGuard` | [ ] OK | Paid feature |
| `/people` | `ProtectedRoute` | `SubscriptionGuard` | [ ] OK | Paid feature |
| `/companies` | `ProtectedRoute` | `SubscriptionGuard` | [ ] OK | Paid feature |
| `/playground` | `ProtectedRoute` | `SubscriptionGuard` | [ ] OK | Paid feature |
| `/settings` | `ProtectedRoute` | No | [ ] | **AUDIT**: Settings has no `SubscriptionGuard`. Is this intentional? Users can access settings without a subscription. |
| `/billing` | `ProtectedRoute` | No | [ ] | Same as settings — maps to `<Settings />` |
| `/admin` | `AdminRoute` | No | [ ] | Verify `AdminRoute` checks admin role properly |

---

## 6. Payment Bypass — SubscriptionGuard Coverage

- [ ] Verify `SubscriptionGuard` actually checks subscription status (not just auth)
- [ ] Verify all data-access routes (`/dashboard`, `/people`, `/companies`, `/playground`) have `SubscriptionGuard`
- [ ] Verify the `SubscriptionGuard` cannot be bypassed by directly calling edge functions (edge functions should also check subscription status where relevant)
- [ ] Verify `check-and-use-credits` enforces `subscription_status === 'active'` before deducting credits
- [ ] Verify there is no client-side-only subscription check that can be bypassed by modifying JS

**Note:** `check-and-use-credits` does enforce `subscription_status !== 'active'` at line 59, returning 402. This is server-side enforcement.

---

## 7. Console.log Leaking Sensitive Data

Check for `console.log` statements that might leak tokens, keys, or user data in production.

**Files with console.log statements (35 occurrences across 12 files):**

| File | Count | Audit Status | Notes |
|------|-------|-------------|-------|
| `src/pages/AudienceBuilder.tsx` | 2 | [ ] | Check if logging user data or tokens |
| `src/stores/authStore.ts` | 2 | [ ] | **HIGH PRIORITY**: Auth store — check for token/session logging |
| `src/components/AppSidebar.tsx` | 1 | [ ] | |
| `src/lib/audienceLabClient.ts` | 10 | [ ] | **HIGH PRIORITY**: Many logs in API client — check for auth headers or response data |
| `src/lib/performanceSnapshot.ts` | 2 | [ ] | |
| `src/hooks/useRecordsFromDatabase.ts` | 4 | [ ] | |
| `src/lib/csvExport.ts` | 2 | [ ] | |
| `src/hooks/useEmailStatsUpload.ts` | 1 | [ ] | |
| `src/hooks/useOutboundIntegrations.ts` | 5 | [ ] | |
| `src/hooks/useLinkedInStatsUpload.ts` | 1 | [ ] | |
| `src/hooks/usePersistRecords.ts` | 2 | [ ] | |
| `src/hooks/useFreeDataSearch.ts` | 3 | [ ] | |

**Verification command:**
```bash
# Find console.log with potentially sensitive content
grep -n "console\.log" src/**/*.{ts,tsx} | grep -i "token\|key\|secret\|password\|session\|credit\|email\|auth"
```

---

## 8. CORS Configuration

Check if CORS is locked down or wide open on Edge Functions.

**Current status: WIDE OPEN**

All edge functions use:
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
```

- [ ] `Access-Control-Allow-Origin: *` allows ANY website to call these functions
- [ ] Consider restricting to `https://www.vrelly.com` and `https://vrelly.com` in production
- [ ] At minimum, sensitive functions (check-subscription, check-and-use-credits, build-audience, generate-copy, revamp-copy) should restrict origin

**Recommendation:** Replace `*` with an allowlist:
```typescript
const ALLOWED_ORIGINS = [
  "https://www.vrelly.com",
  "https://vrelly.com",
  "http://localhost:5173",  // dev only
  "http://localhost:8080",  // dev only
];

const origin = req.headers.get("Origin") || "";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
```

---

## Summary of Critical Findings

### HIGH SEVERITY
1. **Edge functions `build-audience`, `generate-copy`, `revamp-copy` do not validate JWT tokens.** They check for the `Authorization` header's presence but never call `getUser()` to verify the token. Any string passed as a Bearer token would be accepted. These functions use the service role key to query data.

2. **CORS is `Access-Control-Allow-Origin: *` on all edge functions.** Any website can make authenticated requests to these functions if it has a valid JWT.

### MEDIUM SEVERITY
3. **`/checkout-success` and `/checkout/success` routes have no auth guard.** Verify these don't expose sensitive post-payment data.

4. **`/settings` and `/billing` routes lack `SubscriptionGuard`.** Confirm this is intentional (users should access settings regardless of subscription).

5. **35 `console.log` statements in frontend code.** Priority audit for `authStore.ts` and `audienceLabClient.ts` to ensure no tokens/keys are logged.

### LOW SEVERITY
6. **`reset-monthly-credits` function** — verify it cannot be triggered by unauthenticated requests (should be cron-only).

---

## How to Run This Audit

1. **RLS check:** Run the SQL query in Section 1 in Supabase SQL Editor
2. **JWT verification:** Read each edge function and verify `getUser()` is called
3. **Key exposure:** Run the grep commands in Sections 3 and 4
4. **Route audit:** Compare Section 5 table against `src/App.tsx`
5. **Console.log audit:** Run grep from Section 7 and review each match
6. **CORS audit:** Search for `Access-Control-Allow-Origin` in `supabase/functions/`
7. **Integration tests:** Run `node scripts/test-vrelly.mjs` to verify RLS enforcement
