
## What’s actually happening (why you’re seeing 0 / 0)

Two separate issues are stacking on top of each other:

1) **“Contacts enrolled” is currently not being populated during the normal Sync flow**
- The integration “Sync” button runs `sync-reply-campaigns`.
- `sync-reply-campaigns` uses Reply V3 `/sequences` and **does not provide `peopleCount`**.
- We *used* to have `peopleCount` coming from the “Available campaigns” flow (Reply V1 `/campaigns`), but that only runs when you open **Manage Campaigns** (via `fetch-available-campaigns`) — not during a normal “Sync”.
- Result: campaign rows exist, but `stats.peopleCount` stays 0 → dashboard shows **0 contacts**.

2) **The contact sync is currently “fake paging” and repeatedly re-fetching the same page**
- `sync-reply-contacts` is using V3 `GET /sequences/{id}/contacts/extended?limit=100&offset=...`.
- The function logs show it fetched **10,000** items but only **100 verified** in the database.
- That means the API is effectively returning the same 100 contacts over and over (offset not being applied reliably), so your DB ends up with only the first page’s unique emails.
- Result: even when you do run contact sync, it doesn’t reach the real enrolled count (1,053) and can’t compute “sent” correctly.

## Goal metrics (based on what you confirmed)
- **Contacts count**: total *enrolled in sequences* (your 1,053 is the right target).
- **Emails sent**: “total messages sent” (Reply says 114). With the available data, the closest reliable proxy we can compute is “contacts with Delivered=true” from the extended contacts endpoint; for your account right now that should line up with 114 if each delivered contact has received one message so far. We’ll label it clearly in UI to avoid future confusion.

---

## Implementation plan (to make this reliably work again)

### A) Fix the contact sync paging so it can actually reach 1,053
**File:** `supabase/functions/sync-reply-contacts/index.ts`

1. **Add guardrails against “repeating pages”**
   - Track a lightweight “page signature” for each page (e.g., firstEmail + lastEmail + count).
   - Track how many **new unique emails** we get per page.
   - If a page is identical to the previous one, or yields 0 new emails for N consecutive pages (e.g., 2–3), stop paging and return a clear “paging-stuck” reason.

2. **Deduplicate while fetching**
   - Maintain a `Map<email, contact>` and only keep the newest/most complete version.
   - This prevents the “10,000 processed but only 100 unique” situation from wasting time.

3. **Upsert only the unique set**
   - Build `records` from the `Map` values and upsert in batches.
   - Compute stats (delivered/replies/opens/etc.) from the unique set.

4. **Return and log diagnostics**
   - Include fields like:
     - `totalFetchedRaw`
     - `uniquePrepared`
     - `duplicatePagesDetected`
     - `stopReason` (e.g., `hasMore_false`, `empty_page`, `repeating_page_guard`)
   - This will make future debugging immediate (instead of guessing).

Why this works:
- Even if Reply’s offset paging is flaky, we’ll detect it early and avoid infinite/huge loops.
- If offset *does* work, we’ll fetch the full enrolled set and peopleCount will land at ~1,053.

---

### B) Ensure “Contacts enrolled” (peopleCount) is populated during the normal Sync button flow
Right now, your normal “Sync” does not call the function that pulls peopleCount.

**File:** `src/hooks/useOutboundIntegrations.ts`

1. In `syncIntegration` (and the post-add auto sync), change the flow to:
   - Call `fetch-available-campaigns` first (Reply V1 `/campaigns` is where `peopleCount` comes from in your codebase).
   - Then call `sync-reply-campaigns` (Reply V3 sequences for status/name consistency).
   - Then run the background per-campaign contact sync (existing `startContactsSync`).

2. Add better surfaced errors:
   - If `fetch-available-campaigns` fails, show a toast that the dashboard will show 0 contacts until it’s fixed.
   - If contact sync for a campaign fails, store the message in console + show a warning toast with “X campaigns failed” (you already collect errors in People tab; we’ll mirror that in the auto background sync).

Why this works:
- You’ll immediately see enrolled counts (1,053) on the dashboard after clicking Sync, even before detailed contacts finish syncing.
- This restores the “it worked before” behavior because your codebase already had a working path to populate peopleCount; it just wasn’t wired into the Sync button.

---

### C) Stop `sync-reply-campaigns` from overwriting user link choices
**File:** `supabase/functions/sync-reply-campaigns/index.ts`

Currently it sets `is_linked: true` on every upsert.

We will change it to:
- Read `existingCampaign.is_linked` (if present) and preserve it.
- Default to `false` for brand new campaigns unless the user explicitly links them in Manage Campaigns.

Why this matters:
- Prevents accidental “everything linked” which then triggers huge background syncs unexpectedly.
- Keeps the system predictable.

---

### D) Make the UI reflect the intended metrics and progress so it doesn’t feel “broken”
**Files:** 
- `src/hooks/usePlaygroundStats.ts`
- `src/components/playground/PlaygroundStatsGrid.tsx` (or wherever the cards are rendered)
- (optional) `src/components/playground/IntegrationSetupCard.tsx`

1. **Show “Enrolled” explicitly (sum of peopleCount across linked campaigns)**
   - This matches your definition of contacts.

2. **Show “Messages sent” as delivered-contact proxy when stats API is unavailable**
   - Use contact engagement (`engagement_data.delivered`) aggregated across synced contacts.
   - Add a tooltip/subtitle like “Derived from delivered contacts” to avoid future confusion.

3. **Progress / clarity**
   - When background contact sync is running, show a visible “Syncing contacts…” indicator (not just the integration badge).
   - If the user clicks Sync and immediately sees 0, it should say “Campaigns synced; contacts syncing next…” rather than silently doing work.

---

## How we’ll verify it’s fixed (end-to-end)
1. On `/playground`, click **Sync** on the Reply integration.
2. Confirm:
   - Campaign list appears.
   - Total **Enrolled contacts** becomes ~**1,053** after the discovery step finishes.
3. Let contact sync complete (or run it from People tab “Sync All”).
4. Confirm:
   - People tab shows close to the enrolled count for linked campaigns.
   - “Messages sent” becomes ~**114** (from delivered contacts), assuming Reply’s delivered flag aligns with that number for your account.
5. Confirm we no longer see “10,000 fetched” for a sequence that should have ~1,053; if offset is broken, we should see a clean early stop with `stopReason=repeating_page_guard` and a warning that the API paging is misbehaving.

---

## Risks / fallback
- If Reply’s extended contacts endpoint truly cannot page correctly for your account, we’ll still be protected from infinite loops.
- In that case, the fallback is to:
  - Use Reply V1 people listing for full enrollment counts (reliable),
  - And show “Messages sent” as “unknown / requires webhooks or stats endpoint” until we can access a reliable per-sequence stats endpoint.

## Files we will change
- `supabase/functions/sync-reply-contacts/index.ts` (paging + dedupe + diagnostics)
- `src/hooks/useOutboundIntegrations.ts` (wire `fetch-available-campaigns` into Sync flow + better error surfacing)
- `supabase/functions/sync-reply-campaigns/index.ts` (preserve `is_linked`)
- `src/hooks/usePlaygroundStats.ts` (+ optional UI files for clearer cards/progress)

