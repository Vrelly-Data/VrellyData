
Goal
- Fix the “re-enable live updates” webhook setup so it doesn’t keep failing with a Reply API 404, and make failures actionable (right now Reply returns 404 with an empty body, so the UI can’t show a meaningful reason).

What we know from logs (confirmed)
- The backend webhook setup call returns:
  - status: 400 (from our backend function)
  - payload: {"error":"Failed to create webhook subscription","details":"","status":404}
- The upstream Reply API call to:
  - POST https://api.reply.io/v3/webhooks
  returns 404 with an empty response body.
- The request payload looks valid per Reply docs:
  - targetUrl, eventTypes, secret, subscriptionLevel: "team", teamIds: [383893]
- Because the body is empty, we can’t tell if this is:
  - a “team not found / not accessible” situation,
  - an “API key not authorized for v3/webhooks” situation (some APIs intentionally return 404),
  - a subtle request formatting issue (less likely),
  - or an API-key formatting issue (whitespace).

Why it’s failing again (most likely causes)
1) Team scope issue:
   - subscriptionLevel="team" + teamIds=[383893] may be invalid for that API key (wrong team, team not accessible, or teamId discovered from v1 endpoints not matching v3 expectations).
2) API key works for older endpoints but not for v3 webhooks:
   - Your integration uses Reply v1 calls elsewhere (fetch teams, etc.). The webhook endpoint is v3. Some accounts/keys may not have access or may require different auth behavior.
3) API key value has hidden whitespace:
   - If the stored key includes a trailing newline/space, auth can fail in non-obvious ways. This is easy to harden against.

Implementation plan (code changes)
A) Make webhook setup function “self-diagnosing” (backend function: supabase/functions/setup-reply-webhook/index.ts)
1) Normalize and validate the API key
   - Change:
     - const apiKey = integration.api_key_encrypted;
   - To:
     - const apiKey = (integration.api_key_encrypted ?? '').trim();
   - If apiKey is empty after trimming, return a clear error (and set webhook_status='error').

2) Add a lightweight “probe” request to confirm v3 access before creating a webhook
   - Before POST /v3/webhooks, call something simple in v3 that should exist, e.g.:
     - GET https://api.reply.io/v3/sequences?limit=1 (or GET /v3/webhooks if it supports listing)
   - Log and return (in a safe way) the probe results:
     - probeStatus
     - probeBodySnippet (first ~500 chars)
     - keyFingerprint (e.g., last 4 chars only) so we never log secrets
   - If probe fails (401/403/404), return a targeted message like:
     - “Reply API v3 probe failed (status 401). Your API key likely isn’t valid for v3.”
     - “Probe returned 404. This often indicates the key doesn’t have access to v3 endpoints, or the endpoint is blocked for this account.”

3) Add retry/fallback strategy for team vs account scope
   - If webhook creation fails with 404 and reply_team_id is set:
     - Retry once with an account-level subscription:
       - Either set subscriptionLevel='account' (with no teamIds), or omit subscriptionLevel entirely (defaults to account per Reply docs).
     - Reason: if the teamId is the issue, account-level may still succeed and at least enable live updates.
   - If the retry succeeds:
     - Save webhook_subscription_id/webhook_secret and mark webhook_status='active'
     - Optionally also record that we fell back to account-level (if you have an existing column; if not, just log it).

4) Improve response logging without leaking secrets
   - For failures, log:
     - response.status
     - response.statusText
     - response headers that are safe (some APIs include request IDs)
     - response body snippet (it’s currently empty, but if it ever contains a problem+json, we’ll capture it)
   - Ensure logs redact:
     - API key (never print)
     - webhook secret (don’t print the full secret; if needed, show first 6 chars only)

5) CORS hardening (small but worthwhile)
   - Update CORS allow-headers to include the full set recommended for web apps so preflights can’t cause confusing failures later:
     - authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version
   - Keep returning CORS headers on all responses (success + error).

B) Ensure the UI shows the real diagnostic message (frontend: src/hooks/useOutboundIntegrations.ts)
Problem
- supabase.functions.invoke often returns `error` with a generic message; `data` may not reliably include the JSON body on non-2xx responses, so your current “extract details from data” logic may not fire.

Fix
Option 1 (recommended): Return 200 even on upstream Reply failures
- Change setup-reply-webhook so that even when Reply returns a failure, our backend function responds with:
  - HTTP 200
  - JSON: { success: false, status: 404, details: "...", probe: {...} }
- Then update the client mutation to:
  - if (!data?.success) throw new Error(buildMessageFrom(data))
- This makes the UI reliably show the exact diagnostics we generate.

Option 2: Keep non-2xx but enhance extraction
- Investigate if supabase-js exposes the response body in error context (varies by version/runtime).
- This is less reliable than Option 1.

Acceptance criteria (what “fixed” looks like)
- Clicking “Re-enable Live Updates” results in one of:
  1) Success: webhook_status becomes “active” and a success toast appears.
  2) Failure with actionable toast, for example:
     - “Reply API v3 probe failed (401): invalid API key for v3 endpoints”
     - “Team-level subscription failed (404). Retried as account-level and succeeded.”
     - “TeamId 383893 not found/accessible for this key. Please re-select workspace.”

User-facing next steps after implementation
- If the diagnostic indicates “teamId not accessible”:
  - We’ll prompt you to re-check the selected workspace/team in the integration settings and try again.
- If the diagnostic indicates “v3 access denied”:
  - You’ll likely need to generate a new Reply API key that has v3 access (we’ll surface this clearly in the toast).

Files involved
- Backend function:
  - supabase/functions/setup-reply-webhook/index.ts
- Frontend error handling:
  - src/hooks/useOutboundIntegrations.ts

Risks / tradeoffs
- Adding probe calls adds a small extra external request during webhook setup, but this only happens when you click “Enable Live” / refresh, not during normal app usage.
- Fallback to account-level scope may be broader than team-level. If you want strict workspace isolation, we can make fallback optional (only when you opt-in).

Testing plan
1) Click “Re-enable Live Updates” for the failing integration.
2) Confirm either:
   - it succeeds, or
   - the toast now includes probe + scope information (not the generic non-2xx message).
3) If it succeeds, verify Reply is sending events by triggering a known event (e.g., email sent) and confirming your webhook event ingestion path receives it (via your existing webhook handler logs/table).
