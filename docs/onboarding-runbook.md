# Vrelly Agent — Client Onboarding Runbook

> **Purpose:** Onboard a new Agent-tier client into production Vrelly as a repeatable ~15-minute checklist.
> **Derived from:** CYPR onboarding (client #2), validated against Top Talent / Victoria (client #1, the golden reference).
> **Last validated:** 2026-06-30, live in prod.
> **Prod project ref:** `lgnvolndyftsbcjprmic` · SQL runs in Supabase Studio → SQL Editor (prod).

---

## Before you start — collect from the client

You cannot complete onboarding without these. Get them up front:

| Item | Why | Example (CYPR) |
|------|-----|----------------|
| **Login email** | Auth user + Stripe customer must match this exactly | `carey@cypr.co` |
| **Reply.io API key** | Connects their outbound + capture | (from client's Reply.io → Settings → API) |
| **Which campaigns to manage** | Selected during connect | logistics/manufacturing CEO campaigns |
| **Positioning** | company, sender name, offer, ICP, calendar link, pricing, case studies | for `agent_configs` |

> If you don't have the **Reply.io API key**, request it before starting — Step 4 blocks on it.

---

## The onboarding chain (what actually gets created)

A "client" in Vrelly is not one row. It spans:

- **auth user** → triggers auto-create `profiles`, `user_credits`, `teams`, `team_memberships`, `user_roles`
- **profiles** — Stripe/tier billing (read by some gates)
- **user_credits** — plan + status (**read by the login guard — THE trap, see Step 3**)
- **teams / team_memberships / user_roles** — the client's team (integration scopes here)
- **outbound_integrations** — Reply.io key (encrypted) + webhook (capture reads here)
- **agent_configs** — persona/offer (drafting reads here)
- **client_analysis + report_tokens** — shareable client report

Reference IDs (CYPR, for pattern):
- CYPR user_id: `abf44e9c-7e4c-43e3-bd59-af9a0f85f502`
- Victoria user_id (golden reference): `a9f42924-20e0-4614-b0bd-a2b8a5a9353f`

---

## STEP 1 — Create the auth user

**Studio (prod) → Authentication → Users → Add user:**
- Email: the client's real login email
- Password: set one (or use "Send magic link" after)
- **Auto Confirm User: ✅ ON** (skip confirmation email — important given deliverability, see Appendix B)

⚠️ **Confirm you're on the PROD project** (`lgnvolndyftsbcjprmic`), not dev. Users do not sync between projects.

**Verify + capture the new user_id:**
```sql
SELECT id, email, created_at FROM auth.users ORDER BY created_at DESC LIMIT 3;
```
Copy the new `id` — every step below uses it. **Replace `<USER_ID>` throughout this runbook.**

**Confirm the triggers auto-provisioned the rows:**
```sql
SELECT 'profile' AS kind, id::text AS ref, subscription_tier AS detail
FROM profiles WHERE id = '<USER_ID>'
UNION ALL
SELECT 'team', t.id::text, t.name
FROM teams t JOIN team_memberships tm ON tm.team_id = t.id
WHERE tm.user_id = '<USER_ID>'
UNION ALL
SELECT 'membership', team_id::text, role::text
FROM team_memberships WHERE user_id = '<USER_ID>'
UNION ALL
SELECT 'role', team_id::text, role::text
FROM user_roles WHERE user_id = '<USER_ID>';
```
Expect 4 rows: profile (tier `free`), team (name `My Team's Team`), membership (`member`), role (`member`).
**Copy the team `ref` id** → this is `<TEAM_ID>`.

> Role stays `member` — that's what the working client (Victoria) has. Do **not** elevate.

---

## STEP 2 — Rename the team + create the Stripe subscription

**2a — Rename the auto-created team:**
```sql
UPDATE teams SET name = '<CLIENT_NAME>' WHERE id = '<TEAM_ID>';
```

**2b — Create the $0 subscription in Stripe** (Vrelly Stripe Dashboard → Subscriptions → Create subscription):
- **Customer:** create with email = the client's login email **exactly** (the webhook matches by email)
- **Product:** `Vrelly Agent` (the agent tier — NOT Starter/Pro/Enterprise)
- **Coupon:** `Existing Client Coupon (100% off)` → nets to $0.00/mo
- Result: Active subscription, $0 next invoice

**2c — Verify the webhook wrote tier + status to profiles:**
```sql
SELECT subscription_tier, subscription_status,
       (stripe_customer_id IS NOT NULL) AS has_cust,
       (stripe_subscription_id IS NOT NULL) AS has_sub
FROM profiles WHERE id = '<USER_ID>';
```
Expect `agent / active / ? / ?`. Tier+status flip from the webhook.

**2d — Backfill Stripe IDs** (the webhook sets tier but NOT the customer/sub IDs — known gap).
Get them from Stripe: customer page URL → `cus_...`; subscription page URL → `sub_...`.
```sql
UPDATE profiles
SET stripe_customer_id = '<cus_XXXXX>',
    stripe_subscription_id = '<sub_XXXXX>'
WHERE id = '<USER_ID>';
```

Confirm final state matches Victoria: `agent / active / true / true`.

---

## STEP 3 — Activate `user_credits` ⚠️ THE LOGIN-LOOP TRAP

**This is the step that is easy to miss and causes the "login refreshes over and over" loop.**
The login guard reads `user_credits`, NOT `profiles`. Setting `profiles` alone leaves the client stuck in a redirect loop on login.

```sql
UPDATE user_credits
SET plan = 'agent', subscription_status = 'active'
WHERE user_id = '<USER_ID>';
```
Must report **1 row affected**. Verify:
```sql
SELECT plan, subscription_status FROM user_credits WHERE user_id = '<USER_ID>';
```
Expect `agent / active`.

> The `user_credits.plan` check constraint already includes `'agent'` (added during first agent onboard). If a constraint error ever appears, run:
> ```sql
> ALTER TABLE user_credits DROP CONSTRAINT user_credits_plan_check;
> ALTER TABLE user_credits ADD CONSTRAINT user_credits_plan_check
>   CHECK (plan IN ('none','starter','professional','enterprise','agent'));
> ```

**Then — client must do a FULL sign-out → close tab → fresh login** (not a refresh). A plain refresh serves the cached "no plan" state and keeps looping. The clean re-login forces the guard to re-read the corrected row.

✅ Success = client lands on the dashboard / agent onboarding wizard, no loop.

---

## STEP 4 — Connect Reply.io (via Data Playground, NOT agent Settings)

Logged in **as the client**:

1. Go to **Data Playground** (`/playground`) — or, in the agent wizard Step 4, click **"Go to Data Playground →"**.
   - ⚠️ Do NOT use the "enter API key manually" box on the agent wizard — it can store the key without registering the webhook, giving a "connected" agent that never receives replies.
2. Select platform: **Reply.io**
3. Paste the client's Reply.io API key → **Connect**
4. This runs `validate-api-key → fetch-integration-teams → fetch-available-campaigns → setup-reply-webhook`: creates the encrypted integration, pulls campaigns, registers the webhook.
5. Select the campaigns to manage.

**Verify the integration is fully live:**
```sql
SELECT oi.platform, oi.is_active, oi.sync_status, oi.webhook_status,
       oi.reply_team_id, oi.links_initialized
FROM outbound_integrations oi
JOIN team_memberships tm ON tm.team_id = oi.team_id
WHERE tm.user_id = '<USER_ID>';
```
✅ Target (matches Victoria/CYPR): `reply.io / true / synced / active / <team_id> / true`.

> `sync_status='synced'` alone is NOT enough — you need `webhook_status='active'`. Sync pulls stats; the webhook captures live reply *content*. If webhook isn't active, re-run the connect or the `setup-reply-webhook` step.

---

## STEP 5 — Fill `agent_configs` (real positioning)

The wizard creates an `agent_configs` row, often with thin/placeholder content. For drafts to be good, set real positioning. Required NOT-NULL fields: `company_name`, `sender_name`, `offer_description`.

```sql
UPDATE agent_configs
SET company_name = '<CLIENT_NAME>',
    sender_name = '<SENDER_NAME>',
    sender_title = '<SENDER_TITLE>',
    offer_description = '<WHAT THEY SELL / THE PITCH>',
    target_icp = '<WHO THEY TARGET>',
    outcome_delivered = '<RESULT THEY DELIVER>',
    desired_action = '<e.g. book a discovery call>',
    calendar_link = '<CALENDLY/BOOKING URL>',
    pricing_summary = '<optional>',
    case_studies = '<optional>',
    objection_handling_notes = '<optional>',
    is_active = true,
    onboarding_complete = true
WHERE user_id = '<USER_ID>';
```

Verify:
```sql
SELECT company_name, sender_name, is_active, onboarding_complete,
       (offer_description IS NOT NULL) AS has_offer
FROM agent_configs WHERE user_id = '<USER_ID>';
```

---

## STEP 6 — Create the shareable client report

The report scopes to a `client_analysis` row, and `report_tokens` holds the shareable link.

```sql
-- Create the client_analysis record (the client entity reports scope to)
INSERT INTO client_analysis (user_id, company_name, sender_name, offer_description)
VALUES ('<USER_ID>', '<CLIENT_NAME>', '<SENDER_NAME>', '<OFFER>')
RETURNING id;   -- copy this as <CLIENT_ANALYSIS_ID>

-- Create the report token
INSERT INTO report_tokens (token, client_id, created_by)
VALUES (encode(gen_random_bytes(16), 'hex'), '<CLIENT_ANALYSIS_ID>', '<USER_ID>')
RETURNING token;
```
Shareable link: `https://vrelly.com/report/<token>` *(confirm the exact report route in-app).*

> **Known constraint (multi-client):** the report's "Responses" currently scope by `user_id`. Fine while one user = one client. If a single user ever manages multiple clients, responses will cross-show — needs per-client attribution (join Reply.io leads → a specific client) before that scenario. Flagged in `get-client-report`.

---

## STEP 7 — Verify capture end-to-end

- In the client's **Agent → Inbox**, confirm a real conversation appears (or wait for the 15-min capture cron + a live reply).
- ✅ Done = a captured thread with classification + a "Draft ready" reply. (CYPR picked up the "Rosa Glanz / Journey ABA" thread within minutes.)

---

## Done — final consistency check

Run this one query; every value should match the working reference:
```sql
SELECT
  (SELECT subscription_tier FROM profiles WHERE id='<USER_ID>')             AS profile_tier,
  (SELECT plan FROM user_credits WHERE user_id='<USER_ID>')                 AS credits_plan,
  (SELECT name FROM teams t JOIN team_memberships tm ON tm.team_id=t.id
     WHERE tm.user_id='<USER_ID>')                                         AS team_name,
  (SELECT webhook_status FROM outbound_integrations oi
     JOIN team_memberships tm ON tm.team_id=oi.team_id
     WHERE tm.user_id='<USER_ID>')                                        AS webhook,
  (SELECT onboarding_complete FROM agent_configs WHERE user_id='<USER_ID>') AS agent_ready;
```
Target: `agent / agent / <CLIENT_NAME> / active / true`.

---

## Appendix A — The three traps (why this runbook exists)

1. **The two-table billing split.** `profiles` and `user_credits` both hold plan/status. The **login guard reads `user_credits`**. Setting only `profiles` → infinite login refresh loop. → Step 3 is mandatory.
2. **Stripe IDs not backfilled.** The webhook writes tier+status to `profiles` but not `stripe_customer_id`/`stripe_subscription_id`. Backfill manually or the customer portal breaks later. → Step 2d.
3. **Connect path.** Reply.io connects in **Data Playground**, not the agent Settings/wizard key box. The manual box can skip webhook registration → agent "connected" but never captures. → Step 4.

## Appendix B — Known follow-ups (not per-client, but affect onboarding)

- **Deliverability:** transactional email (welcome/reset) sends via Supabase default SMTP as a `@vrelly.com` address with no SPF/DKIM/DMARC → flagged as spam/phishing in Gmail. Fix: transactional provider (e.g. Resend) behind Supabase Auth SMTP + SPF/DKIM/DMARC on vrelly.com + `contact@vrelly.com` sender. Do before high-volume real signups.
- **Payment bypass:** verify a non-paying signup is actually blocked by `SubscriptionGuard` before opening to real users (20-min test: throwaway account, don't pay, confirm paywall holds).
- **Billing migration:** currently a manual $0 Stripe sub per client (Vrelly Agent product + 100%-off coupon). Move into Vrelly when scaling.
- **Multi-sender profiles:** `agent_configs` sender fields are single-value. A client with multiple LinkedIn/sender profiles needs a `sender_profiles` table (per-sender: name/title/linkedin/bio/calendar; per-client shared: company/offer/ICP/pricing). Build when a multi-sender client arrives.
