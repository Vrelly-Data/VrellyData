
## What’s actually happening (based on the latest logs)

- Your “Enable Live” button is correctly calling the backend function `setup-reply-webhook`.
- That function is successfully:
  - loading the integration,
  - building the webhook URL,
  - and calling Reply.io.
- The failure is specifically here:

  - Current code calls: `POST https://api.reply.io/v2/push/subscriptions`
  - Reply.io responds: **404** (and body is empty)

- The Reply.io docs you shared show the correct webhook API is **v3**:

  - `POST https://api.reply.io/v3/webhooks`
  - body fields: `targetUrl`, `eventTypes`, optional `secret`, optional `subscriptionLevel`, optional IDs

So we need to switch back to **v3** and stop using the v2 push subscriptions endpoint.

## Why v3 previously failed too (the missing piece)

Earlier, when we used v3, the payload had correct event names (after we fixed them), but we still got **404**. In your logs, that call was made with:
- `subscriptionLevel` omitted (so it defaults to `account`)
- but we were unable to discover an `accountId` because:
  - `GET /v1/accounts` returns 404
  - `GET /v1/users/me` returns 404
  - `GET /v1/emailAccounts` returns 200 but doesn’t include `accountId` (at least not in the sample)

Many APIs return 404 for “resource not found OR not available for your tenant/scope”. In this case, it’s likely the v3 webhook endpoint is reachable, but the *subscription scope* is invalid/missing required ID.

Given you’re on an agency plan, the safest, most reliable path is:
- create the webhook at **team scope** (subscriptionLevel = `team`) with `teamIds`, instead of relying on accountId discovery.

You already have UI support for entering `reply_team_id` in the Edit Integration dialog. We should leverage that.

---

## Implementation Plan

### Step 1 — Revert webhook management to Reply.io v3 (correct API per docs)
Update `supabase/functions/setup-reply-webhook/index.ts`:

1. Change delete endpoint back to:
   - `DELETE https://api.reply.io/v3/webhooks/{id}`

2. Change create endpoint back to:
   - `POST https://api.reply.io/v3/webhooks`

3. Change payload back to v3 schema:
   - `targetUrl` (not `url`)
   - `eventTypes` (not `events`)
   - include `secret` so we can verify signatures in `reply-webhook`

4. Standardize API key header for v3 calls to match docs exactly:
   - use `X-API-Key` (not mixed casing)

### Step 2 — Use team-level subscriptions when available (best fit for agency accounts)
Still in `setup-reply-webhook/index.ts`:

- Fetch `reply_team_id` from `outbound_integrations` in the initial SELECT.
- If `reply_team_id` exists and is numeric:
  - set:
    - `subscriptionLevel: "team"`
    - `teamIds: [Number(reply_team_id)]`
- This avoids needing `accountId` entirely and matches how agency accounts are typically scoped.

### Step 3 — Improve account discovery (fallback only)
If `reply_team_id` is not set:

- Keep the current `discoverAccountId()` but extend it to try endpoints we already know work in your tenant:
  - `GET /v1/people?limit=1` (this is already used by your “validate-api-key” logic successfully)
  - If the returned object has `accountId` (and it’s not null), use it.
- Only if we successfully discover an accountId:
  - set `subscriptionLevel: "account"` and include `accountId`.

If we still can’t discover an accountId:
- attempt to create the webhook without `subscriptionLevel`/IDs (default behavior), but we’ll add much better logging and error returns.

### Step 4 — Return actionable error details to the UI (stop “non-2xx” black box)
Update `src/hooks/useOutboundIntegrations.ts` in the `setupWebhook` mutation:

- When `supabase.functions.invoke()` fails, Supabase returns a structured error object that often includes the response body.
- We will extract and show:
  - Reply.io HTTP status
  - Reply.io response body (if present)
  - A short “what to do next” message

This turns the toast from:
- “Edge Function returned a non-2xx status code”
into something like:
- “Reply.io rejected webhook creation (404): {…actual message…}”

### Step 5 — Optional UX guardrail: prompt for Team ID if agency + no team id
Small improvement in `IntegrationSetupCard.tsx`:

- If platform is Reply.io AND webhook_status is error AND reply_team_id is empty:
  - show a callout: “For agency accounts, set Team ID first (Edit).”
  - keep the button, but guide users toward the required setup.

### Step 6 — Verification steps (after implementation)
1. In the app, open your Reply.io integration → click the pencil icon → paste your Reply Team ID (client workspace ID) → Save.
2. Click “Enable Live”.
3. Confirm:
   - integration row shows “Live”
   - `outbound_integrations.webhook_status` becomes `active`
4. Send a real event in Reply.io (open/reply/etc.) and verify:
   - `webhook_events` starts receiving rows
   - campaign/contact stats update

---

## Files that will be changed

1. `supabase/functions/setup-reply-webhook/index.ts`
   - switch back to v3 webhooks API
   - use teamIds when reply_team_id is present
   - add improved discovery + improved logging

2. `src/hooks/useOutboundIntegrations.ts`
   - display real error details from backend function responses

3. (Optional) `src/components/playground/IntegrationSetupCard.tsx`
   - guidance UX when team id is required

---

## Risks / Edge cases handled

- If Reply.io v3 expects team scope for agency accounts, we’ll satisfy it via `reply_team_id`.
- If Reply.io returns 404 for “wrong scope” or “missing ID”, the new UI error parsing will expose it immediately.
- We keep `secret` so `reply-webhook` signature verification continues to work.
