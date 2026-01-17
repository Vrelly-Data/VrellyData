# Filter Data Mapping Documentation

> **PURPOSE:** Documents the expected data formats for each filter field in `free_data.entity_data`  
> **LAST UPDATED:** January 16, 2026 (v2.3)

---

## Field Naming Convention

The `entity_data` JSONB column uses **camelCase** field names:

| UI Label | Database Field | Type |
|----------|----------------|------|
| Email | `email`, `businessEmail`, `personalEmail` | string |
| LinkedIn | `linkedin`, `linkedinUrl` | string |
| Phone | `phone`, `mobilePhone` | string |
| Job Title | `title` | string |
| Seniority | `seniority` | string |
| Department | `department` | string |
| Company | `company`, `companyName` | string |
| Industry | `industry` | string |
| Company Size | `companySize` | string (e.g., "11-50") |
| Revenue | `revenue`, `annualRevenue` | string |
| City | `city`, `personCity`, `companyCity` | string |
| Country | `country`, `personCountry`, `companyCountry` | string |
| Gender | `gender` | string |
| Income | `incomeRange` | string (e.g., "$100") |
| Net Worth | `netWorth` | string (e.g., "$750", "-$2") |
| Skills | `skills` | string (comma-separated) |
| Interests | `interests` | string (comma-separated) |
| Technologies | `technologies` | string (comma-separated) |

---

## Seniority Values

**Database Field:** `entity_data->>'seniority'`

| UI Option | Database Values (case-insensitive regex) |
|-----------|------------------------------------------|
| C-Level | `c-level`, `c-suite`, `csuite`, `cxo`, `chief`, `founder` |
| President | `president` (also matches title) |
| VP | `vp`, `vice president`, `v.p.` |
| Head of | `head` in seniority, `^head of` in title |
| Director | `director` |
| Manager | `manager` |
| Senior | `senior`, `^sr.` |
| Entry | `entry`, `junior`, `associate`, `intern` |

**Matching Logic:**
- Checks both `seniority` field and `title` field
- Title matching uses regex patterns for accuracy

---

## Department Values

**Database Field:** `entity_data->>'department'`

| UI Option | Database Values (case-insensitive regex) |
|-----------|------------------------------------------|
| C-Suite / Leadership | `c-suite`, `executive`, `leadership`, `founder`, `owner` |
| Engineering | `engineering`, `technical`, `development`, `software`, `it` |
| Sales | `sales` |
| Marketing | `marketing` |
| Finance | `finance`, `accounting` |
| HR | `human resources`, `hr`, `people`, `talent` |
| Operations | `operations` |
| Legal | `legal` |
| IT | `it`, `information technology` |
| Community and Social Services | `community`, `social services`, `nonprofit`, `ngo` |
| Customer Success | `customer success`, `customer service`, `support`, `client` |
| Product | `product`, `product management`, `pm` |

---

## Company Size Values

**Database Field:** `entity_data->>'companySize'`

**Format:** Range string like "11-50" or single number

| UI Option | Parsed Range |
|-----------|--------------|
| 1-10 | 1 to 10 employees |
| 11-50 | 11 to 50 employees |
| 51-200 | 51 to 200 employees |
| 201-500 | 201 to 500 employees |
| 501-1000 | 501 to 1000 employees |
| 1001-5000 | 1001 to 5000 employees |
| 5001+ | More than 5000 employees |

**Verified Counts (v2.3):**
| Range | Count |
|-------|-------|
| 1-10 | 13 |
| 11-50 | 96 |
| 51-200 | 81 |
| 201-500 | 78 |

**Parsing Function:** `parse_employee_count_upper(size_str)` extracts the upper bound

---

## Income Values

**Database Field:** `entity_data->>'incomeRange'`

**Format:** `$XX` where XX represents thousands (e.g., `$100` = $100,000)

