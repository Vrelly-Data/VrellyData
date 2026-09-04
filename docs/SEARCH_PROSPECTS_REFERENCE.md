# `search_prospects_*` Reference

**Status**: reference, not a lock document.
**Measured**: 2026-08-31, against prod (`lgnvolndyftsbcjprmic`) and dev (`iqxzetwuxykplzdjysiu`).
**Companion docs**: `SEARCH_FUNCTION_LOCK.md` (covers `search_free_data_*`), `FILTER_CONTRACT.md`, `FILTER_DATA_MAPPING.md`.

This file exists because `search_prospects_results` / `search_prospects_count` had **no documentation at all**, and are not created by any migration — they came from the pre-2026-05-28 database and are only ever *patched* by four string-surgery migrations that regex-rewrite the live function body:

- `20260324_fix_keyword_plainto_tsquery.sql`
- `20260325_fix_seniority_ilike.sql`
- `20260328_fix_revenue_filter.sql`
- `20260430_fix_interests_filter_typo.sql`
- `20260510_fix_country_state_email_validation.sql`

The last full definition available in-repo is in `prod_schema.sql` (pg_dump of prod, 2026-05-28), lines ~2168 (count) and ~2507 (results). That dump postdates every patch above, so it is currently the best source of truth. **If you need the live body, read it — do not infer it.**

---

## 1. `search_prospects_count` is an ESTIMATOR, not a count

The single most important fact about this function:

> **It never touches the `prospects` table.**

It answers entirely from the `filter_counts` facet table plus hardcoded selectivity multipliers. Concretely:

| Input | What the function does | Returns |
|---|---|---|
| No filters at all | `IF v_active_filters = 0 THEN RETURN QUERY SELECT 0::bigint, false` | **literal `0`** |
| `p_has_business_email: true` | hardcoded branch | **literal `100000`**, `is_estimate: false` |
| `p_has_personal_email` / `p_has_phone` / `p_has_linkedin` = true | same hardcoded branch | **literal `100000`**, `is_estimate: false` |
| `p_has_facebook`, `p_has_company_twitter`, `p_has_company_facebook` | *do* read `filter_counts` | real facet value |
| One simple filter (industry, city, job title…) | reads `filter_counts` | real facet value |
| Multiple filters | selectivity multiplication against `v_base_count` | derived estimate |

`v_base_count` is `SUM(record_count) FROM filter_counts WHERE field_name = 'seniority'`, falling back to a hardcoded `4200000` when that is empty.

### Why it was built this way — verified, not guessed

An exact `count(*)` on prod `prospects` **fails**:

```
HTTP 500  {"code":"57014","message":"canceling statement due to statement timeout"}
```

So does a plain `select id limit 1` through PostgREST. Counting that table through the ordinary path is not possible; the estimator is a deliberate workaround, not an oversight.

### Two genuine defects (scale-independent)

1. **Unfiltered returns `0`.** An empty search reports "0 matches" over a populated table. Check whether the builder UI guards against calling it with no filters.
2. **`is_estimate: false` is returned alongside the hardcoded `100000`.** It claims exactness it does not have. Any consumer trusting that flag is misled.

### Rule for new consumers

**Do not use `search_prospects_count` for pagination totals.** Do a bounded count server-side instead (the `search_free_data_count` pattern — `SELECT count(*) FROM (… LIMIT 100001) _sub`). Do not "fix" this function to suit a new caller: it is tuned for prod scale and backs the shipping audience builder.

---

## 2. `search_prospects_results` — the one to actually use

`SECURITY DEFINER`, `RETURNS SETOF public.prospects` (all 54 columns), `ORDER BY p.id LIMIT/OFFSET`.

Verified working on both dev and prod. Signature is identical to `search_prospects_count` plus `p_limit` (default 25) and `p_offset` (default 0) — 44 params vs 42.

### ⚠️ Access constraint — reach `prospects` only through this RPC

Direct PostgREST reads of `public.prospects` time out on prod **even at `limit=1`**, because RLS on that table is expensive to evaluate. `filter_counts` by contrast returns instantly. Because this function is `SECURITY DEFINER` it bypasses RLS and is fast.

**Any new code that needs prospect rows must call this RPC (or use the service role inside an edge function). Never `supabase.from('prospects').select(...)`.**

### Pagination cost

