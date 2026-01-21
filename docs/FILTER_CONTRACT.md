# Filter Contract Documentation

**Purpose**: Authoritative reference for filter field names, expected counts, and revert procedures.  
**Last Updated**: January 21, 2026  
**Version**: 3.3

---

## 🚨 CRITICAL: DO NOT MODIFY THESE FIELD NAMES

The `search_free_data_builder` function uses these exact field names. Changing them will break filters.

**To revert to stable state, say:** "Revert to v3.3 stable state"

---

## 📋 Authoritative Field Mapping

### Demographics Filters

| UI Filter | DB Field | Type | Sample Value | Notes |
|-----------|----------|------|--------------|-------|
| Income | `incomeRange` | string | `$45` | Numeric portion used for comparison |
| Net Worth | `netWorth` | string | `$85` | Supports negative values |
| Gender | `gender` | string | `M`, `F` | Frontend converts male→M, female→F |

### Professional Filters

| UI Filter | DB Field | Type | Sample Value | Notes |
|-----------|----------|------|--------------|-------|
| Job Title | `title` | string | `CEO`, `Manager` | ILIKE match |
| Seniority | `seniority`, `title` | string | `C-Level` | Regex patterns via title_matches_seniority |
| Department | `department` | string | `Executive` | Regex patterns |
| Company Size | `companySize` | string | `1-10`, `51-200` | Parsed by `parse_employee_count_upper()` |
| Industry | `industry` | string | `Technology` | Exact match (lowercase) |
| Company Revenue | `companyRevenue`, `revenue`, `annualRevenue` | string | `$5M`, `$10,000,000` | Parsed by `parse_revenue_to_numeric()` |

### Technology & Skills Filters

| UI Filter | DB Field(s) | Notes |
|-----------|------------|-------|
| Technologies | `technologies` | JSONB array or comma-separated string |
| Person Skills | `skills` | JSONB array or comma-separated string |
| Person Interests | `interests` | JSONB array or comma-separated string |

### Prospect Data Filters

| UI Filter | DB Field(s) | Notes |
|-----------|------------|-------|
| Has Email | `email`, `businessEmail`, `personalEmail` | Any non-null matches |
| Has Phone | `phone`, `mobilePhone` | Any non-null matches |
| Has LinkedIn | `linkedin`, `linkedinUrl` | Both checked |
| Has Facebook | `facebook`, `facebookUrl` | v2.7 fix: Added facebookUrl |
| Has Twitter | `twitter`, `twitterUrl` | v2.7 fix: Added twitterUrl |
| Has Personal Email | `personalEmail` | Single field check |
| Has Business Email | `businessEmail` | Single field check |
| Has Company Phone | `companyPhone` | Single field check |
| Has Company LinkedIn | `companyLinkedin` | Single field check |
| Has Company Facebook | `companyFacebook`, `companyFacebookUrl` | v2.7 fix: Added Url variant |
| Has Company Twitter | `companyTwitter`, `companyTwitterUrl` | v2.7 fix: Added Url variant |

### Location Filters

| UI Filter | DB Field(s) | Notes |
|-----------|------------|-------|
| City | `city`, `personCity`, `companyCity` | COALESCE fallback |
| Country | `country`, `personCountry`, `companyCountry` | COALESCE fallback |

---

## ✅ Verified Filter Counts (v3.3 Baseline)

Use these as regression tests. If counts change unexpectedly, something is broken.

### Data Summary
```
Total Records:            724
Person Records:           400
Company Records:          324
```

### Company Filters
```
Company Size 1-10:        15
Company Size 11-50:       96
Company Size 51-200:      81
Company Size 201-500:     78
Company Size 5001-10000:  86
Company Size 10000+:      8
Revenue Under $1M:        3
Revenue $1M-$10M:         42
Revenue $10M-$50M:        56
```

### Person Demographics
```
Income Under $50K:        55
Income $50K - $100K:      45
Net Worth Under $100K:    56
Gender Male (M):          137
Gender Female (F):        55
```

### Professional
```
C-Suite Department:       138
Individual Contributor:   99
```

### Prospect Data
```
Personal Facebook:        13
Personal Twitter:         7
Company Facebook:         147
Company Twitter:          141
Company LinkedIn:         203
```

---

## 🎨 Gender Field Format (v3.3)

**Database Storage**: `M` or `F`  
**Frontend Conversion**: `src/hooks/useFreeDataSearch.ts` lines 51-57

```typescript
const convertGender = (gender: string): string => {
  if (gender.toLowerCase() === 'male') return 'M';
  if (gender.toLowerCase() === 'female') return 'F';
  return gender;
};
```

The UI displays "Male" / "Female" but the database query uses "M" / "F".