| UI Option | Parsed Value Range |
|-----------|-------------------|
| Under $50K | value < 50 |
| $50K - $100K | 50 ≤ value ≤ 100 |
| $100K - $200K | 101 ≤ value ≤ 200 |
| $200K - $500K | 201 ≤ value ≤ 500 |
| $500K - $1M | 501 ≤ value ≤ 1000 |
| $1M+ | value > 1000 |

**Verified Counts (v2.3):**
| Range | Count |
|-------|-------|
| Under $50K | 21 |
| $50K-$100K | 45 |
| $100K-$200K | 15 |
| $200K+ | 3 |

**Total Records with Income Data:** 84

**IMPORTANT:** Filter only returns records that HAVE income data (not all 300 records).

---

## Net Worth Values

**Database Field:** `entity_data->>'netWorth'`

**Format:** `$XXX` where XXX is thousands. Can be negative (e.g., `-$2` = -$2,000 debt)

| UI Option | Parsed Value Range |
|-----------|-------------------|
| Under $100K | value < 100 (includes negatives) |
| $100K - $500K | 100 ≤ value ≤ 500 |
| $500K - $1M | 501 ≤ value ≤ 1000 |
| $1M - $5M | 1001 ≤ value ≤ 5000 |
| $5M - $10M | 5001 ≤ value ≤ 10000 |
| $10M - $50M | 10001 ≤ value ≤ 50000 |
| $50M+ | value > 50000 |

**Verified Counts (v2.3):**
| Range | Count |
|-------|-------|
| Under $100K | 56 |
| $100K-$500K | 21 |
| $500K-$1M | 10 |

**Total Records with Net Worth Data:** 87

**IMPORTANT:** Filter only returns records that HAVE net worth data. Negative values are properly handled.

---

## Gender Values

**Database Field:** `entity_data->>'gender'`

| UI Option | Database Values |
|-----------|----------------|
| Male | `male`, `Male`, `M` |
| Female | `female`, `Female`, `F` |
| Other | `other`, `Other`, `non-binary` |

---

## Skills & Interests

**Database Fields:** 
- `entity_data->>'skills'` (25 records)
- `entity_data->>'interests'` (6 records)

**Format:** Comma-separated string

**Sample Skills:**
```
"JavaScript, Python, React, Node.js"
"Sales, Negotiation, CRM, Lead Generation"
```

---

## Quick Reference: Field Name Lookup

```javascript
// Frontend to Database field mapping (v2.3)
const fieldMap = {
  email: ['email', 'businessEmail', 'personalEmail'],
  linkedin: ['linkedin', 'linkedinUrl'],
  phone: ['phone', 'mobilePhone'],
  title: ['title'],
  seniority: ['seniority', 'title'], // Also checks title
  department: ['department'],
  company: ['company', 'companyName'],
  industry: ['industry'],
  companySize: ['companySize'], // Changed from employeeCount in v2.3
  revenue: ['revenue', 'annualRevenue'],
  city: ['city', 'personCity', 'companyCity'],
  country: ['country', 'personCountry', 'companyCountry'],
  gender: ['gender'],
  income: ['incomeRange'],
  netWorth: ['netWorth'],
  skills: ['skills'],
  interests: ['interests'],
  technologies: ['technologies']
};
```

---

## Troubleshooting

### Filter returns 0 results when data exists

1. Check field name (use `companySize` not `employeeCount`)
2. Check value format (case sensitivity)
3. Run `docs/QUICK_CHECK.sql` to verify data availability

### Income/Net Worth returns too many results

Before v2.3, these filters could return all 300 records. Now they only return records that actually have income/netWorth data.

- Income: ~84 records total
- Net Worth: ~87 records total

### Seniority/Department returns wrong count

v2.3 added missing patterns:
- Seniority: `president`, `head of`
- Department: `customer success`, `product`, `community and social services`

---

**Version History:**
- v2.3: Fixed Company Size, Seniority, Department, Income, Net Worth
- v2.2: Initial documentation
