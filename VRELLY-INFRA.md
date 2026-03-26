# VRELLY-INFRA.md — Complete Infrastructure Reference

> **Last Updated:** March 25, 2026
> **Status:** Authoritative — if this doc conflicts with code, verify code and update this doc.

---

## 1. What Is Vrelly

Vrelly is a B2B sales intelligence platform. Users search a database of ~240K+ prospect records, filter by dozens of criteria, unlock/export contacts using credits, and run outbound campaigns.

### The 4 Core Pillars

| Pillar | What It Does | Key Pages |
|--------|-------------|-----------|
| **Audience Builder** | Search & filter prospects by job title, seniority, industry, location, company size, etc. Export contacts with credits. | `/people`, `/companies` |
| **Data Playground** | Sync outbound campaign data from Reply.io. View campaign stats, contact engagement, email sequences. AI copy generation. | `/playground` |
| **OpenClaw Agents** | AI-powered outbound sales agents (marketing/landing page — not yet a live product feature). | `/agents` |
| **Content & Resources** | SEO blog/resource articles published via edge function, comparison pages. | `/resources`, `/comparisons` |

---

## 2. Full Tech Stack

### Frontend
| Technology | Purpose |
|-----------|---------|
| React 18 + TypeScript | UI framework |
| Vite 5 | Build tool & dev server |
| React Router 6 | Client-side routing |
| Tailwind CSS 3 | Styling |
| shadcn/ui (Radix primitives) | Component library |
| Zustand | State management (audienceStore, authStore) |
| TanStack React Query | Server state/caching |
| Recharts | Dashboard charts |
| PapaParse | CSV parsing |
| react-helmet-async | SEO meta tags |
| Zod | Schema validation |
| Lucide React | Icons |

### Backend
| Technology | Purpose |
|-----------|---------|
| Supabase | Auth, Postgres DB, Edge Functions, Storage, RLS |
| Supabase Edge Functions (Deno) | All serverless API logic |
| Stripe | Subscriptions & billing |
| Reply.io API (V1/V2/V3) | Outbound campaign sync |
| Anthropic Claude API | AI copy generation + audience building (generate-copy, revamp-copy, build-audience) |
| Lovable AI Gateway (Google Gemini 3 Flash) | CSV field mapping analysis (analyze-csv-knowledge) |
| AudienceLab API | Audience enrichment (audiencelab-api) |

### Deployment
| Service | Purpose |
|---------|---------|
| Lovable | Frontend hosting & CI/CD (auto-deploys from git) |
| Supabase Cloud | Database + Edge Functions hosting |
| Stripe | Payment processing |

---

## 3. Supabase Projects (Environments)

| Environment | Project ID | URL | Usage |
|-------------|-----------|-----|-------|
| **Production** | `lgnvolndyftsbcjprmic` | `https://lgnvolndyftsbcjprmic.supabase.co` | Live site, .env.production & .env.local |
| **Development** | `iqxzetwuxykplzdjysiu` | `https://iqxzetwuxykplzdjysiu.supabase.co` | Dev only, .env.development |
| **Legacy (config.toml)** | `srartzeqcbxbytfixeiv` | — | Referenced in supabase/config.toml, likely outdated |

### Environment Files
```
.env.example      — Template with comments explaining the env file system
.env.development  — Dev Supabase project (auto-loaded by `npm run dev`)
.env.production   — Prod Supabase project (auto-loaded by `npm run build`)
.env.local        — Local overrides (highest priority, gitignored)
```

Vite loads env files by mode. `npm run dev` → development, `npm run build` → production. `.env.local` always wins.

---

## 4. Repository Structure

