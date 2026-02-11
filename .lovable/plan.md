

# Update Documentation to v3.6 Stable State

## What Changes

Update both documentation files to reflect the current stable state after the v3.6 changes:
- DNC (Do Not Include) exclusion filters added to `search_free_data_builder` (37 parameters)
- 100,000+ display cap on search results
- Case-insensitive industry suggestion deduplication in FilterBuilder

## Files to Update

### 1. `docs/STABLE_CHECKPOINTS.md`

- Update header: Last Updated to February 11, 2026, Current Stable Version to v3.6
- Update Quick Revert Command to "Revert to v3.6 stable state"
- Update Database Functions table: `search_free_data_builder` now has 37 parameters
- Update Pre-Change Checklist: signature reference from 29 to 37 parameters
- Update Manual Revert Procedure: reference 37 parameters
- Add v3.6 entry to the Change Log:
  - v3.6 | 2026-02-11 | DNC exclusion filters (37 params), 100,000+ display cap, case-insensitive industry dedup in FilterBuilder
- Add new **Audience Builder Stable State (v3.6)** section documenting:
  - DNC exclusion filters: 8 new exclude parameters added to search function
  - Display cap: `TOTAL_DISPLAY_CAP = 100,000` in `useFreeDataSearch.ts`, formatted as "100,000+" in UI
  - Industry dedup: `dedup()` helper in `FilterBuilder.tsx` normalizes Title Case before Set dedup
  - Key files: `useFreeDataSearch.ts`, `AudienceBuilder.tsx`, `PreviewTable.tsx`, `FilterBuilder.tsx`

### 2. `docs/SEARCH_FUNCTION_LOCK.md`

- Update Version to 3.6, Last Updated to February 11, 2026
- Update Quick Revert Command to "Revert to v3.6 stable state"
- Update Guardrails: parameter signature reference from 29 to 37
- Update Quick Reference table: Current Version to v3.6, Parameter Count to 37, Revert Command to v3.6
- Add note about DNC exclusion parameters (8 new p_exclude_* params)
- Add note about frontend display cap and industry dedup under Frontend Normalization section

## What Does NOT Change

- Database function `search_free_data_builder` -- untouched (already at 37 params from DNC migration)
- Baseline counts -- still 724 records, same filter counts (exclusions don't affect baselines when empty)
- All existing recovery commands and procedures remain valid

