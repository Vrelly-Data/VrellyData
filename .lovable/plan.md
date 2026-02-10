

# Fix: Restore LinkedIn Field Names in search_free_data_builder

## What Broke

Exactly **2 prospect data checks** use the wrong JSONB field name:

| Parameter | Currently checks | Should check | Records affected |
|---|---|---|---|
| `p_has_linkedin` | `linkedinUrl` (0 matches) | `linkedin` (400 matches) |
| `p_has_company_linkedin` | `companyLinkedinUrl` (0 matches) | `companyLinkedin` (203 matches) |

All other 35 parameters are working correctly -- verified by direct database queries.

## What Does NOT Change

Everything else stays identical:
- All 37 parameters keep their positions and defaults
- All non-LinkedIn filters return correct counts (verified above)
- DNC exclusion parameters remain functional
- No frontend code changes needed
- No changes to filterConversion.ts, useFreeDataSearch.ts, or FilterBuilder.tsx

## The Fix

**1 database migration** that uses `CREATE OR REPLACE FUNCTION` to update only 4 lines in the function body (2 checks x 2 occurrences in COUNT and RETURN QUERY):

```sql
-- Line change 1 (p_has_linkedin in COUNT):
-- FROM: AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
-- TO:   AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))

-- Line change 2 (p_has_company_linkedin in COUNT):
-- FROM: AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
-- TO:   AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != ''))

-- Same 2 changes repeated in the RETURN QUERY section
```

The migration will include the full function body (required by `CREATE OR REPLACE`) but only these 4 lines differ from the current deployed version.

## Verification After Fix

- `p_has_linkedin = true` should return **400** (was 0)
- `p_has_company_linkedin = true` should return **203** (was 0)
- All other filters remain unchanged (already verified working)

## Revert Safety

If anything goes wrong: **"Revert to v3.5 stable state"**