```
VrellyData/
├── src/
│   ├── App.tsx                        # Root: routes, providers, guards
│   ├── pages/                         # 19 route pages
│   │   ├── Landing.tsx                # / — public landing page
│   │   ├── Auth.tsx                   # /auth — login/signup
│   │   ├── ResetPassword.tsx          # /reset-password
│   │   ├── ChoosePlan.tsx             # /pricing, /choose-plan
│   │   ├── CheckoutSuccess.tsx        # /checkout-success
│   │   ├── Index.tsx                  # /dashboard — main dashboard
│   │   ├── People.tsx                 # /people — person audience builder
│   │   ├── Companies.tsx              # /companies — company builder
│   │   ├── AudienceBuilder.tsx        # Shared builder logic component
│   │   ├── DataPlayground.tsx         # /playground — Reply.io sync + AI copy
│   │   ├── Agents.tsx                 # /agents — OpenClaw marketing page
│   │   ├── Settings.tsx               # /settings, /billing
│   │   ├── Admin.tsx                  # /admin — admin panel (AdminRoute)
│   │   ├── Resources.tsx              # /resources — blog listing
│   │   ├── ResourceArticle.tsx        # /resources/:slug — single article
│   │   ├── Comparisons.tsx            # /comparisons — competitor comparisons
│   │   ├── Terms.tsx, Privacy.tsx     # Legal pages
│   │   └── NotFound.tsx               # 404
│   ├── components/
│   │   ├── admin/                     # Admin panel tabs (data sources, users, etc.)
│   │   ├── search/                    # FilterBuilder, UnlockConfirmDialog, ResultsTable
│   │   ├── playground/                # CampaignsTable, PeopleTab, CopyTab, BuildAudienceDialog
│   │   ├── landing/                   # Navbar, HeroSection, Footer, etc.
│   │   ├── insights/                  # Audience insights components
│   │   ├── lists/                     # List management components
│   │   ├── records/                   # CSVImportDialog, record display
│   │   ├── settings/                  # Settings page tabs
│   │   ├── ui/                        # shadcn/ui components
│   │   ├── AuthProvider.tsx           # Auth context + session management
│   │   ├── ProtectedRoute.tsx         # Requires auth
│   │   ├── SubscriptionGuard.tsx      # Requires active subscription
│   │   ├── AdminRoute.tsx             # Requires admin role
│   │   └── AppErrorBoundary.tsx       # Global error boundary
│   ├── hooks/                         # 37 custom hooks
│   │   ├── useFreeDataSearch.ts       # CORE: search_prospects_results/count RPC calls
│   │   ├── useFreeDataSuggestions.ts  # Filter suggestion dropdowns
│   │   ├── useDeduplication.ts        # Record categorization & credit calc
│   │   ├── useUnlockedRecords.ts      # Track what user already owns
│   │   ├── useCreditCheck.ts          # Credit checking and deduction
│   │   ├── useCredits.ts              # Credit balance management
│   │   ├── useSubscription.ts         # Subscription state
│   │   ├── useFilterPresets.ts        # Saved filter presets
│   │   ├── useSavedAudiences.ts       # Saved audiences
│   │   ├── useOutboundIntegrations.ts # Reply.io integration CRUD + sync
│   │   ├── useSyncedCampaigns.ts      # Campaign data
│   │   ├── useSyncedContacts.ts       # Contact data
│   │   ├── useSyncedContactsPaged.ts  # Paged contacts
│   │   ├── useSyncedSequences.ts      # Email sequences
│   │   ├── useCopyTemplates.ts        # AI copy templates
│   │   ├── usePlaygroundStats.ts      # Dashboard aggregation
│   │   ├── useFreeData.ts             # Admin CSV upload to free_data
│   │   ├── useResources.ts            # Blog/resource CRUD
│   │   ├── useSmartFilter.ts          # Smart filter suggestions
│   │   ├── useFilterOptions.ts        # Filter option lists
│   │   └── ... (others)
│   ├── lib/                           # Utility modules
│   │   ├── freeDataFilter.ts          # mapFreeDataToPerson/Company (prospects → frontend)
│   │   ├── filterConversion.ts        # FilterBuilderState type + conversion
│   │   ├── csvImportMapper.ts         # CSV field mapping & transformation
│   │   ├── entityIdGenerator.ts       # Deterministic entity IDs for dedup
│   │   ├── dataHash.ts               # djb2 hash for change detection
│   │   ├── csvExport.ts              # Export to CSV
│   │   ├── credits.ts                # Credit calculation helpers
│   │   ├── audienceLabClient.ts       # AudienceLab API client
│   │   ├── smartFilterEvaluator.ts    # Smart filter evaluation
│   │   └── utils.ts                   # General utilities
│   ├── stores/
│   │   ├── audienceStore.ts           # Zustand: search results, filters, pagination
│   │   └── authStore.ts              # Zustand: auth state
│   ├── integrations/supabase/
│   │   ├── client.ts                  # Supabase client init
│   │   └── types.ts                   # (empty — types generated but cleared)
│   ├── config/
│   │   ├── subscriptionTiers.ts       # Tier definitions + Stripe price/product IDs
│   │   └── csvImportFields.ts         # CSV field definitions and aliases
│   └── types/
│       └── audience.ts                # PersonEntity, CompanyEntity, EntityType
├── supabase/
│   ├── config.toml                    # Edge function JWT config (all verify_jwt = false)
│   ├── functions/                     # 27 Edge Functions (see Section 6)
│   └── migrations/                    # ~149 SQL migrations
├── scripts/
│   ├── test-builder-filters.mjs       # Tests each filter individually
│   ├── test-all-filter-combinations.mjs # Tests single + multi-filter combos with timeout
│   ├── test-vrelly.mjs                # Full stack integration test (auth, RLS, Stripe)
│   ├── create-keyword-index.mjs       # Creates GIN tsvector index on prospects
│   ├── create-annual-prices.mjs       # Creates annual Stripe price objects
│   ├── generate-sitemap.mjs           # Generates XML sitemap from resources
│   └── security-audit.md             # Security audit notes
├── docs/
│   ├── SEARCH_FUNCTION_LOCK.md        # Search function protection rules
│   ├── FILTER_CONTRACT.md             # Authoritative field mappings
│   ├── FILTER_DATA_MAPPING.md         # UI → DB field mapping reference
│   ├── STABLE_CHECKPOINTS.md          # Version history & baseline counts
│   ├── BUILDER_SEARCH_TEST.sql        # SQL test suite for search functions
│   ├── HEALTH_CHECK.sql               # Pre-change health verification
│   ├── QUICK_CHECK.sql                # Quick verification queries
│   └── V3.2–V4.0_RELEASE_NOTES.md    # Release notes per version
├── dist/                              # Production build output
├── LOGIC_README.md                    # App logic documentation (admin upload, credits, search)
└── VRELLY-INFRA.md                    # This file
```

