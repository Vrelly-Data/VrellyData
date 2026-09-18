### Firmographics backfill (one-shot) — people.company_phone + roster coalesce

Goal
- Ensure every person has Title, Location, Company Name, Company Size, Industry, Company Phone (new), and (optionally) personal Phone when available from sources (Reply.io, Smartlead).
- Never downgrade a non-empty `people` field to blank/null on later syncs (write-only/coalesce).

What changed
- Schema: added `people.company_phone text` and `people.phone text`; added `inference_events.company_phone text` for denormalized snapshots.
- Smartlead ingest:
  - `smartlead-webhook` now fetches Smartlead leads by email and extracts custom_fields to populate `industry`, `company_size`, `city/state/country`, `company_phone`, and `phone`. People upserts are coalescing (omit empty keys) to avoid clobber.
  - `sync-smartlead-leads` maps Smartlead `custom_fields` into `synced_contacts` (job_title, industry, company_size, city/state/country), sanitizes LinkedIn placeholders, and preserves raw custom_fields for future use.
- Reply.io ingest (already present): `sync-reply-contacts` enriches firmographics from the bulk `/v3/contacts` list and applies them write-only via `applyFirmographics()`. No changes to messaging paths.

One-shot backfill function
- Added `supabase/functions/backfill-firmographics` (internal, x-agent-key gated).
- It pages `synced_contacts` for a team and upserts into `people` using coalesce semantics:
  - `person_key = lower(email) OR linkedin_url`
  - includes only non-empty values for `job_title, company_name, industry, company_size, city, state, country, phone`
  - derives `company_phone` from `custom_fields` keys like "Company Phone", "HQ Phone" when present
- No provider API calls are made in this path to keep it safe by default. If needed later, it can be extended to page Smartlead campaigns and Reply.io workspaces (reuse the helpers in `sync-smartlead-leads` and `sync-reply-contacts`).

How to run (internal)
1) Deploy the edge function via your normal process.
2) Invoke with service credentials:
   - Headers: `x-agent-key: $AGENT_API_KEY`
   - Body: `{ "teamId": "<uuid>" }`
3) The function reports `{ scanned, upserted, skipped_no_key }`.

Notes
- People upserts are strictly additive: fields are written only when a non-empty source value exists; no field is ever nulled by this function.
- Messaging/classification flows (`reply-webhook`, `classify-reply`, `send-agent-reply`) are untouched per spec.