---

## 🎨 Frontend Normalization (v3.1.1)

Industry suggestions are normalized in the frontend to handle case variations:

**File**: `src/hooks/useFreeDataSuggestions.ts`

**Behavior**:
- Converts to Title Case: "retail" → "Retail"
- Deduplicates: "Retail" and "retail" become single "Retail"
- Uses Set for deduplication after normalization

---

## 🛡️ Function Signature Contract

The `search_free_data_builder` function **MUST** have exactly this signature:

```sql
FUNCTION public.search_free_data_builder(
  p_entity_type entity_type DEFAULT 'person',
  p_keywords text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_size_ranges text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_technologies text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(entity_external_id text, entity_data jsonb, total_count bigint)
```

**Parameter Count**: 29  
**Return Type**: TABLE with 3 columns

---

## 🔧 Builder Search Parameters (29 total)

| # | Parameter | UI Filter | Type | Example Value |
|---|-----------|-----------|------|---------------|
| 1 | `p_entity_type` | Entity toggle | enum | `'person'`, `'company'` |
| 2 | `p_keywords` | Search box | text[] | `ARRAY['CEO', 'tech']` |
| 3 | `p_industries` | Industry dropdown | text[] | `ARRAY['Technology']` |
| 4 | `p_cities` | City filter | text[] | `ARRAY['San Francisco']` |
| 5 | `p_countries` | Country filter | text[] | `ARRAY['United States']` |
| 6 | `p_job_titles` | Job Title filter | text[] | `ARRAY['CEO', 'Manager']` |
| 7 | `p_seniority_levels` | Seniority dropdown | text[] | `ARRAY['C-Level', 'VP']` |
| 8 | `p_departments` | Department dropdown | text[] | `ARRAY['C-Suite / Leadership']` |
| 9 | `p_company_size_ranges` | Company Size | text[] | `ARRAY['1-10', '11-50']` |
| 10 | `p_company_revenue` | Revenue filter | text[] | `ARRAY['$1M - $10M']` |
| 11 | `p_technologies` | Tech stack | text[] | `ARRAY['React', 'AWS']` |
| 12 | `p_gender` | Gender filter | text[] | `ARRAY['M']`, `ARRAY['F']` |
| 13 | `p_income` | Income filter | text[] | `ARRAY['Under $50K']` |
| 14 | `p_net_worth` | Net Worth filter | text[] | `ARRAY['Under $100K']` |
| 15 | `p_person_skills` | Skills filter | text[] | `ARRAY['Python']` |
| 16 | `p_person_interests` | Interests filter | text[] | `ARRAY['Golf']` |
| 17 | `p_has_email` | Has Email toggle | boolean | `true` |
| 18 | `p_has_phone` | Has Phone toggle | boolean | `true` |
| 19 | `p_has_linkedin` | Has LinkedIn toggle | boolean | `true` |
| 20 | `p_has_facebook` | Has Facebook toggle | boolean | `true` |
| 21 | `p_has_twitter` | Has Twitter toggle | boolean | `true` |
| 22 | `p_has_personal_email` | Has Personal Email | boolean | `true` |
| 23 | `p_has_business_email` | Has Business Email | boolean | `true` |
| 24 | `p_has_company_phone` | Has Company Phone | boolean | `true` |
| 25 | `p_has_company_linkedin` | Has Company LinkedIn | boolean | `true` |
| 26 | `p_has_company_facebook` | Has Company Facebook | boolean | `true` |
| 27 | `p_has_company_twitter` | Has Company Twitter | boolean | `true` |
| 28 | `p_limit` | Pagination | integer | `50` |
| 29 | `p_offset` | Pagination | integer | `0` |

---

## 🔄 Revert Procedure

### Quick Revert (Say This)
> **"Revert to v3.3 stable state"**

### What Gets Restored
- `search_free_data_builder` function (29 parameters)
- `parse_revenue_to_numeric` helper function
- Frontend gender conversion
- Frontend industry normalization
- All filter logic exactly as documented

### Manual Revert (If Needed)
1. Find the stable migration file
2. Copy both `CREATE FUNCTION` blocks
3. Create new migration with `CREATE OR REPLACE FUNCTION`
4. Verify frontend conversion in `src/hooks/useFreeDataSearch.ts`

---

## 📊 Pre-Change Checklist

Before modifying any filter logic, verify:

- [ ] User explicitly requested the change
- [ ] Current counts match documented baseline
- [ ] No duplicate functions exist
- [ ] Migration uses `CREATE OR REPLACE`
- [ ] Signature stays identical (29 parameters)
- [ ] Post-change counts verified
- [ ] Run `docs/BUILDER_SEARCH_TEST.sql` after changes
