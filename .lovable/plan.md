
## Goal
Make “Emails sent” and “Email replies” populate reliably during sync without breaking the existing integration flow.

Right now, campaign-level stats endpoints are consistently returning **404** (V3 Statistics, V3 Reports, and V1 single-campaign). That’s why campaign stats stay at 0. Separately, contact sync is currently **failing** with `deliveredCount is not defined`, which prevents contact engagement fallback from ever working.

## What we now know (from your logs + code)
1. `sync-reply-campaigns` can fetch sequences, but every stats endpoint attempt returns **404**, so it logs:
   - `Could not fetch V3 stats... 404`
   - `Could not fetch V3 report... 404`
   - `Could not fetch V1 stats... 404`
   and ends with `Final stats: sent=0, replies=0`.

2. `sync-reply-contacts` currently throws at the end:
   - `ReferenceError: deliveredCount is not defined`
   This is why the client sees non-2xx responses when trying to sync contacts.

3. The UI (`usePlaygroundStats`) has a built-in fallback:
   - If campaign stats show **0 deliveries**, it will compute deliveries/replies from `synced_contacts.engagement_data`.
   - That fallback is currently useless because engagement flags are being stored as all `false`, and contact sync is erroring.

4. The official Reply API docs indicate there is a V3 endpoint that returns **per-contact engagement flags**:
   - `GET /v3/sequences/{id}/contacts/extended`
   - The response includes `status.replied`, `status.delivered`, `status.opened`, etc.
   This gives us a reliable path to compute email stats even when “aggregate stats endpoints” 404.

## Strategy (minimal risk)
We will **stop depending on broken stats endpoints** for correctness and instead:
- Sync contact engagement from **V3 “contacts extended”**
- Compute aggregate stats (delivered/replied/opened/etc.) by **counting those contact statuses**
- Update `synced_campaigns.stats` with the computed values (without overwriting LinkedIn CSV fields)
- Keep the existing V1 contact sync as a fallback if V3 contacts extended fails (so we don’t break working contact imports for accounts where V3 access is restricted)

This keeps your architecture intact:
- `sync-reply-campaigns` still owns campaign metadata (name/status/workspace filtering)
- `sync-reply-contacts` becomes the reliable source of actual delivered/replied metrics

## Implementation details

### A) Fix the immediate crash in `sync-reply-contacts`
**File:** `supabase/functions/sync-reply-contacts/index.ts`

- Remove references to `deliveredCount`, `repliesCount`, `opensCount` in the response payload (or reintroduce properly defined counters).
- Ensure the function always returns a 200 on success so the UI doesn’t show “failed to sync” even if data is written.

This alone will restore stable contact syncing.

### B) Add V3 “contacts extended” ingestion (primary path)
**File:** `supabase/functions/sync-reply-contacts/index.ts`

Add:
- `REPLY_API_V3 = "https://api.reply.io/v3"`
- `fetchFromReplyioV3()` with strict header casing (`X-API-Key`, `Accept`, `Content-Type`, and optionally `X-Reply-Team-Id` if needed)
- `fetchWithRetryV3()` similar to V1 retry logic
- A robust parser to handle variations in response shape:
  - `response.items` array + `response.info.hasMore` is expected, but we’ll defensively support `contacts`, `data`, etc.

Pagination:
- Use `limit=100` and `offset` style pagination (per docs), e.g.:
  - `/sequences/${sequenceId}/contacts/extended?limit=100&offset=0`
  - increment offset by 100 until `hasMore` false or returned length < limit.

Mapping to DB:
- Keep current upsert strategy (`campaign_id,email`) and continue populating:
  - `email`, `first_name`, `last_name`, `company`, `job_title`, `linkedin_url`, `added_at`
- Update `engagement_data` from the V3 `status` object:
  - `delivered`, `replied`, `opened`, `clicked`, `bounced`, `finished`, `optedOut`
- Keep `raw_data` as the full contact payload for future debugging.

### C) Compute and store campaign-level email stats from contacts (authoritative)
**File:** `supabase/functions/sync-reply-contacts/index.ts`

While iterating contacts, compute:
- `deliveredCount = count(status.delivered === true)`
- `repliesCount = count(status.replied === true)`
- `opensCount = count(status.opened === true)`
- `clicksCount = count(status.clicked === true)`
- `bouncesCount = count(status.bounced === true)`
- `sentCount`:
  - We’ll define this conservatively to match your UI expectations:
    - `sent = deliveredCount` (aligns with how your current campaign sync treats “sent” == “deliveredContacts”)
    - optionally also store `bouncesCount` separately so you can later define `sent = delivered + bounces` if desired.

Then update `synced_campaigns.stats` preserving existing values:
- Keep LinkedIn CSV fields untouched (same preservation logic you already use elsewhere)
- Update:
  - `stats.sent`
  - `stats.delivered`
  - `stats.replies`
  - `stats.opens` (optional)
  - `stats.peopleCount` (from verifiedCount)
- Do not clobber other stats keys (merge like you already do).

Result:
- `usePlaygroundStats` will start showing email deliveries/replies immediately from campaign stats, and even if it doesn’t, the fallback from contacts will work because engagement flags will be real.

### D) Keep V1 contact sync as a fallback (don’t break logic)
If V3 contacts extended fails (403/404/etc.):
- Fall back to the current V1 `/campaigns/{id}/people` flow (your existing pagination/dedup remains useful)
- In that fallback path, engagement flags may remain sparse, but at least contacts still sync.

This ensures we don’t regress existing “contact import” reliability.

### E) (Optional, low-risk) Reduce noisy 404 warnings in `sync-reply-campaigns`
**File:** `supabase/functions/sync-reply-campaigns/index.ts`

Right now stats endpoints always 404, so logs are noisy. We can:
- Treat 404 from those endpoints as “expected” and log once per run (or downgrade to debug).
- Keep the existing merge behavior so it will preserve any stats that contact sync computed.

Not required for correctness, but improves debugging clarity.

## Verification checklist (end-to-end)
1. In the UI, click Sync for the Reply integration.
2. Confirm the background contact sync no longer errors (no more “deliveredCount is not defined”).
3. Open People tab:
   - Verify “Opened / Replied / Clicked / Opted out” columns start showing real values for at least some contacts.
4. Check dashboard stats:
   - Email deliveries should become non-zero.
   - Email replies should reflect reality (your expected ~2 for that campaign).
5. Confirm `synced_campaigns.stats` for a campaign contains non-zero `sent/delivered/replies` after contact sync completes.

## Why this should finally work
- We are switching from “aggregate endpoints that your account/API access is returning 404 for” to an endpoint the official docs show as the canonical way to retrieve contact engagement.
- Your frontend already supports computing stats from per-contact engagement; it just wasn’t getting real engagement data and contact sync was failing.

## Scope / files touched
- `supabase/functions/sync-reply-contacts/index.ts` (main fix + V3 contacts ingestion + computed stats + remove crash)
- (Optional) `supabase/functions/sync-reply-campaigns/index.ts` (log noise reduction only; no behavior change required)

## Rollback plan (if needed)
- Keep V1 contact sync intact behind the fallback path.
- If V3 contacts extended causes issues, we can disable it by flipping the “try V3 first” logic and returning to V1-only without schema changes.