---

## 5. Supabase Database

### Database Architecture: Two Table Systems

The database has evolved through two generations:

| Generation | Table | Column Style | Status |
|-----------|-------|-------------|--------|
| **Gen 1** | `free_data` | JSONB `entity_data` column | Still used for admin CSV uploads |
| **Gen 2** | `prospects` | Flat columns (snake_case) | **Primary search table** — ~240K+ records |

The `free_data` table stores records as `{entity_type, entity_external_id, entity_data: {...}}` where `entity_data` is a JSONB blob. The `prospects` table has proper columns (`first_name`, `last_name`, `job_title`, etc.) which enables real indexes and much better performance.

### Key Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `prospects` | Main prospect database (~240K records) | `first_name`, `last_name`, `job_title`, `seniority`, `department`, `company_name`, `company_industry`, `company_size`, `company_revenue`, `city`, `state`, `country`, `company_city`, `company_state`, `company_country`, `business_email`, `personal_email`, `phone`, `linkedin_url`, `facebook_url`, `twitter_url`, `company_linkedin`, `company_phone`, `company_domain`, `company_description`, `gender`, `net_worth`, `income_range`, `age_range`, `children`, `homeowner`, `married`, `education_history`, `skills`, `interests`, `technologies`, `keywords`, `zip_code`, `company_zip_code`, `company_sic`, `company_naics`, `entity_external_id`, `added_at` |
| `free_data` | Legacy entity store (admin uploads) | `entity_type`, `entity_external_id`, `entity_data` (JSONB) |
| `user_credits` | Subscription & credit tracking | `user_id`, `plan`, `billing_interval`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end`, `export_credits_total`, `export_credits_used`, `ai_credits_total`, `ai_credits_used`, `enterprise_daily_exports` |
| `unlocked_records` | Records user has paid to unlock | `team_id`, `entity_type`, `entity_external_id`, `data_hash` |
| `saved_audiences` | Saved filter sets from playground | `user_id`, `name`, `filters` (JSONB), `result_count`, `preset_id`, `insights` |
| `filter_presets` | Saved filter presets | `user_id`, `name`, `filters` |
| `profiles` | User profiles | `id`, `credits`, ... |
| `credit_transactions` | Credit audit trail | Transaction log |
| `resources` | Blog/SEO articles | `slug`, `title`, `content`, `is_published`, ... |
| `outbound_integrations` | Reply.io API keys & sync state | `api_key`, `platform`, `sync_status`, `links_initialized` |
| `synced_campaigns` | Campaign metadata from Reply.io | Campaign stats |
| `synced_contacts` | Contact engagement data | Per-contact metrics |
| `synced_sequences` | Email step content | Sequence/step data |
| `copy_templates` | AI-generated email variants | Template content |
| `people_records` | Team's people records | `team_id`, ... |
| `company_records` | Team's company records | `team_id`, ... |

### Key Database Functions

| Function | Purpose | Returns |
|----------|---------|---------|
| `search_prospects_results(...)` | Paginated prospect search with all filters | `entity_external_id`, `entity_data` (re-composed JSONB) |
| `search_prospects_count(...)` | Count for same filters | `total_count`, `is_estimate` |
| `search_free_data_builder(...)` | Legacy combined search (retained, not called from frontend) | `entity_external_id`, `entity_data`, `total_count` |
| `search_free_data_results(...)` | Legacy split results (free_data table) | `entity_external_id`, `entity_data` |
| `search_free_data_count(...)` | Legacy split count (free_data table) | `total_count`, `is_estimate` |
| `parse_revenue_to_numeric(text)` | Parses "$5M", "$10,000,000" → numeric | numeric |
| `parse_employee_count_upper(text)` | Parses "51-200" → 200 | integer |
| `title_matches_seniority(...)` | Seniority regex matching | boolean |
| `get_filter_suggestions()` | Distinct values for filter dropdowns | suggestion rows |
| `handle_new_user_credits()` | Auto-creates user_credits row on signup | trigger function |
| `update_updated_at()` | Auto-update timestamp trigger | trigger function |

### RLS (Row Level Security)

- `user_credits`: Users can only read their own row; service_role has full access
- `saved_audiences`: Users can only manage their own audiences
- Edge functions use `SECURITY DEFINER` to bypass RLS where needed

---

## 6. All Edge Functions (27 total)

All functions have `verify_jwt = false` in config.toml — JWT verification is done manually inside each function.

### Audience Builder & Credits
| Function | Purpose | External APIs |
|----------|---------|--------------|
| `check-and-use-credits` | Deduct export/AI credits, enforce limits (daily for enterprise) | — |
| `check-subscription` | Verify Stripe subscription status, sync with user_credits | Stripe |
| `audiencelab-api` | Proxy to AudienceLab with filter allowlisting & sanitization | AudienceLab |

### Stripe & Billing
| Function | Purpose | External APIs |
|----------|---------|--------------|
| `create-checkout` | Create Stripe Checkout session | Stripe |
| `customer-portal` | Create Stripe Customer Portal session | Stripe |
| `manage-subscription` | Upgrade/downgrade/cancel subscription | Stripe |
| `create-stripe-products` | One-time: create Stripe products & prices | Stripe |
| `stripe-webhook` | Handle Stripe events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid/payment_failed` | Stripe (signature verified) |
| `reset-monthly-credits` | Reset credits at billing cycle start | — |

