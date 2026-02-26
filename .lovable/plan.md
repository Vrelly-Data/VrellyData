

# Add Trigram Indexes to Fix Search Timeout

## What's happening
Your search logic is **completely untouched** -- nothing is broken. The timeout is a speed problem, not a logic problem. When you search for job titles, keywords, skills, etc., the database has to check every single row one by one (52,000+ rows) because it has no fast lookup for substring matches like "contains CEO."

## What we'll do
Add a speed boost to the database -- specifically, enable a feature called trigram indexing that lets the database instantly find text matches instead of scanning every row. **Zero changes to your search function or frontend code.**

## The fix (single database migration)

1. Enable the `pg_trgm` extension (built into the database, just needs to be turned on)
2. Create fast-lookup indexes on the 8 text fields used in search:
   - `title` (job titles + keywords)
   - `firstName`, `lastName`, `company`, `companyName` (keywords)
   - `skills`, `interests`, `technologies` (multi-value filters)
3. No changes to `search_free_data_builder` -- the database automatically uses the new indexes

## Expected result

| Scenario | Before | After |
|----------|--------|-------|
| Search with no filters | ~7s | <1s |
| Job title "CEO" | ~7.5s (timeout risk) | <200ms |
| Keyword search | ~28s (timeout) | <500ms |
| At 1M rows | Guaranteed timeout | Should stay under 2s |

## Risk

| Risk | Level | Why |
|------|-------|-----|
| Search logic changes | None | Function is not modified at all |
| Breaking anything | None | Only adds new indexes, touches nothing existing |
| Result counts changing | None | Indexes only affect speed, not what gets returned |

