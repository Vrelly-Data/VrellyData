# Filter Data Mapping Documentation

> **PURPOSE:** Documents the expected data formats for each filter field in `free_data.entity_data`  
> **LAST UPDATED:** January 16, 2026 (v2.2)

---

## Field Naming Convention

The `entity_data` JSONB column uses **camelCase** field names:

| UI Label | Database Field | Type |
|----------|----------------|------|
| Email | `email`, `businessEmail` | string |
| LinkedIn | `linkedin`, `linkedinUrl` | string |
| Phone | `phone`, `mobilePhone` | string |
| Job Title | `title` | string |
| Seniority | `seniority` | string |
| Department | `department` | string |
| Company | `company` | string |
| Industry | `industry` | string |
| Company Size | `employeeCount`, `employees` | string/number |
| Revenue | `revenue`, `annualRevenue` | string |
| City | `city`, `personCity` | string |
| Country | `country`, `personCountry` | string |
| Gender | `gender` | string |
| Income | `incomeRange` | string |
| Net Worth | `netWorth` | string |
| Skills | `skills` | string (comma-separated) |
| Interests | `interests` | string (comma-separated) |
| Technologies | `technologies` | string (comma-separated) |

---

## Seniority Values

**Database Field:** `entity_data->>'seniority'`

| UI Option | Database Values (case-insensitive) |
|-----------|-----------------------------------|
| C-Level | `C suite`, `Cxo`, `C-Level`, `Chief`, `Founder` |
| VP | `Vp`, `VP`, `Vice President` |
| Director | `Director` |
| Manager | `Manager` |
| Senior | `Senior` |
| Entry | `Entry`, `Junior`, `Associate` |

**Sample Data:**
```
C suite     → 122 records
Cxo         → 16 records  
Vp          → 33 records
Director    → 125 records
Manager     → 69 records
Senior      → 7 records
```

**Matching Logic:**
- C-Level matches: `c-level`, `c-suite`, `csuite`, `c level`, `c suite`, `cxo`, `chief`, `founder`
- Also checks `title` field for `^(ceo|cfo|cto|coo|cmo|cio|cpo|chief)`

---

## Department Values

**Database Field:** `entity_data->>'department'`

| UI Option | Database Values (case-insensitive) |
|-----------|-----------------------------------|
| C-Suite / Leadership | `C-Suite`, `Executive`, `Leadership`, `Founder` |
| Engineering | `Engineering`, `Engineering & Technical`, `Technical` |
| Sales | `Sales` |
| Marketing | `Marketing` |
| Finance | `Finance`, `Accounting` |
| HR | `Human Resources`, `HR`, `People` |
| Operations | `Operations` |
| Legal | `Legal` |
| IT | `IT`, `Information Technology` |

**Sample Data:**
```
C-Suite             → 126 records
Sales               → 54 records
Engineering         → 42 records
Marketing           → 36 records
Finance             → 28 records
Operations          → 22 records
Human Resources     → 18 records
```

---

## Income Values

**Database Field:** `entity_data->>'incomeRange'`

**Format:** `$XX` where XX represents thousands (e.g., `$100` = $100,000)

| UI Option | Database Value Pattern |
|-----------|----------------------|
| Under $50K | `$20`, `$30`, `$40` |
| $50K - $100K | `$50`, `$60`, `$70`, `$80`, `$90`, `$100` |
| $100K - $250K | `$100`, `$125`, `$150`, `$175`, `$200`, `$225`, `$250` |
| $250K+ | `$250`, `$300`, `$350`, `$400`, `$500+` |

**Sample Data (84 records):**
```
$100   → 22 records ($100K)
$75    → 18 records ($75K)
$150   → 15 records ($150K)
$200   → 12 records ($200K)
$50    → 10 records ($50K)
$250   → 7 records ($250K)
```