### Reply.io Integration (Data Playground)
| Function | API Version | Purpose |
|----------|-------------|---------|
| `validate-api-key` | V1 | Validate Reply.io API key |
| `fetch-reply-teams` | V1 | Fetch Reply.io teams |
| `fetch-integration-teams` | V1 | Fetch teams for integration setup |
| `fetch-available-campaigns` | V1 | Campaign discovery + peopleCount, auto-link on first sync |
| `fetch-campaigns` | V1 | Fetch campaign list |
| `sync-reply-campaigns` | V3 | Sync campaign status/names |
| `sync-reply-contacts` | V1 | Sync contact engagement data per campaign |
| `sync-reply-sequences` | V1 | Sync email sequence steps |
| `setup-reply-webhook` | V2 | Register Reply.io webhook |
| `reply-webhook` | — | Incoming webhook handler (HMAC SHA-256 verified) for real-time campaign updates |
| `send-contacts` | V1 | Push contacts to Reply.io campaign |
| `receive-contacts` | — | Receive contacts from external sources |

### AI & Content
| Function | Purpose | External APIs |
|----------|---------|--------------|
| `generate-copy` | Generate multi-channel outreach sequences from top campaign data | Anthropic Claude |
| `revamp-copy` | Rewrite/improve existing email copy using campaign performance data | Anthropic Claude |
| `build-audience` | Build ICP using AI analysis + prospect search | Anthropic Claude (Sonnet 4.5) + search_prospects RPC |
| `analyze-csv-knowledge` | Analyze CSV data for sales knowledge field mapping | Lovable AI Gateway (Gemini 3 Flash) |
| `publish-resource` | Publish blog/resource articles (used by OpenClaw agent via `x-agent-key`) | — |

