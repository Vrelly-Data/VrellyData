
## What’s actually happening (root cause)

From the backend logs + database rows we can see:

- `sync-reply-contacts` is successfully calling the Reply.io V3 endpoint and it reports **“source: V3 extended”**.
- But **every contact’s engagement flags remain false** (`delivered: false`, `replied: false`, etc.).
- And in the database, `synced_contacts.raw_data` currently looks like this (example):  
  `{"email": "...", "firstName": "...", "addedAt": "...", "contactId": ...}`  
  **No `status` object is present at all**, which is the part we need to compute delivered/replied.

This matches the Reply.io V3 docs: the “extended contacts” endpoint only returns engagement status if you request it via the query param:

- `additionalColumns=Status` (and optionally `CurrentStep,LastStepCompletedAt,Status`)

Right now we are **not** passing `additionalColumns`, so the API returns “base fields only”, and our code defaults missing status fields to `false`. That’s why email stats stay 0.

## Solution overview

Update `sync-reply-contacts` to request engagement columns explicitly from Reply.io V3:

- Change:
  - `/sequences/{id}/contacts/extended?limit=100&offset=0`
- To:
  - `/sequences/{id}/contacts/extended?limit=100&offset=0&additionalColumns=Status`
  - (optionally: `additionalColumns=CurrentStep,LastStepCompletedAt,Status`)

Then:
- Parse the returned `status` object and map it into `engagement_data`
- Recompute `deliveredCount`, `repliesCount`, etc. from those flags
- Update `synced_campaigns.stats` with the computed totals (preserving LinkedIn CSV fields)

## Implementation plan (code changes)

### 1) Fix the V3 request so engagement flags are returned
**File:** `supabase/functions/sync-reply-contacts/index.ts`

- Update the V3 endpoint builder in `fetchContactsV3Extended()` to include:
  - `additionalColumns=Status` (URL-encoded)
- Add a temporary diagnostic log for 1 contact per run (safe + minimal):
  - log the keys of the first returned contact
  - log whether `status` exists and its keys (not the whole payload)

Why: we want to confirm the API now returns:
```json
{
  "status": {
    "status": "Active",
    "replied": true/false,
    "delivered": true/false,
    "opened": true/false,
    "clicked": true/false,
    "bounced": true/false
  }
}
```

### 2) Make the V3 type mapping match the real payload
**File:** `supabase/functions/sync-reply-contacts/index.ts`

Update the V3 contact interface + mapper to handle what Reply actually returns:

- `addedAt` (not `addedTime`)
- `contactId` (often present instead of `id`)
- `linkedInProfile` vs `linkedinProfile` (handle both defensively)

Update `v3ToUnified()` to:
- use `contact.addedAt ?? contact.addedTime`
- set `id` from `contact.id ?? contact.contactId` so `external_contact_id` gets filled

### 3) Make “delivered” robust (optional but recommended)
Even with Status included, there’s a chance Reply’s `delivered` flag behaves unexpectedly for certain step types.

So we’ll compute “delivered-like” conservatively if needed:
- Prefer `status.delivered === true`
- If Reply doesn’t set `delivered` but sets `opened/replied/clicked/bounced`, treat that as “has email activity” for delivery counting.

This ensures you don’t end up with “114 sent, 2 replies” turning into “0 delivered, 2 replies”.

### 4) Confirm stats are persisted and not overwritten
**File:** `supabase/functions/sync-reply-campaigns/index.ts`

No big changes required, but we’ll verify one important thing:
- `sync-reply-campaigns` should **not overwrite** the `sent/delivered/replies` that `sync-reply-contacts` computes.
- Today it merges `existingStats` and only overwrites with API stats if they exist (they don’t), so this should already be fine.
- If we see any overwrite happening, we’ll adjust the merge to always keep the higher-confidence contact-derived stats.

### 5) End-to-end verification (what we’ll validate after implementing)
After updating the function:

1. Trigger sync for a campaign you *know* has email activity (the one with ~114 sent / ~2 replies).
2. Check backend logs for:
   - `Total contacts to sync: N (source: V3 extended)`
   - A debug line that confirms `status` keys exist
   - `Engagement stats: delivered=..., replies=..., opens=...` should be non-zero
3. Verify DB reality:
   - At least some `synced_contacts.engagement_data.delivered` or `...replied` are true
4. Confirm UI:
   - `/playground` stats tiles show non-zero Email Deliveries + Email Replies
   - Campaign list shows non-zero `sent` and `replies`

## Why this should finally unlock the “114 / 2” numbers
Because we’ll stop guessing from missing fields and instead request the exact columns Reply requires (`additionalColumns=Status`) that contain the engagement flags we’re counting.

## Scope
- Primary fix: `supabase/functions/sync-reply-contacts/index.ts`
- Optional safeguard: minor merge protection in `supabase/functions/sync-reply-campaigns/index.ts`

## Rollback plan
If Reply V3 still doesn’t return status in your account:
- Keep the existing V1 fallback (contacts still sync)
- Add a “Stats unavailable from API” indicator (instead of silently showing 0)
- Consider re-enabling webhook-based stats as the long-term accurate source
