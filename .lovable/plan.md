
## What’s happening (root cause)

Your campaigns are showing as “paused” in the app even though they’re “active” in Reply because we’re **misinterpreting Reply’s campaign status codes**.

From Reply’s own API docs for **v1 campaigns**, the `status` integer is:

- `0 = New`
- `2 = Active`
- `4 = Paused`

But our current `normalizeStatus()` logic assumes a different mapping (it treats `2` as “paused”), so **any truly-active campaign (status 2) gets saved as “paused”** in `synced_campaigns`, and then the UI correctly displays that incorrect value.

This impacts:
- Campaign table status badges
- “Active Campaigns” count (and any other logic relying on `status`)

---

## Goal

Make campaign statuses in our database and UI match what Reply actually returns:
- `2 -> active`
- `4 -> paused`
- keep safe handling for other/unknown status values

---

## Changes to make (code)

### 1) Fix status normalization in backend functions that ingest campaigns

We need to update **both** functions that read Reply campaigns and write to `synced_campaigns`, otherwise one can overwrite the other with the wrong mapping:

- `supabase/functions/sync-reply-campaigns/index.ts`
- `supabase/functions/fetch-available-campaigns/index.ts`

Implementation details:
- Replace the existing numeric `statusMap` with a campaign-specific mapping consistent with Reply v1 campaign docs.
- Keep string status handling (`"Active"`, `"Paused"`) as lowercase (already supported).
- Add a safe fallback to `unknown` if a new/unexpected numeric code appears.

Suggested mapping (campaign-focused):
- `0 => 'draft'` (or `'new'`; we’ll keep `'draft'` to match existing UI badge naming)
- `2 => 'active'`
- `4 => 'paused'`
- optionally handle `7 => 'finished'` if we’ve seen it in real payloads (we have), so we don’t regress those rows
- everything else => `'unknown'`

Also update comments in both files so future work doesn’t reintroduce the mismatch.

### 2) Prevent “Manage Campaigns” from reintroducing wrong statuses
This is automatically handled by step (1) because `fetch-available-campaigns` is what powers the Manage Campaigns dialog and also upserts into `synced_campaigns`.

---

## Data correction (existing records)

Even after code is fixed, previously-saved rows will still have wrong `status` until a refresh happens.

Two options:

### Option A (simplest): re-sync after deploy
- After the function mapping is corrected, clicking **Sync** will rewrite `synced_campaigns.status` correctly from Reply.
- Opening **Manage Campaigns** will also refresh/upsert campaigns and correct statuses.

### Option B (recommended for immediate correctness): one-time database correction
Run a safe, one-time backend migration that updates existing `synced_campaigns.status` values based on `raw_data->>'status'` for Reply-sourced campaigns:

- If `raw_data.status = 2` set `status='active'`
- If `raw_data.status = 4` set `status='paused'`
- Leave others unchanged

Scope it safely by joining `outbound_integrations` where `platform='reply.io'`, so we don’t touch CSV/imported rows.

This makes the UI correct immediately without waiting for the next sync.

---

## Validation / Testing steps (end-to-end)

1. Go to **Data Playground → Connected Platforms**.
2. Click **Sync** on the Reply integration.
3. Verify in **Campaigns table**:
   - “HVAC campaign” shows **Active** (not Paused)
4. Verify the **Active Campaigns** stat card:
   - should count campaigns with status `active` (and `paused` if we still consider “running” = active+paused in the stats hook)
5. Open **Manage Campaigns** and confirm statuses do not flip back to paused.

---

## Files involved

Backend functions:
- `supabase/functions/sync-reply-campaigns/index.ts`
- `supabase/functions/fetch-available-campaigns/index.ts`

(Optional) one-time data fix:
- new DB migration that updates `synced_campaigns.status` based on `raw_data.status` for Reply integrations.

---

## Risks / edge cases considered

- Reply might return status as a string in some endpoints; we already normalize strings to lowercase and will keep that behavior.
- If Reply introduces new numeric codes, we’ll surface them as `unknown` rather than mislabeling them.
- If any other part of the system writes `synced_campaigns.status`, it will now use the corrected mapping in both campaign ingestion functions, preventing “status flapping”.

