# Self-Serve Onboarding — Build Plan

Status: **approved, building dev-first**. Last updated 2026-07-05.

Lets an admin generate a per-client onboarding link. The client fills a
questionnaire (their agent info), a Stripe agent subscription is created
($0 via 100%-off coupon when prepaid), the account is provisioned, and the
client sees a confirmation screen. The client is **never logged in** — the
auth user is created server-side for provisioning; the admin handles login
separately.

## Flow

```
Admin (/admin → Users tab)
  └─ "Generate onboarding link" → admin-create-onboarding-link
       ├─ auth.admin.createUser(email, email_confirm)   ← triggers auto-create profiles/team/credits
       └─ mint onboarding_tokens row (already_paid set HERE by admin)
  → admin copies link, sends to client

Client (/onboard/:token, unauthenticated)
  └─ get-onboarding-context (token → prefill + already_paid)
  └─ multi-step questionnaire (agent_configs fields)
  └─ submit → provision-onboarding
       ├─ ATOMIC token claim (consumed_at) — before any Stripe call
       ├─ [already_paid] stripe.customers.create + subscriptions.create({coupon}) w/ idempotency keys
       ├─ write profiles AND user_credits to active/agent (loop-safe, webhook-timing-independent)
       ├─ upsert agent_configs from questionnaire
       └─ create client_analysis + report_tokens
  → confirmation screen ("Your agent is officially being created")

Admin
  └─ later: connect Reply.io in Data Playground (OUT OF SCOPE of this flow)
  └─ (phase 5) receives email that the account was created
```

## Non-negotiable invariants (baked in)

1. **Idempotency on `provision-onboarding` (the money endpoint).** Claim the
   token atomically FIRST:
   `UPDATE onboarding_tokens SET consumed_at=now() WHERE token=$1 AND consumed_at IS NULL`
   and verify exactly 1 row updated — if 0, abort (already used). This runs
   **before any Stripe call.** Additionally, pass a **Stripe idempotency key**
   on both `customers.create` and `subscriptions.create` (keyed on the token /
   user_id) so a network retry or double-submit can never create two
   subscriptions or double-charge.
2. **`already_paid` is server-trusted only.** It is read from the
   `onboarding_tokens` row (set by the admin at generate time), **never** from
   the request body. A client cannot self-select the free tier.
3. **Loop-safe provisioning.** Write BOTH `profiles` (tier=`agent`,
   status=`active`) AND `user_credits` (plan=`agent`, status=`active`, credits)
   to a consistent state regardless of webhook timing. `SubscriptionGuard`
   gates on `user_credits.subscription_status`; `ChoosePlan` redirects on
   `profiles.subscription_status`. If they disagree the client's first login
   bounces forever between `/dashboard` and `/pricing`.
4. **Orphan cleanup.** The auth user is created at generate-link time, so an
   abandoned link leaves an inactive user. Cleanup path = revoke the token
   (`revoked=true`) + `admin-delete-user` (cascades the auth user). Abandoned
   onboarding users are normal members, so the existing delete flow handles
   them.

## Stripe values (Phase 0 done)

| | test/dev | live/prod |
|---|---|---|
| 100%-off coupon (`STRIPE_COUPON_EXISTING_CLIENT`) | `NdGcq45p` | `UGSU8cs3` (CYPR uses this) |
| Agent monthly price (`STRIPE_PRICE_AGENT_MONTHLY`) | `price_1TdcEoGrSILvPOVDOwUK3pV1` | already set |
| Agent product (test) | `prod_Ucryj5CkkTiByy` | — |

`STRIPE_COUPON_EXISTING_CLIENT` must be added as a Supabase secret in both
environments before Phase 3.

## Data model — `onboarding_tokens`

Mirrors `report_tokens` (base64url 32-byte token, revocable) with two deltas:
scoped to a pre-created **`user_id`** (not a client), and **time-boxed +
single-completion** (`expires_at`, `consumed_at`).

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `token` | text unique not null | 32-byte base64url |
| `user_id` | uuid not null → auth.users on delete cascade | the pre-created client |
| `email` | text | captured at generate time (prefill) |
| `display_name` | text | prefill |
| `company` | text | prefill |
| `already_paid` | boolean not null default false | **set by admin only** |
| `consumed_at` | timestamptz | atomic-claim marker (null = unused) |
| `expires_at` | timestamptz | default now()+14d |
| `revoked` | boolean not null default false | soft-kill |
| `created_by` | uuid → auth.users | minting admin |
| `created_at` | timestamptz not null default now() | |

Token lookup/validation runs under service_role (like `get-client-report`),
so RLS only needs admin-manage policies.

## Questionnaire fields (agent_configs)

Client-filled: `company_name`*, `company_url`, `sender_name`*, `sender_title`,
`sender_linkedin`, `sender_bio`, `communication_style` (conversational/direct/
formal/consultative), `offer_description`*, `target_icp`, `outcome_delivered`,
`desired_action`, `sample_message`, `avoid_phrases[]`, `calendar_link`,
`pricing_summary`, `case_studies`, `disqualification_criteria`,
`objection_handling_notes`, `default_cc`, `agent_knowledge`. (`*` = NOT NULL.)
Single-sender for v1 (`sender_profiles` multi-sender deferred).

## Phasing

- **Phase 0** — grant `myall@incrementums.org` admin (one SQL row, dev+prod);
  `onboarding_tokens` migration. Stripe values gathered.
- **Phase 1** — admin "Generate onboarding link": `admin-create-onboarding-link`
  edge fn + Users-tab dialog. **← pause for verify before Phase 3.**
- **Phase 2** — public `/onboard/:token` questionnaire + `get-onboarding-context`.
- **Phase 3** — `provision-onboarding` (Stripe + full chain, all invariants above).
- **Phase 4** — confirmation screen.
- **Phase 5** (fast-follow) — Resend admin-notify email; real-payment (non-prepaid)
  Checkout path.

## Decisions locked

- Prepaid $0 path = **server-side** `stripe.subscriptions.create` + coupon
  (no client-facing Stripe page).
- Initial build = **prepaid-only**; real-payment path is Phase 5.
- Admin email = **deferred** to Phase 5 (admin sees new accounts in Users tab
  meanwhile).

## Deploy discipline

Each phase: migration + `NOTIFY pgrst, 'reload schema'` → edge functions →
frontend, **dev then prod**. Watch the `TIER_CONFIG` / agent-price drift
surface (cause of the May 2026 incident).