### Admin
| Function | Purpose |
|----------|---------|
| `admin-delete-user` | Delete user and all associated data |

---

## 7. Indexes on the `prospects` Table

The `prospects` table has extensive indexing for search performance. Key index categories:

### Full-Text Search Index
```sql
idx_prospects_keyword_fts — GIN index on to_tsvector('english',
  coalesce(job_title,'') || ' ' || coalesce(company_name,'') || ' ' ||
  coalesce(company_industry,'') || ' ' || coalesce(company_description,''))
```
Created via `scripts/create-keyword-index.mjs` (runs CONCURRENTLY with progress monitoring).

### Trigram (pg_trgm) GIN Indexes
Used for ILIKE pattern matching on text columns:
- `idx_prospects_job_title_trgm` — `job_title gin_trgm_ops`
- `idx_prospects_company_city_trgm` — `company_city gin_trgm_ops`
- (Plus others for columns used in ILIKE filters)

### B-tree Indexes
- `idx_prospects_seniority_btree` — `lower(seniority)` — for exact match via `lower() = ANY()`
- Standard B-tree indexes on frequently filtered columns

### Notes
- Run `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'prospects' ORDER BY indexname;` in Supabase SQL Editor to get the authoritative current list.
- The `free_data` table also has ~16 GIN/B-tree indexes (documented in LOGIC_README.md Section 7) but these are less relevant now that search uses `prospects`.

---

## 8. Search Functions — How They Work

### Architecture: Split Search (v4.0+, evolved to prospects table)

The frontend calls **two functions in parallel** via `Promise.allSettled`:

```
useFreeDataSearch.ts
  ├── search_prospects_results(filters, limit, offset)  → rows
  └── search_prospects_count(filters)                    → total_count, is_estimate
```

Results display immediately (~1-2s). Count arrives independently (~3-5s for keyword searches, instant for unfiltered).

### search_prospects_results

- **Language:** PL/pgSQL with dynamic SQL (`EXECUTE`)
- **Security:** `SECURITY DEFINER` (bypasses 8s authenticated role timeout)
- **Timeout:** 15 seconds
- **Settings:** `plan_cache_mode = force_custom_plan`, `work_mem = 256MB`
- **Returns:** `entity_external_id`, flat column data (mapped to entity_data-style in frontend)

**Filter chain:** Builds a WHERE clause dynamically. Each active filter appends AND conditions using parameterized queries ($1, $2, etc.).

### search_prospects_count

- **Security:** `SECURITY DEFINER`
- **Timeout:** 30 seconds
- **Settings:** `work_mem = 256MB`
- **Count strategy:**
  - **Filtered queries:** `SELECT count(*) FROM (... LIMIT 100001) _sub` → exact bounded count, `is_estimate = false`
  - **Unfiltered queries:** `pg_class.reltuples` → instant statistical estimate, `is_estimate = true`
  - **Timeout/error fallback:** Returns `total_count = 0, is_estimate = true`

### Filter Parameters (shared by both functions)

Both functions accept the same filter parameters. Key ones:

| Parameter | Filter Type | Implementation |
|-----------|------------|----------------|
| `p_keywords` | Full-text search | `to_tsvector @@ plainto_tsquery` per keyword, OR'd together |
| `p_job_titles` | ILIKE | `p.job_title ILIKE '%' || jt || '%'` |
| `p_seniority_levels` | Exact match | `lower(p.seniority) = ANY(ARRAY[...])` (btree index) |
| `p_departments` | Regex | CASE statement with regex patterns per department |
| `p_industries` | ILIKE | Case-insensitive match |
| `p_cities` | ILIKE | Checks `city` OR `company_city` |
| `p_countries` | ILIKE | Checks `country` OR `company_country` |
| `p_company_size_ranges` | Range parse | `parse_employee_count_upper()` BETWEEN ranges |
| `p_company_revenue` | Range parse | `parse_revenue_to_numeric()` BETWEEN ranges |
| `p_gender` | Exact | `lower(gender) = ANY(...)`, frontend converts male→M, female→F |
| `p_has_*` | NOT NULL check | `p.business_email IS NOT NULL AND p.business_email != ''` |
| `p_exclude_*` | DNC exclusions | NOT ILIKE / NOT matching |
| `p_company_names` | ILIKE | Company name match |
| `p_zip_code` | Prefix match | Zip code filter |
| `p_age_min/max` | Range | Age range filter |
| `p_children` | Match | Children filter |
| `p_homeowner` | Boolean | Homeowner filter |
| `p_married` | Boolean | Married filter |
| `p_education` | ILIKE | Education filter |
| `p_added_on_days_ago` | Date | Records added within N days |

