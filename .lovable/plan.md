
## What’s happening (confirmed)
There are two separate “100” limits in the current system:

1) **Backend sync is only persisting ~100 unique contacts per campaign**
- The database currently has **100 contacts for the campaign** (not just the UI).
- Your sync function logs can still show “5000 fetched/processed” because the contact endpoint pagination is being called incorrectly:
  - Reply’s “List contacts in sequence (extended)” endpoint uses **`offset`**, not `page`.
  - Because we pass `page=...`, the API effectively keeps returning the **same first 100 contacts** (duplicates), and `hasMore` stays true, so we loop until the safety cap and “process” a big number—yet only **100 unique emails** exist to upsert.

2) **Frontend People table is explicitly capped at 100 rows**
- `PeopleTab.tsx` still does: `filteredContacts.slice(0, 100)`

So even after we fix the backend, the UI would still only show 100 unless we change the table rendering/pagination.

---

## Goals
1) Sync should store the full set of contacts (e.g., 5,000+) for a campaign.
2) People tab should display beyond 100 (ideally with pagination so it stays fast).
3) CSV export should export the full filtered dataset (not just the first page).

---

## Implementation Plan

### A) Fix the backend contact sync pagination (critical)
**File:** `supabase/functions/sync-reply-contacts/index.ts`

1) **Switch pagination from `page` to `offset`**
- Use:
  - `limit=100`
  - `offset=0, 100, 200, ...`
- Pseudocode:
  - `offset = 0`
  - while `hasMore`:
    - GET `/sequences/${sequenceId}/contacts/extended?limit=100&offset=${offset}`
    - append returned `items`
    - `offset += items.length`
    - `hasMore = response.info?.hasMore ?? (items.length === 100)`
    - break if `items.length === 0` (safety)

2) **Add a “no progress” safety guard**
- Track unique IDs/emails seen; if a page returns no new unique contacts, stop early.
- Also keep a max-iterations cap (prevents infinite loops if the API misbehaves).

3) **Deduplicate before upsert**
- Build a `Map` keyed by `(campaign_id + email)` or by `external_contact_id` to avoid repeatedly upserting duplicates.
- This also makes logging/reporting honest (“unique contacts prepared”).

4) **Improve reporting**
- Return both:
  - `totalFetched` (raw items across pages)
  - `uniquePrepared` (deduped)
  - `verifiedCount` (actual DB count after sync)
- Update the UI toast to prefer `verifiedCount`/`uniquePrepared` so the user isn’t told “5000” when only 100 exist.

---

### B) Fix the People tab “100 rows” UI cap
**File:** `src/components/playground/PeopleTab.tsx`

We’ll replace the hard slice with real pagination.

1) **Remove `slice(0, 100)`**
- Either show all (not recommended for 5k+ rows) or paginate.

2) **Add pagination UI**
- Reuse existing `PaginationControls` (`src/components/search/PaginationControls.tsx`) to keep patterns consistent.
- Add state:
  - `currentPage`
  - `perPage` (50/100/200)

3) **Paginate the rendered rows**
- Render only the current page of contacts.

---

### C) Fix data fetching so we can actually view >1000 rows reliably
Once the backend stores 5,000+, the current `useSyncedContacts()` query will likely hit the backend’s default row limit (often ~1000 per request). To make PeopleTab reliable:

**Option (recommended):** add a paginated contacts hook used only by PeopleTab
- Create `useSyncedContactsPaged({ campaignId, status, page, perPage })`
- Use:
  - `.select(..., { count: 'exact' })`
  - `.range(from, to)`
  - `.eq('campaign_id', ...)` when a specific campaign is selected
  - `.eq('status', ...)` when status filter is set

This avoids loading thousands into memory and keeps the tab fast.

(We will keep the existing `useSyncedContacts()` hook unchanged so other dialogs/screens don’t break.)

---

### D) Update CSV export so it exports “everything”, not just the current page
**Files:** `PeopleTab.tsx` (and/or a small helper)

When the table is paginated server-side, we’ll update export to:
- Fetch **all** matching rows in a loop (range 0–999, 1000–1999, etc.) for the selected campaign/status
- Then build the CSV from the full dataset

This ensures the CSV matches what you expect (all contacts), regardless of UI pagination.

---

## How we’ll verify it’s fixed
1) Trigger “Refresh Contacts” for a campaign you know has thousands.
2) Confirm logs show something like:
   - `Fetched X total items`
   - `Unique prepared Y`
   - `Verified in database Y`
3) Run a database count check (internally) to confirm the campaign has >100 rows.
4) In People tab:
   - You can page past 100
   - Total count matches reality
5) Export CSV:
   - CSV row count matches the total filtered count (not just one page)

---

## Expected outcome
- The sync will persist all contacts (no longer stuck at 100 unique).
- The People tab will display and navigate thousands of contacts smoothly (paged).
- CSV export will include the full filtered dataset.