**Parsing Logic:**
```sql
-- Extract numeric value: REGEXP_REPLACE(incomeRange, '[^0-9]', '', 'g')::int
-- $100 → 100 (represents $100K)
```

---

## Net Worth Values

**Database Field:** `entity_data->>'netWorth'`

**Format:** `$XXX` where XXX represents thousands (e.g., `$750` = $750,000)

| UI Option | Database Value Pattern |
|-----------|----------------------|
| Under $100K | `$1` - `$99` |
| $100K - $500K | `$100` - `$500` |
| $500K - $1M | `$500` - `$1000` |
| $1M - $5M | `$1000` - `$5000` (or `$1M` - `$5M`) |
| $5M+ | `$5000+`, `$10M+` |

**Sample Data (87 records):**
```
$750   → 24 records ($750K)
$500   → 19 records ($500K)
$1000  → 15 records ($1M)
$250   → 12 records ($250K)
$2000  → 10 records ($2M)
$5000  → 7 records ($5M)
```

**Parsing Logic:**
```sql
-- Extract numeric value: REGEXP_REPLACE(netWorth, '[^0-9]', '', 'g')::int
-- $750 → 750 (represents $750K)
```

---

## Gender Values

**Database Field:** `entity_data->>'gender'`

| UI Option | Database Values |
|-----------|----------------|
| Male | `male`, `Male`, `M` |
| Female | `female`, `Female`, `F` |
| Other | `other`, `Other`, `non-binary` |

**Current Status:** 0 records with gender data (awaiting data)

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
"Marketing, SEO, Content Strategy, Analytics"
```

**Sample Interests:**
```
"Technology, Startups, AI, Blockchain"
"Finance, Investing, Real Estate"
```

---

## Company Size Values

**Database Fields:** `entity_data->>'employeeCount'` or `entity_data->>'employees'`

| UI Option | Database Value Patterns |
|-----------|------------------------|
| 1-10 | `1-10`, `5`, `10` |
| 11-50 | `11-50`, `25`, `50` |
| 51-200 | `51-200`, `100`, `200` |
| 201-500 | `201-500`, `300`, `500` |
| 501-1000 | `501-1000`, `750`, `1000` |
| 1001-5000 | `1001-5000`, `2000`, `5000` |
| 5001+ | `5001-10000`, `10001+`, `10000+` |

---

## Revenue Values

**Database Fields:** `entity_data->>'revenue'` or `entity_data->>'annualRevenue'`

| UI Option | Database Value Patterns |
|-----------|------------------------|
| Under $1M | `$0-1M`, `$500K`, `< $1M` |
| $1M - $10M | `$1M-10M`, `$5M`, `$1-10M` |
| $10M - $50M | `$10M-50M`, `$25M`, `$10-50M` |
| $50M - $100M | `$50M-100M`, `$75M` |
| $100M - $500M | `$100M-500M`, `$250M` |
| $500M+ | `$500M+`, `$1B+`, `> $500M` |

---

## Quick Reference: Field Name Lookup

```javascript
// Frontend to Database field mapping
const fieldMap = {
  email: ['email', 'businessEmail'],
  linkedin: ['linkedin', 'linkedinUrl'],
  phone: ['phone', 'mobilePhone'],
  title: ['title'],
  seniority: ['seniority'],
  department: ['department'],
  company: ['company', 'companyName'],
  industry: ['industry'],
  employeeCount: ['employeeCount', 'employees'],
  revenue: ['revenue', 'annualRevenue'],
  city: ['city', 'personCity'],
  country: ['country', 'personCountry'],
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

1. Check field name (camelCase vs snake_case)
2. Check value format (case sensitivity)
3. Run `docs/QUICK_CHECK.sql` to verify data availability
4. Check `docs/HEALTH_CHECK.sql` for function status

### Filter returns wrong count

1. Verify regex patterns match actual data values
2. Check for alternative field names
3. Compare with sample data in this document

---

**Next Update:** When new data fields are added or formats change