`OFFSET` degrades: `offset 15000` ≈ 3.0s, `offset 50000` ≈ 7.8s, `offset 100000` timed out. Deep paging needs keyset pagination on `id`, not `OFFSET`.

---

## 3. Prod data profile (measured 2026-08-31)

Sampled 1,000 rows via the RPC at five offsets across the first ~10k ids.

> **Sampling caveat**: the function orders by `id`, so this is the earliest-imported rows, not a random sample. Directionally reliable, not exact.

**Size**: at least **50,000 rows**. An exact figure is unavailable (count times out, `OFFSET` probing degrades past 50k). Note the estimator's `4200000` fallback constant is *not* evidence of the real size.

**Provenance**: ~98% `audience_lab`, ~2% `apollo` (first 400 rows).

| Field | Coverage | Usable? |
|---|---|---|
| `country` | 100% | ✅ |
| `company_name`, `company_domain` | 88.0% | ✅ |
| `company_size` | 86.4% | ✅ |
| `business_email` | **85.4%** | ✅ |
| `job_title` | 85.2% | ✅ |
| `company_industry` | 84.9% | ✅ |
| `seniority` | 83.5% | ✅ |
| `company_revenue` | 81.8% | ✅ |
| `city` | 81.3% | ✅ |
| `linkedin_url` | 79.4% | ✅ |
| `state` | 76.5% | ✅ |
| `department` | 61.0% | ⚠️ |
| `phone` | 54.7% | ⚠️ |
| `personal_email` | 51.6% | ⚠️ |
| `skills` | 25.2% | ⚠️ |
| `interests` | 6.7% | ❌ effectively empty |
| `keywords` | 2.3% | ❌ effectively empty |
| `technologies` | 2.1% | ❌ effectively empty |
| `company_size_range` | **0%** | ❌ dead column |
| `full_name` | 0% | ❌ dead column — use `first_name`/`last_name` |

**Consequence**: `technologies`, `keywords` and `interests` are offered as filters but are backed by under 7% of rows. Any UI surfacing them against this dataset should hide them or mark them unavailable, or users will read empty results as a broken product.

---

## 4. Vocabulary — dev and prod DISAGREE

This is a trap. **Dev's `prospects` table is 30 synthetic rows (`source = 'dev_synthetic'`, `@example.com` emails) whose vocabulary matches neither prod nor the UI.** Filter behaviour validated on dev can be meaningless.

### `seniority`

| Prod values (measured) | Dev synthetic values |
|---|---|
| `Cxo`, `Manager`, `Staff`, `Vp`, `Director`, `Head` | `C-Level`, `VP`, `Manager`, `Director`, `Individual Contributor` |

The results function filters with **exact** `lower(p.seniority) = ANY(...)`, so:

- `p_seniority_levels: ['C-Level']` → **0 rows on prod**
- `p_seniority_levels: ['Cxo']` → matches

**The product is fine**: `src/config/personFilterProperties.ts` sends `Cxo` / `Vp` / `Director` / `Manager` / `Staff`, which match prod exactly. Only dev's seed data is wrong.

### `company_size`

Real data is in `company_size` (86.4%), **not** `company_size_range` (0%). The results function maps UI ranges onto prod's strings, so this works correctly despite the dead column:

| UI value | Mapped to |
|---|---|
| `1-10` | `1 to 10` |
| `11-50` | `26 to 50` |
| `51-200` | `51 to 100`, `101 to 250` |
| `201-500` | `251 to 500` |
| `501-1000` | `501 to 1000` |
| `1001-5000` | `1001 to 5000` |
| `5001-10000` | `5001 to 10000` |
| `10000+` | `10000+` |

Observed prod values are exactly that set — no `11 to 25` band exists, so the `11-50` mapping loses nothing today. `51-200` reaching into `101 to 250` is slightly wider than its label.

---

## 5. Quick verification snippets

Confirm the live count function still matches what this doc describes:

```sql
SELECT
  pg_get_functiondef(p.oid) LIKE '%v_active_filters = 0 THEN%RETURN QUERY SELECT 0::bigint%'
    AS unfiltered_returns_zero,
  pg_get_functiondef(p.oid) LIKE '%RETURN QUERY SELECT 100000::bigint, false::boolean%'
    AS hardcoded_100000
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'search_prospects_count';
```

Read rows safely (works with the anon key; `SECURITY DEFINER` bypasses the slow RLS):

```js
await supabase.rpc('search_prospects_results', { p_limit: 25, p_offset: 0 });
```
