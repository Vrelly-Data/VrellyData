

# v3.5 Stable Checkpoint: Email Stats Aggregation and Webhook Cleanup

## What changed since v3.4

Two improvements were made to the Data Playground:

1. **Email Stats Aggregation Fix** -- The CSV upload now correctly sums contact-level rows by campaign before writing to the database. Previously, individual contact rows (e.g., 164 rows) overwrote each other, leaving stats at ~1 instead of the true totals. The preview dialog also groups rows by campaign so you see "Import 2 Result(s)" instead of 164.

2. **Webhook Messaging Removal** -- The "Real-time via webhooks" and "Enable webhooks for LinkedIn tracking" footer text was removed from the Messages and Replies popover cards, since webhooks are no longer used.

## Files to update

### 1. `docs/V3.5_RELEASE_NOTES.md` (new file)
Document the two changes above with before/after comparisons, list the modified files, and reference the current state as stable.

### 2. `docs/STABLE_CHECKPOINTS.md` (update)
- Bump "Current Stable Version" from v3.4 to v3.5
- Update "Last Updated" to February 10, 2026
- Update the Quick Revert Command to reference v3.5
- Add a new **Data Playground Stable State (v3.5)** section documenting:
  - Email stats aggregation (contact-level rows summed by campaign before DB write)
  - Webhook messaging removed from dashboard popovers
  - Key files: `useEmailStatsUpload.ts`, `EmailStatsUploadDialog.tsx`, `PlaygroundStatsGrid.tsx`
- Add v3.5 row to the Change Log table
- Keep v3.4 section intact for history

### 3. `docs/SEARCH_FUNCTION_LOCK.md` (minor update)
- Update the Quick Reference table's "Current Version" from v3.2 to v3.5 so it stays consistent with the checkpoint docs

## What stays unchanged
- No database migrations needed
- No changes to `search_free_data_builder` or any filter logic
- All 18 Audience Builder filters remain locked at v3.3 baseline counts
- All v3.4 Data Playground sync logic (auto-link, contacts, paging) unchanged

