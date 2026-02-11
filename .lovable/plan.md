

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
- Add v3.6 entry to the Change Log
- Add new **Audience Builder Stable State (v3.6)** section documenting:
  - DNC exclusion filters: 8 new exclude parameters
  - Display cap: `TOTAL_DISPLAY_CAP = 100,000`, formatted as "100,000+" in UI
  - Industry dedup: `dedup()` helper in `FilterBuilder.tsx`
  - Key files list

### 2. `docs/SEARCH_FUNCTION_LOCK.md`

- Update Version to 3.6, Last Updated to February 11, 2026
- Update all revert commands to v3.6
- Update parameter count references from 29 to 37
- Expand Frontend Normalization section with display cap and industry dedup info
- Update Quick Reference table with new values

## What Does NOT Change

- Database function `search_free_data_builder` -- untouched
- Baseline counts -- still 724 records, same filter counts
- All existing recovery commands and procedures remain valid

