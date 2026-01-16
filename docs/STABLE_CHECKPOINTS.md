# Stable Checkpoints

> **PURPOSE:** This document timestamps stable states of the application for easy reference and recovery.  
> **USAGE:** Reference these checkpoints when the system needs to be restored to a known-good state.

---

## Checkpoint: v2.2 - January 16, 2026

### ✅ Status: STABLE

Fixed Seniority, Department, Income, Net Worth filter logic. Added verification scripts.

---

## Checkpoint: v2.1 - January 16, 2026 (Previous)

### Status: SUPERSEDED BY v2.2

All filters working, seniority normalization fixed, documentation updated.

---

### Database Functions (15 total, 0 duplicates)

| Function Name | Parameters | Status |
|---------------|------------|--------|
| `search_free_data_builder` | 28 | ✅ Core search - LOCKED |
| `deduct_credits` | 2 | ✅ Stable |
| `get_all_profiles_admin` | 0 | ✅ Stable |
| `get_filter_suggestions` | 0 | ✅ Stable |
| `get_user_team_id` | 1 | ✅ Stable |
| `handle_new_user` | 0 | ✅ Trigger |
| `handle_new_user_team` | 0 | ✅ Trigger |
| `has_role` | 3 | ✅ Stable |
| `is_global_admin` | 1 | ✅ Stable |
| `log_audit_event` | 4 | ✅ Stable |
| `parse_employee_count_upper` | 1 | ✅ Stable |
| `reset_daily_credits_if_needed` | 1 | ✅ Stable |
| `reset_monthly_credits` | 0 | ✅ Stable |
| `title_matches_seniority` | 2 | ✅ Stable |
| `update_credits_for_testing` | 2 | ✅ Stable |
| `update_updated_at_column` | 0 | ✅ Trigger |

---

### Working Filters (v2.2)

| Filter | Status | Notes |
|--------|--------|-------|
| Keywords | ✅ | Searches 20+ fields |
| Job Titles | ✅ | ILIKE matching |
| Seniority | ✅ | **FIXED v2.2** - Added 'c suite', 'cxo', 'founder' |
| Department | ✅ | **FIXED v2.2** - Added 'Executive', 'technical' |
| Company Size | ✅ | Range parsing + bypass |
| Company Revenue | ✅ | Range parsing + bypass |
| Person City | ✅ | ILIKE |
| Person Country | ✅ | ILIKE |
| Company City | ✅ | ILIKE |
| Company Country | ✅ | ILIKE |
| Has LinkedIn | ✅ | Checks `linkedin` + `linkedinUrl` |
| Has Email | ✅ | Field existence |
| Has Phone | ✅ | Field existence |
| Technologies | ✅ | ILIKE matching |
| Industries | ✅ | ILIKE matching |
| Prospect Data Dropdown | ✅ | All 6 options working |
| Income | ✅ | **FIXED v2.2** - 84 records, parsing corrected |
| Net Worth | ✅ | **FIXED v2.2** - 87 records, parsing corrected |
| Skills | ✅ | 25 records have data |
| Interests | ✅ | 6 records have data |

---

### Filters Awaiting Data

| Filter | Expected Field | Format |
|--------|----------------|--------|
| Gender | `gender` | `"male"`, `"female"`, `"other"` |

---

### Table Row Counts

| Table | Count | Status |
|-------|-------|--------|
| `free_data` | 388 | ✅ Small |
| `unlocked_records` | 690 | ✅ Small |
| `people_records` | 0 | ✅ Empty |
| `company_records` | 0 | ✅ Empty |

---

### Performance Indexes

- `free_data`: 7 indexes (recommend adding more for scale)
- `unlocked_records`: 4 indexes ✅
- `people_records`: 4 indexes ✅
- `company_records`: 4 indexes ✅

---

### Health Check Results

```
✅ No duplicate functions
✅ search_free_data_builder exists and is unique
✅ All RLS policies in place
✅ All tables accessible
```

---

### Recovery Instructions

To return to this stable state:

1. **Check current state:** Run `docs/HEALTH_CHECK.sql`
2. **Compare against this checkpoint:** Verify function count and signatures match
3. **If recovery needed:** Restore from Git history to this commit date

---

### Git Reference

**Date:** January 16, 2026  
**Commit Message Reference:** "Fix seniority normalization, update documentation v2.1"

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| Jan 16, 2026 | v2.2 | Fixed Seniority/Department/Income/NetWorth logic, added QUICK_CHECK.sql, added FILTER_DATA_MAPPING.md |
| Jan 16, 2026 | v2.1 | Fixed seniority normalization (C-Level→138, VP→33), updated filter status for Income/Skills/Interests/NetWorth |
| Jan 15, 2026 | v2.0 | Initial stable checkpoint with all filters working |

---

**Next Checkpoint:** Create when adding new major features or database changes.