### Performance Optimizations (March 2026)

| Optimization | Problem | Solution | Result |
|-------------|---------|----------|--------|
| **plainto_tsquery** | `to_tsquery` timed out on single keywords | Switched to `plainto_tsquery` per keyword, OR'd | Keywords work reliably |
| **work_mem = 256MB** | Default 5MB caused lossy bitmap blocks → 400K row rechecks | `SET LOCAL work_mem = '256MB'` inside function | Multi-filter combos no longer timeout |
| **Seniority btree** | ILIKE on seniority used trigram GIN (overkill for exact matches) | `lower(seniority) = ANY()` with btree index on `lower(seniority)` | job_titles+seniority: timeout → 278ms |
| **company_city trigram** | City OR condition forced seq scan on company_city | Added `idx_prospects_company_city_trgm` GIN index | seniority+dept+city: timeout → 1951ms |
| **FTS GIN index** | Keyword search had no index | Created `idx_prospects_keyword_fts` via scripts/create-keyword-index.mjs | Keyword queries ~1-2s |

### Frontend Mapping (`src/lib/freeDataFilter.ts`)

The `mapFreeDataToPerson()` and `mapFreeDataToCompany()` functions convert flat `prospects` columns (snake_case) back to the frontend's `PersonEntity`/`CompanyEntity` types (camelCase). Key mappings:

```
prospects.first_name → PersonEntity.firstName
prospects.job_title → PersonEntity.jobTitle
prospects.company_name → PersonEntity.company
prospects.company_industry → PersonEntity.industry
prospects.business_email → PersonEntity.businessEmail
prospects.company_size → (parsed & bucketed) → PersonEntity.companySize
```

---

## 9. Stripe Setup

### Products & Pricing

| Tier | Monthly | Annual | Export Credits | AI Credits | Stripe Product ID |
|------|---------|--------|----------------|------------|-------------------|
| Starter | $75/mo | $749/yr ($62/mo) | 10,000 | 50 | `prod_TMHGcnFjx5n8DZ` |
| Professional | $150/mo | $1,499/yr ($125/mo) | 25,000 | 250 | `prod_TMHHjUdtt2Xbdl` |
| Enterprise | $350/mo | $3,499/yr ($292/mo) | 100,000 (daily cap, shown as "Unlimited") | 1,250 | `prod_TMHItV1NP0yBYU` |

### Stripe Price IDs

**Monthly:**
- Starter: `price_1SPYhwRvAXonKS41WFHowijk`
- Professional: `price_1SPYjHRvAXonKS41B0eriTUC`
- Enterprise: `price_1SPYjTRvAXonKS41RdJr9r7I`

**Annual:**
- Starter: `price_1T9TqvRvAXonKS41LFgEf983`
- Professional: `price_1T9TqwRvAXonKS41vRpnp2xU`
- Enterprise: `price_1T9TqwRvAXonKS41G4SCT11j`

### Billing Flow
1. User signs up → `handle_new_user_credits()` trigger creates `user_credits` row (plan: 'none')
2. User selects plan → `create-checkout` edge function → Stripe Checkout
3. Stripe webhook → `stripe-webhook` edge function → updates `user_credits`
4. Credits reset at billing cycle → `reset-monthly-credits` edge function
5. Manage subscription → `manage-subscription` edge function
6. Portal access → `customer-portal` edge function

### Config File
Defined in `src/config/subscriptionTiers.ts`. This is the single source of truth for tier definitions.

---

## 10. OpenClaw Content Agent

