## Inference Analytics Foundation

This change introduces additive analytics primitives without mutating existing behavior or schemas:

- Normalized metadata on events for provider and thread/message identifiers
- Best-effort `sent` writes across send paths (HeyReach/Smartlead), with stable copy fingerprints
- Language hints on replies (conservative, deterministic heuristic)
- SQL views for common questions and latency pairing
- Lightweight tests and published guardrails to prevent misleading reads

### Normalized metadata keys

All newly written events now include, when available:

- `metadata.provider`: `"reply_io" | "heyreach" | "smartlead"`
- `metadata.provider_thread_id`: provider’s thread/conversation identifier
- `metadata.provider_message_id`: provider’s per-message identifier (if provided)
- `metadata.outbound_message`: exact outbound body for `sent` events (where available)
- `metadata.reply_language_code`: `"en" | "es" | null"` and `metadata.reply_language_method`: `"heuristic_v1"`

Previous provider-specific keys are preserved for back-compat (e.g., `conversation_id`, `thread_id`, `external_message_id`, `mail_sender`).

### Subject and sequence step type

- `sequence_step_type` is captured for `sent` based on the true channel:
  - LinkedIn → `linkedin_message`
  - Email → `email`
- `subject` remains null unless a provider truly exposes it at send time. We do not fabricate subjects. Reply.io inbox threads expose a subject on replies; this is recorded in `metadata.subject` on reply events (for analysis only), leaving the `subject` column null on `sent` rows.

### Views (all security_invoker; RLS applies)

- `inference_send_counts_utc` — Send counts by weekday/hour (UTC), grouped by `team_id`, `channel`, `provider`
- `inference_send_counts_pr` — Same, localized to `America/Puerto_Rico`
- `inference_reply_latency` — Pairs each `replied` event with the nearest preceding `sent` event (prefers exact `provider_thread_id` match; otherwise falls back to person-key without fabricating matches)
- `inference_copy_outcome_by_segments` — Outcome rollups over `classified` events by `copy_fingerprint`, optional `subject`, `industry`, `job_title`, `seniority`, `campaign_name`, `intent`
- `inference_reply_language_by_copy` — Reply language distribution by `industry`, `copy_fingerprint`, and `channel` (pairs replies to nearest preceding send)

See `supabase/migrations/20260903160000_inference_analytics_views.sql`.

### Language detection

- Implemented as a small, deterministic heuristic (`_shared/language.ts`), intended as a conservative signal:
  - Spanish if ≥2 distinct markers/diacritics present
  - English if ≥2 distinct English markers
  - Otherwise `null`
- Stored only in `metadata.reply_language_code` and `metadata.reply_language_method`; no schema column added.
- Non-blocking: failures or uncertainty write `null`.

### Tests

- `verify_copy_fingerprint.mjs`: existing stability checks
- `test_inference_analytics.mjs`: exercises copy fingerprint normalization, UTC bucketing, and nearest-preceding send pairing logic (no DB)

### Sample-size guardrails (UI contracts)

To prevent surfacing tiny samples as truth, the UI should enforce minimums:

- Send-performance by hour/weekday: do not render a bucket with `n < 30` sends (team-scope)
- Copy/subject outcome segmentation: do not render segments with `n < 25` classified events; show “insufficient data”
- Reply language by copy: do not render language splits with `n < 20` replies per (industry, copy_fingerprint, channel)
- Reply latency: when pairing coverage (replies with a matched prior send) is `< 70%` over the selected window, annotate charts as “incomplete pairing”

These thresholds are intentionally conservative; adjust per product acceptance once real volumes are observed.

### Known limitations

- Reply.io send subjects are not available at send time through current paths; left null by design
- Smartlead reply-email send returns no per-message id; we record `email_stats_id` as the thread key and leave `provider_message_id` null
- HeyReach send returns no per-message id; conversation id is recorded as thread key
- Language detection is heuristic and intentionally low-confidence; when in doubt, it yields `null`

