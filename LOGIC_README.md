# App Logic Documentation

> **LAST UPDATED:** January 16, 2026  
> **STATUS:** LOCKED IN - Do not modify core logic without reviewing this document  
> **HEALTH CHECK:** Run `docs/HEALTH_CHECK.sql` before any database changes

---

## Table of Contents
1. [Admin Upload Flow](#1-admin-upload-flow)
2. [Subscription & Credits System](#2-subscription--credits-system)
3. [User Unlock Flow (Core Value Logic)](#3-user-unlock-flow-core-value-logic)
4. [Search Function Logic](#4-search-function-logic)
5. [Working Filters](#5-working-filters)
6. [DO NOT CHANGE List](#6-do-not-change-list)
7. [Performance Indexes](#7-performance-indexes)
8. [Expected Data Field Names](#8-expected-data-field-names)
9. [Guardrails and Change Protocol](#9-guardrails-and-change-protocol)
10. [Verification Commands](#10-verification-commands)

---

## 1. Admin Upload Flow

### Files Involved
| File | Purpose |
|------|---------|
| `src/components/records/CSVImportDialog.tsx` | UI for CSV uploads |
| `src/lib/csvImportMapper.ts` | Field mapping and transformation |
| `src/lib/entityIdGenerator.ts` | Entity ID generation (deduplication) |
| `src/hooks/useFreeData.ts` | Database upload logic |
| `src/config/csvImportFields.ts` | Field definitions and aliases |

### Process Flow

```
CSV File → PapaParse → autoMapFields() → transformImportData() → generateEntityId() → Upsert to free_data
```

1. **Admin uploads CSV file** via `CSVImportDialog`
2. **PapaParse** parses CSV into headers + data arrays
3. **`autoMapFields()`** matches CSV headers to system fields:
   - Exact match (case-insensitive)
   - Alias matching (e.g., "Email Address" → "email")
   - Fuzzy matching (Levenshtein distance > 0.8 similarity)
4. **`transformImportData()`** converts CSV rows to `PersonEntity` or `CompanyEntity` objects
5. **Entity ID Generation** creates deterministic IDs for deduplication

### Entity ID Generation Priority

#### Person ID (`generatePersonId`)
| Priority | Source | Format | Example |
|----------|--------|--------|---------|
| 1 | LinkedIn URL | `li-{normalized-path}` | `li-in-john-doe` |
| 2 | Name + Company | `p-{hash}` | `p-a1b2c3d4` |
| 3 | Name + Email Domain | `p-{hash}` | `p-e5f6g7h8` |
| 4 | Business Email | `e-{email}` | `e-john@company.com` |
| 5 | Personal Email | `e-{email}` | `e-john@gmail.com` |
| 6 | Fallback | `p-{uuid}` | `p-123e4567-e89b-...` |

#### Company ID (`generateCompanyId`)
| Priority | Source | Format | Example |
|----------|--------|--------|---------|
| 1 | Domain | `d-{clean-domain}` | `d-acme.com` |
| 2 | LinkedIn URL | `li-{normalized-path}` | `li-company-acme` |
| 3 | Company Name | `c-{normalized-name}` | `c-acme-inc` |
| 4 | Fallback | `c-{uuid}` | `c-123e4567-e89b-...` |

### Database Upsert
```javascript
// Upsert to free_data with conflict resolution
supabase.from('free_data')
  .upsert(records, { 
    onConflict: 'entity_type,entity_external_id' 
  })
```

**Key Behavior:** If a record with the same `entity_type` AND `entity_external_id` exists, it gets UPDATED (not duplicated).

---

## 2. Subscription & Credits System

### Files Involved
| File | Purpose |
|------|---------|
| `src/config/subscriptionTiers.ts` | Tier definitions |
| `src/hooks/useSubscription.ts` | Subscription management |
| `src/hooks/useCreditCheck.ts` | Credit checking and deduction |

### Subscription Tiers

| Tier | Credits | Monthly Price | Stripe Price ID |
|------|---------|---------------|-----------------|
| Free | 100 | $0 | - |
| Starter | 10,000 | $99 | `price_starter` |
| Pro | 100,000 | $275 | `price_pro` |
| Enterprise | 1,000,000 | $600 | `price_enterprise` |

### Credit Deduction Flow

```javascript
// 1. Check if user has enough credits
const hasEnough = await hasEnoughCredits(amount);

// 2. Deduct credits (updates profiles.credits, logs to credit_transactions)
const result = await deductCredits(amount, audienceId?);
```

**Database Tables:**
- `profiles.credits` - Current credit balance
- `credit_transactions` - Transaction log (audit trail)

---

## 3. User Unlock Flow (Core Value Logic)

### Files Involved
| File | Purpose |
|------|---------|
| `src/hooks/useDeduplication.ts` | Record categorization & credit calculation |
| `src/hooks/useUnlockedRecords.ts` | Track what user already owns |
| `src/lib/dataHash.ts` | Data change detection (djb2 algorithm) |
| `src/components/search/UnlockConfirmDialog.tsx` | Credit confirmation UI |
| `src/pages/AudienceBuilder.tsx` | Main orchestration |

### The Core Value Proposition

> **Users should NEVER pay twice for the same data.**  
> **Users SHOULD pay for NEW data or UPDATED data.**

### Flow Diagram

```
User selects records → analyzeRecords() → Categorize → Show UnlockConfirmDialog → Deduct Credits → Save to unlocked_records
```

### Record Categorization (`analyzeRecords`)

| Category | Condition | Credit Cost |
|----------|-----------|-------------|
| **Already Owned** | Record in `unlocked_records` AND `data_hash` matches | **0 credits** |
| **Can Update** | Record in `unlocked_records` BUT `data_hash` differs | **1 credit** |
| **New Record** | Record NOT in `unlocked_records` | **1 credit** |

### Data Hash Algorithm (djb2)

**Purpose:** Detect if data has changed since user last unlocked it.

**Person Fields Hashed:**
```javascript
['email', 'phone', 'title', 'linkedin', 'company', 'businessEmail', 'directNumber']
```

**Company Fields Hashed:**
```javascript
['domain', 'linkedin', 'phone', 'industry', 'employeeCount']
```

**Algorithm:**
```javascript
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}
```

### Multi-Match Lookup (`isUnlocked`)

The system checks multiple identifiers to determine if a record is already owned:

| Priority | Check | Notes |
|----------|-------|-------|
| 1 | `entity_external_id` | Primary identifier |
| 2 | Email | Only if not masked (no `•` character) |
| 3 | LinkedIn username | Normalized from URL |
| 4 | Domain | For companies only |
| 5 | Name + Company | Composite match |

---

## 4. Search Function Logic

### Database Function
```sql
public.search_free_data_builder(
  p_entity_type, p_keywords, p_job_titles, p_seniority_levels, p_departments,
  p_industries, p_company_size_ranges, p_company_revenue, p_cities, p_states,
  p_countries, p_gender, p_net_worth, p_income, p_person_interests, p_person_skills,
  p_has_linkedin, p_has_personal_email, p_has_business_email, p_has_phone,
  p_has_company_linkedin, p_has_company_phone, p_has_company_twitter, p_has_company_facebook,
  p_has_twitter, p_has_facebook, p_limit, p_offset
)
```

### Filter Logic Details

#### Keywords Filter
Searches across **20+ fields** using ILIKE:
```sql
firstName, lastName, name, email, businessEmail, personalEmail,
title, jobTitle, company, industry, domain, website,
city, state, country, companyCity, companyState, companyCountry,
skills, interests, technologies, keywords
```

#### Job Titles Filter
```sql
WHERE entity_data->>'title' ILIKE '%' || job_title || '%'
   OR entity_data->>'jobTitle' ILIKE '%' || job_title || '%'
```

#### Seniority Filter (with normalization)
| UI Input | DB Values Matched | Records |
|----------|-------------------|---------|
| `C-Level` | `C suite`, `Cxo` | 138 |
| `VP`, `Vice President` | `Vp` | 33 |
| `Director` | `Director` | 125 |
| `Manager` | (title contains "manager") | varies |
| `Founder` | `Founder` | 4 |
| `Head of` | (title contains "head of") | varies |
| `President` | (seniority contains "president") | varies |
| `Individual Contributor` | (excludes C suite, Cxo, Vp, Director, Founder) | varies |

#### Department Filter (with normalization)
| Input | Matches |
|-------|---------|
| `C-Suite` | `c-suite`, `executive`, `leadership` |
| `Engineering` | `engineering`, `development`, `technical` |
| Others | Case-insensitive exact match |

#### Company Size Filter (range parsing)
```javascript
// Input: "51-200"
// Parsed to: min=51, max=200

// Logic checks:
entity_data->>'employeeCount' >= min AND entity_data->>'employeeCount' <= max
// OR parses entity_data->>'companySize' as a range
```

#### Company Revenue Filter (range parsing)
```javascript
// Input: "$10M-$50M"
// Parsed to: min=10000000, max=50000000

// Logic checks:
entity_data->>'revenue' >= min AND entity_data->>'revenue' <= max
```

#### Prospect Data Filters
| Filter | Field Checked |
|--------|---------------|
| `HAS_LINKEDIN` | `linkedin`, `linkedinUrl` IS NOT NULL |
| `HAS_PERSONAL_EMAIL` | `personalEmail`, `email` IS NOT NULL |
| `HAS_BUSINESS_EMAIL` | `businessEmail` IS NOT NULL |
| `HAS_PHONE` | `phone`, `directNumber` IS NOT NULL |
| `HAS_COMPANY_LINKEDIN` | `companyLinkedin` IS NOT NULL |
| `HAS_COMPANY_PHONE` | `companyPhone` IS NOT NULL |

---

## 5. Working Filters

### Verified Working ✅

| Filter | Status | Last Verified | Notes |
|--------|--------|---------------|-------|
| Keywords | ✅ Working | Jan 2026 | Searches 20+ fields |
| Job Titles | ✅ Working | Jan 2026 | ILIKE matching |
| Seniority | ✅ Working | Jan 2026 | With normalization |
| Department | ✅ Working | Jan 2026 | C-Suite label fixed |
| Company Size | ✅ Working | Jan 2026 | Range parsing |
| Company Revenue | ✅ Working | Jan 2026 | Range parsing |
| Person City | ✅ Working | Jan 2026 | ILIKE |
| Person Country | ✅ Working | Jan 2026 | ILIKE |
| Company City | ✅ Working | Jan 2026 | ILIKE |
| Company Country | ✅ Working | Jan 2026 | ILIKE |
| Has LinkedIn | ✅ Working | Jan 2026 | Field existence |
| Has Email | ✅ Working | Jan 2026 | Field existence |
| Has Phone | ✅ Working | Jan 2026 | Field existence |
| Industries | ✅ Working | Jan 2026 | ILIKE matching |

### Now Working ✅ (Previously Awaiting Data)

| Filter | Status | Records with Data | Notes |
|--------|--------|-------------------|-------|
| Person Interest | ✅ Working | 6 records | `interests` field |
| Person Skill | ✅ Working | 25 records | `skills` field |
| Net Worth | ✅ Working | Has data | `netWorth` field |
| Income | ✅ Working | 84 records | `incomeRange` field |

### Awaiting Data ⏳

| Filter | Status | Expected Field | Format |
|--------|--------|----------------|--------|
| Gender | ⏳ Logic Ready | `gender` | `"male"`, `"female"`, `"other"` |

---

## 6. DO NOT CHANGE List

### 🚨 CRITICAL - Database

| Item | Reason |
|------|--------|
| `public.search_free_data_builder` | Core search logic - DO NOT create duplicate functions |
| `free_data` table structure | Entity storage - changes break uploads |
| `unlocked_records` table structure | User ownership tracking |
| All 22 performance indexes | Query performance depends on these |

### 🚨 CRITICAL - Frontend

| File | Reason |
|------|--------|
| `src/hooks/useFreeDataSearch.ts` | Search hook - maps to DB function |
| `src/hooks/useDeduplication.ts` | Credit calculation logic |
| `src/lib/dataHash.ts` | Hash algorithm consistency |
| `src/lib/entityIdGenerator.ts` | ID generation for deduplication |
| `src/lib/csvImportMapper.ts` | Field mapping and transformation |
| `src/lib/freeDataFilter.ts` | Filter conversion to API params |

### ⚠️ DO NOT

1. **Create new search functions** - Use `search_free_data_builder`
2. **Change the data hash algorithm** - Breaks "already owned" detection
3. **Change entity ID generation priority** - Breaks deduplication
4. **Change field normalization logic** - Breaks filter matching
5. **Add new filters without updating the DB function** - They won't work

---

## 7. Performance Indexes

### free_data Table (Primary)

| Index Name | Type | Column(s) |
|------------|------|-----------|
| `idx_free_data_entity_data_gin` | GIN | `entity_data` (jsonb_path_ops) |
| `idx_free_data_entity_type` | B-tree | `entity_type` |
| `idx_free_data_entity_external_id` | B-tree | `entity_external_id` |
| `idx_free_data_type_external_id` | B-tree | `(entity_type, entity_external_id)` |
| `idx_free_data_industry` | GIN | `entity_data->'industry'` |
| `idx_free_data_title` | GIN | `entity_data->'title'` |
| `idx_free_data_company` | GIN | `entity_data->'company'` |
| `idx_free_data_city` | GIN | `entity_data->'city'` |
| `idx_free_data_country` | GIN | `entity_data->'country'` |
| `idx_free_data_employee_count` | GIN | `entity_data->'employeeCount'` |
| `idx_free_data_revenue` | GIN | `entity_data->'revenue'` |
| `idx_free_data_seniority` | GIN | `entity_data->'seniority'` |
| `idx_free_data_department` | GIN | `entity_data->'department'` |
| `idx_free_data_linkedin` | B-tree | `entity_data->>'linkedin'` |
| `idx_free_data_email` | B-tree | `entity_data->>'email'` |
| `idx_free_data_business_email` | B-tree | `entity_data->>'businessEmail'` |

### unlocked_records Table

| Index Name | Type | Column(s) |
|------------|------|-----------|
| `idx_unlocked_records_team_id` | B-tree | `team_id` |
| `idx_unlocked_records_entity_type` | B-tree | `entity_type` |
| `idx_unlocked_records_entity_external_id` | B-tree | `entity_external_id` |
| `idx_unlocked_records_composite` | UNIQUE | `(team_id, entity_external_id, entity_type)` |

### people_records & company_records Tables

| Index Name | Type | Column(s) |
|------------|------|-----------|
| `idx_people_records_team_id` | B-tree | `team_id` |
| `idx_company_records_team_id` | B-tree | `team_id` |

---

## 8. Expected Data Field Names

### Person Entity Fields

#### Core Identity
```
firstName, lastName, name, fullName
```

#### Contact Information
```
email, personalEmail, businessEmail
phone, directNumber, mobilePhone
```

#### Professional
```
title, jobTitle, seniority, department
company, companyName
linkedin, linkedinUrl
```

#### Company Details (on person record)
```
companyLinkedin, companyPhone, companyEmail
companySize, employeeCount
companyRevenue, revenue
domain, website
```

#### Location
```
city, state, country
companyCity, companyState, companyCountry
address, zipCode
```

#### Demographics (awaiting data)
```
gender
netWorth
incomeRange
age
children
homeowner
married
```

#### Interests & Skills (awaiting data)
```
interests
skills
technologies
keywords
```

#### Social
```
twitterUrl, facebookUrl
```

### Company Entity Fields

#### Core Identity
```
name, companyName
domain, website
```

#### Contact
```
phone, email
linkedin
```

#### Details
```
industry
employeeCount, companySize
revenue, annualRevenue
fundingStage
description
```

#### Location
```
city, state, country
location, address, zipCode
```

#### Codes
```
sic, naics
```

#### Social
```
facebookUrl, twitterUrl
```

---

## Appendix: Quick Reference

### Credit Cost Summary
| Action | Cost |
|--------|------|
| View/Search records | FREE |
| Export already-owned (unchanged) | 0 credits |
| Export already-owned (data changed) | 1 credit per record |
| Export new record | 1 credit per record |

### Common Issues

| Issue | Solution |
|-------|----------|
| Filter not returning results | Check if data has the expected field names |
| Duplicate records after upload | Check entity ID generation - ensure unique identifiers |
| Credits deducted for owned records | Check data_hash - data may have changed |
| Search slow | Check if indexes exist on filtered fields |

---

## 9. Guardrails and Change Protocol

### ✅ MANDATORY PRE-CHANGE CHECKLIST

Before **ANY** database function modification, complete this checklist:

```
[ ] 1. Run health check: Ask AI "run the health check"
[ ] 2. Confirm 0 duplicates in results
[ ] 3. Document current function signature (copy from health check output)
[ ] 4. Verify change is SAFE (internal logic only, no parameter changes)
[ ] 5. Update LOGIC_README.md with change description BEFORE making changes
[ ] 6. Run health check AFTER changes to verify no duplicates created
```

**⚠️ NEVER skip this checklist. Duplicate functions are extremely difficult to debug.**

---

### 🔒 LOCKED FUNCTION SIGNATURE: search_free_data_builder

**This EXACT order and type MUST be preserved. Any deviation creates a duplicate function.**

| # | Parameter | Type | Default |
|---|-----------|------|---------|
| 1 | `p_entity_type` | text | 'person' |
| 2 | `p_keywords` | text[] | NULL |
| 3 | `p_job_titles` | text[] | NULL |
| 4 | `p_seniority_levels` | text[] | NULL |
| 5 | `p_departments` | text[] | NULL |
| 6 | `p_industries` | text[] | NULL |
| 7 | `p_company_size_ranges` | text[] | NULL |
| 8 | `p_company_revenue` | text[] | NULL |
| 9 | `p_cities` | text[] | NULL |
| 10 | `p_countries` | text[] | NULL |
| 11 | `p_gender` | text[] | NULL |
| 12 | `p_net_worth` | text[] | NULL |
| 13 | `p_income` | text[] | NULL |
| 14 | `p_person_interests` | text[] | NULL |
| 15 | `p_person_skills` | text[] | NULL |
| 16 | `p_technologies` | text[] | NULL |
| 17 | `p_has_personal_email` | boolean | NULL |
| 18 | `p_has_business_email` | boolean | NULL |
| 19 | `p_has_phone` | boolean | NULL |
| 20 | `p_has_linkedin` | boolean | NULL |
| 21 | `p_has_facebook` | boolean | NULL |
| 22 | `p_has_twitter` | boolean | NULL |
| 23 | `p_has_company_phone` | boolean | NULL |
| 24 | `p_has_company_linkedin` | boolean | NULL |
| 25 | `p_has_company_facebook` | boolean | NULL |
| 26 | `p_has_company_twitter` | boolean | NULL |
| 27 | `p_limit` | integer | 50 |
| 28 | `p_offset` | integer | 0 |

**Total Parameters: 28**

---

### 🛑 BEFORE Making Any Database Function Changes

1. **Run the Health Check** - Execute `docs/HEALTH_CHECK.sql` to verify current state
2. **Check for duplicates** - Ensure no function overloads exist
3. **Verify parameter order matches EXACTLY** - PostgreSQL creates overloads if parameters differ

### ⚠️ Function Modification Rules

**When using `CREATE OR REPLACE FUNCTION`:**

```sql
-- ❌ WRONG: Changing parameter order creates a NEW overloaded function
CREATE OR REPLACE FUNCTION my_func(p_new_param TEXT, p_old_param TEXT) -- DIFFERENT ORDER!

-- ✅ CORRECT: Keep EXACT parameter order, types, and names
CREATE OR REPLACE FUNCTION my_func(p_old_param TEXT, p_new_param TEXT) -- SAME ORDER
```

**NEVER change in `search_free_data_builder`:**
| Element | Reason |
|---------|--------|
| Parameter order | Creates duplicate overload instead of replacing |
| Parameter types | Creates duplicate overload instead of replacing |
| Parameter names | May break existing calls |
| Function name | Creates new function, orphans old one |

**SAFE to change:**
| Element | Example |
|---------|---------|
| Internal logic | Adding OR conditions, fixing comparisons |
| Normalization mappings | Adding new seniority/department mappings |
| Field name checks | Adding fallback field names |

### 🔄 Safe Change Protocol

1. **Document the change** - Update LOGIC_README.md first
2. **Run health check** - Verify no duplicates before
3. **Make minimal change** - Change only what's needed
4. **Run health check** - Verify no duplicates after
5. **Test the specific filter** - Confirm it works

---

## 10. Verification Commands

### Quick Checks (Ask AI to run these)

| Command | Purpose |
|---------|---------|
| "Run the health check" | Execute `docs/HEALTH_CHECK.sql` |
| "Check for duplicate functions" | Run duplicate function query only |
| "Check filter data availability" | See which filters have data |
| "Verify search function exists" | Confirm single search function |

### Manual Verification Queries

**Check for function duplicates:**
```sql
SELECT proname, COUNT(*) 
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
GROUP BY proname
HAVING COUNT(*) > 1;
```

**Verify single search function:**
```sql
SELECT COUNT(*) as function_count
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'search_free_data_builder';
-- Expected: 1
```

**Check current function signature:**
```sql
SELECT pg_catalog.pg_get_function_arguments(p.oid) as current_signature
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'search_free_data_builder';
```

---

## 11. Data Playground Architecture

### Overview

The Data Playground syncs outbound sales data from Reply.io (and planned Smartlead/Instantly.ai support). It operates independently from the main Audience Builder.

### Database Tables

| Table | Purpose |
|-------|---------|
| outbound_integrations | API keys, sync status, webhook config |
| synced_campaigns | Campaign metadata and aggregate stats |
| synced_contacts | Individual contact engagement data |
| synced_sequences | Email step content (for Copy tab) |
| copy_templates | AI-generated email variants |

### Sync Flow

1. User clicks "Sync" on integration
2. Frontend calls `fetch-available-campaigns` with `autoLinkOnFirstSync: true`
   - Uses Reply V1 `/campaigns` to get peopleCount
   - Auto-links campaigns if `links_initialized: false`
3. Frontend calls `sync-reply-campaigns`
   - Uses Reply V3 `/sequences` for status consistency
   - Preserves existing `is_linked` values
4. Frontend triggers background `startContactsSync`
   - Iterates through linked campaigns only
   - Calls `sync-reply-contacts` per campaign

### Edge Functions

| Function | API Version | Purpose |
|----------|-------------|---------|
| fetch-available-campaigns | V1 | Campaign discovery + peopleCount |
| sync-reply-campaigns | V3 | Campaign status/name updates |
| sync-reply-contacts | V1 | Contact listing with engagement |
| setup-reply-webhook | V2 | Webhook registration |
| reply-webhook | N/A | Incoming webhook handler |

### Key Files

| File | Purpose |
|------|---------|
| src/hooks/useOutboundIntegrations.ts | Integration CRUD, sync orchestration |
| src/hooks/useSyncedCampaigns.ts | Campaign data fetching |
| src/hooks/usePlaygroundStats.ts | Dashboard aggregation |
| src/components/playground/CampaignsTable.tsx | Campaign list UI |
| src/components/playground/PeopleTab.tsx | Contact list with engagement |

### DO NOT CHANGE

| Item | Reason |
|------|--------|
| Auto-link logic in fetch-available-campaigns | Breaks first-sync visibility |
| Page signature guard in sync-reply-contacts | Prevents infinite API loops |
| links_initialized column | Required for one-time auto-link |
| Sync order (fetch → sync → contacts) | peopleCount must populate first |

---

**Document Version:** 2.2  
**Maintained By:** Development Team  
**Last Review:** February 8, 2026
