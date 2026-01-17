# Filter Contract Documentation

**Purpose**: Authoritative reference for filter field names, expected counts, and revert procedures.  
**Last Updated**: January 17, 2026

---

## 🚨 CRITICAL: Never Change These Field Names

The `search_free_data_builder` function uses these exact field names. Changing them will break filters.

---

## 📋 Authoritative Field Mapping

### Demographics Filters

| UI Filter | DB Field | Type | Sample Value | Notes |
|-----------|----------|------|--------------|-------|
| Income | `incomeRange` | string | `$45` | Numeric portion used for comparison |
| Net Worth | `netWorth` | string | `$85` | Supports negative values |
| Gender | `gender` | string | `male`, `female` | Case-insensitive match |

### Professional Filters

| UI Filter | DB Field | Type | Sample Value | Notes |
|-----------|----------|------|--------------|-------|
| Job Title | `title` | string | `CEO`, `Manager` | ILIKE match |
| Seniority | `seniority`, `title` | string | `C-Level` | Regex patterns |
| Department | `department` | string | `Executive` | Regex patterns |
| Company Size | `companySize` | string | `1-10`, `51-200` | Parsed by `parse_employee_count_upper()` |
| Industry | `industry` | string | `Technology` | Exact match (lowercase) |

### Prospect Data Filters

| UI Filter | DB Field(s) | Notes |
|-----------|------------|-------|
| Has Email | `email`, `businessEmail`, `personalEmail` | Any non-null matches |
| Has Phone | `phone`, `mobilePhone` | Any non-null matches |
| Has LinkedIn | `linkedin`, `linkedinUrl` | Both checked |
| Has Facebook | `facebook`, `facebookUrl` | **v2.7 fix: Added facebookUrl** |
| Has Twitter | `twitter`, `twitterUrl` | **v2.7 fix: Added twitterUrl** |
| Has Personal Email | `personalEmail` | Single field check |
| Has Business Email | `businessEmail` | Single field check |
| Has Company Phone | `companyPhone` | Single field check |
| Has Company LinkedIn | `companyLinkedin` | Single field check |
| Has Company Facebook | `companyFacebook`, `companyFacebookUrl` | **v2.7 fix: Added Url variant** |
| Has Company Twitter | `companyTwitter`, `companyTwitterUrl` | **v2.7 fix: Added Url variant** |

### Location Filters

| UI Filter | DB Field(s) | Notes |
|-----------|------------|-------|
| City | `city`, `personCity`, `companyCity` | COALESCE fallback |
| Country | `country`, `personCountry`, `companyCountry` | COALESCE fallback |

---

## ✅ Verified Filter Counts (v2.7 Baseline)

Use these as regression tests. If counts change unexpectedly, something is broken.

```
Income Under $50K:        21
Income $50K-$100K:        45
Net Worth Under $100K:    56
C-Suite Department:       138
Company Size 1-10:        26
Company Size 11-50:       191
Personal Facebook:        13
Personal Twitter:         7
Company Facebook:         147
Company Twitter:          141
```

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

## 🔄 Revert Procedure

### Quick Revert (Say This)
> **"Revert back to stable state"**

### What Gets Restored
- `search_free_data_builder` function from v2.6 baseline
- All filter logic exactly as documented

### Manual Revert (If Needed)
1. Find: `supabase/migrations/20260117035653_656c0ab5-a9dc-4159-a5bf-875212e91b06.sql`
2. Copy the `CREATE FUNCTION public.search_free_data_builder` block
3. Create new migration with `CREATE OR REPLACE FUNCTION`

---

## 📊 Pre-Change Checklist

Before modifying any filter logic, verify:

- [ ] Current counts match documented baseline
- [ ] No duplicate functions exist
- [ ] Migration uses `CREATE OR REPLACE`
- [ ] Signature stays identical (29 parameters)
- [ ] Post-change counts verified