The Agents page (`/agents`) is currently a **marketing/landing page** promoting AI-powered outbound sales agents. It is not yet a functional product feature.

The `publish-resource` edge function allows an external agent (authenticated via `AGENT_API_KEY`) to publish blog articles to the `resources` table. This powers the SEO content pipeline.

---

## 11. Current State & Work in Progress

### What's Done (as of March 25, 2026)

- Audience Builder fully functional with `prospects` table (~240K records)
- Split search architecture (results + count in parallel)
- 18 filters + 8 DNC exclusions all working
- Keyword search using `plainto_tsquery` with FTS GIN index
- Seniority filter using btree index + `lower() = ANY()`
- `work_mem = 256MB` preventing lossy bitmap blocks
- Stripe billing with monthly + annual plans
- Reply.io Data Playground sync (campaigns, contacts, sequences)
- AI copy generation (generate-copy, revamp-copy)
- User credits system (export + AI credits)
- Security hardening: JWT verification + CORS lockdown on all edge functions
- Console.log cleanup (35 statements removed)
- Saved audiences with filter presets

### Pending Migrations (uncommitted)
```
supabase/migrations/20260324_fix_keyword_plainto_tsquery.sql  — needs to be run in SQL Editor
supabase/migrations/20260325_fix_seniority_ilike.sql          — needs to be run in SQL Editor
```
These use `pg_get_functiondef` dynamic replacement to patch the live functions. They are NOT standard Supabase migrations — they must be run manually in the SQL Editor.

### Uncommitted Scripts
```
scripts/create-keyword-index.mjs          — creates FTS GIN index (may already be created)
scripts/test-all-filter-combinations.mjs  — comprehensive filter timeout testing
scripts/test-builder-filters.mjs          — individual filter regression tests
```

---

## 12. Key Principles & Hard-Learned Lessons

### Database Function Safety
1. **NEVER change parameter signatures** — PostgreSQL creates overloaded duplicates instead of replacing. Same name + different params = two functions.
2. **Always use `CREATE OR REPLACE FUNCTION`** with the exact same parameter names, types, and order.
3. **Run health check before AND after** any function modification.
4. **Check for duplicate functions** after every change:
   ```sql
   SELECT proname, COUNT(*) FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' GROUP BY proname HAVING COUNT(*) > 1;
   ```

### Performance Lessons (March 2026)
5. **ILIKE is already case-insensitive** — wrapping columns in `LOWER()` prevents index usage. Remove LOWER() wrappers from ILIKE expressions.
6. **Use btree for exact matches, trigram GIN for ILIKE** — seniority values are exact matches, so btree on `lower(seniority)` is faster than trigram.
7. **work_mem matters** — Default 5MB causes bitmap scans to go lossy (page-level), requiring full row rechecks on 400K+ tables. 256MB keeps bitmaps exact.
8. **plainto_tsquery > to_tsquery** for user input — `to_tsquery` requires valid tsquery syntax. `plainto_tsquery` handles plain text safely.
9. **SECURITY DEFINER bypasses role timeouts** — The `authenticated` role has an 8s statement_timeout. SECURITY DEFINER functions run as the definer (superuser), bypassing this.
10. **BitmapOr needs indexes on both sides** — `city ILIKE x OR company_city ILIKE x` requires trigram indexes on BOTH columns, or the OR forces a seq scan.

### Architecture Lessons
11. **Split results from count** — Users see results in 1-2s. Count can take 3-5s for complex queries. Don't block one on the other.
12. **`pg_class.reltuples` for unfiltered counts** — Instant statistical estimate, good enough for "~240,000 records" display.
13. **Bounded count (LIMIT 100001)** — Prevents runaway count queries. If > 100K, display "100,000+".
14. **`force_custom_plan`** — Prevents Postgres from caching a generic plan that's wrong for specific filter combinations.

### Security Lessons
15. **Remove console.log in production** — Was leaking sensitive user and filter data.
16. **JWT verification in edge functions** — All functions do manual JWT verification despite `verify_jwt = false` in config.toml (needed for CORS preflight).
17. **Never expose service role keys** in frontend code.

---

## 13. Useful Commands

### Development
```bash
npm run dev          # Start Vite dev server (uses .env.development)
npm run build        # Production build (uses .env.production)
npm run build:dev    # Dev build (uses .env.development)
npm run preview      # Preview production build locally
npm run lint         # ESLint
```

