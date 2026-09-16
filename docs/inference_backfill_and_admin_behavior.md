## Inference moat: historical backfill and Admin chart behavior

This draft adds two core pieces toward a trustworthy inference moat:

- An idempotent historical backfill from durable sources into `public.inference_events`
- Safer Admin aggregations (rates require minimum sample size and industry is enriched)

### What is backfilled

The migration `20260902052000_inference_events_backfill_firmographics.sql` inserts additive rows into `public.inference_events`:

- `agent_leads → replied` and `agent_leads → classified` (intent retained; nothing is invented)
- `draft_audit → classified` (intent from audit)

Each insert includes best-effort firmographics by joining `synced_contacts` on `(team_id, email|linkedin_url)`. Inserts are guarded by:

- `UNIQUE INDEX (source, source_row_id, event_type)` on `inference_events`
- `ON CONFLICT DO NOTHING` in the migration statements

This makes the backfill safe and re-runnable.

### Industry enrichment for Admin

To avoid leaking raw people while improving analytics quality, the new view `public.inference_events_enriched` coalesces:

```
industry := COALESCE(people.industry, inference_events.industry)
```

The view is `security_invoker`, so RLS on both underlying tables applies. The Admin UI reads from this view only.

### Admin chart behavior (guardrails)

- Rates never render when their denominator is zero
- Buckets with low sample size are visually de-emphasized:
  - Reply rate: low-N means `sent < 10`
  - Interested rate: low-N means `classified < 10`
- X‑axis labels use a custom tick to prevent first-letter clipping in rotated labels

These thresholds are conservative and can be tuned in `src/components/admin/InferenceTab.tsx`.

### How to extend

1) Additional sources for historical events  
   Add `INSERT … ON CONFLICT DO NOTHING` statements into a new migration using `source` and `source_row_id`. Keep the row model additive and avoid inventing intents.

2) More firmographic enrichment  
   Extend `public.inference_events_enriched` to coalesce other attributes (e.g., `job_title`, `company_size`) from `public.people`. Keep the view `security_invoker`.

3) Alternate sample-size thresholds  
   Adjust `DENOM_THRESHOLD` inside `InsightRatesPanel` if product acceptance warrants different minimums.