### Database Queries (run in Supabase SQL Editor)

```sql
-- Check for duplicate functions
SELECT proname, COUNT(*) FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' GROUP BY proname HAVING COUNT(*) > 1;

-- List all indexes on prospects
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'prospects' ORDER BY indexname;

-- Check search function signature
SELECT pg_catalog.pg_get_function_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'search_prospects_results';

-- Quick search test
SELECT count(*) FROM public.search_prospects_results(p_limit := 10, p_offset := 0);

-- Count test: keyword
SELECT total_count, is_estimate FROM public.search_prospects_count(p_keywords := ARRAY['CEO']);

-- Table row counts
SELECT relname, reltuples::bigint FROM pg_class
WHERE relname IN ('prospects', 'free_data', 'user_credits', 'unlocked_records')
ORDER BY reltuples DESC;
```

### Edge Function Deployment
```bash
npx supabase functions deploy <function-name> --project-ref lgnvolndyftsbcjprmic
npx supabase functions deploy --all --project-ref lgnvolndyftsbcjprmic
```

### Git
```bash
git log --oneline -20     # Recent commits
git status                # Check working state
```

---

## 14. Test Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `test-builder-filters.mjs` | `node scripts/test-builder-filters.mjs` | Tests each filter individually against `search_prospects_results` + `search_prospects_count`. Reports pass/fail per filter. |
| `test-all-filter-combinations.mjs` | `node scripts/test-all-filter-combinations.mjs` | Tests single filters AND multi-filter combinations (keywords+titles, keywords+seniority, etc.) with 10s timeout. Catches timeout regressions. |
| `test-vrelly.mjs` | `node scripts/test-vrelly.mjs` | Full stack integration test: auth signup/signin, edge function calls, database RLS, Stripe config verification. Requires env vars. |
| `create-keyword-index.mjs` | `node scripts/create-keyword-index.mjs` | Creates the FTS GIN index on prospects CONCURRENTLY. Shows progress. Uses direct PG connection (password in script). |
| `create-annual-prices.mjs` | `STRIPE_SECRET_KEY=sk_... node scripts/create-annual-prices.mjs` | One-time script to create annual Stripe price objects. Already run — IDs in subscriptionTiers.ts. |
| `generate-sitemap.mjs` | `node scripts/generate-sitemap.mjs` | Generates XML sitemap from published resources + static pages. |

### SQL Test Files
| File | Purpose |
|------|---------|
| `docs/BUILDER_SEARCH_TEST.sql` | Automated test suite for all search function filters |
| `docs/HEALTH_CHECK.sql` | Pre/post-change verification (duplicates, signatures, counts) |
| `docs/QUICK_CHECK.sql` | Quick verification queries |

---

## 15. Related Documentation

| Document | Purpose |
|----------|---------|
| `LOGIC_README.md` | Core app logic: admin upload flow, credits, search, deduplication, data playground |
| `docs/SEARCH_FUNCTION_LOCK.md` | Search function protection rules and revert procedures |
| `docs/FILTER_CONTRACT.md` | Authoritative filter field mappings and baseline counts |
| `docs/FILTER_DATA_MAPPING.md` | UI → database field mapping reference |
| `docs/STABLE_CHECKPOINTS.md` | Version history, baseline counts, revert commands |
| `docs/V4.0_RELEASE_NOTES.md` | Split search architecture details |

---

## 16. Quick Reference

| What | Value |
|------|-------|
| Production URL | vrelly.com |
| Supabase Prod Project | `lgnvolndyftsbcjprmic` |
| Primary Data Table | `prospects` (~240K records, flat columns) |
| Legacy Data Table | `free_data` (JSONB entity_data) |
| Search Functions | `search_prospects_results` + `search_prospects_count` |
| Frontend Search Hook | `src/hooks/useFreeDataSearch.ts` |
| Frontend Data Mapper | `src/lib/freeDataFilter.ts` |
| Subscription Config | `src/config/subscriptionTiers.ts` |
| Total Filters | 18 include + 8 DNC exclude |
| Display Cap | 100,000+ |
| Results Timeout | 15s (SECURITY DEFINER) |
| Count Timeout | 30s (SECURITY DEFINER) |
| work_mem | 256MB (set inside functions) |
| Stripe Account | RvAXonKS41 (from price ID pattern) |
