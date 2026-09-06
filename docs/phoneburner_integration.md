### PhoneBurner Dialer (MVP)

This PR adds PhoneBurner as a first-class Dialer integration. It is fully additive — no changes to `agent_leads`, `people`, or `synced_contacts`. Inbox is NOT populated at connect time.

What’s included:
- Connect via Data Playground → Connect Platform → PhoneBurner / Dialer (Personal Access Token)
- Key validation edge function: `validate-phoneburner-key` (Bearer PAT → `GET /rest/1/members`)
- Call polling as the primary path: `poll-phoneburner-calls` → `public.dialer_events` (+ best‑effort `inference_events`)
- Minimal UI: a Calls panel on People → each contact row has a Calls button to view `dialer_events`
- pg_cron schedule: poll PhoneBurner calls every 30 minutes (templated from the Reply.io job)
- Cron invokes the poller without an `integrationId`; with a valid internal `x-agent-key`, it iterates all PhoneBurner integrations.

Tables:
- `public.dialer_events`: (integration_id, team_id, person_key, pb_contact_id, phone_e164, call_id, disposition, connected, voicemail, duration_seconds, note, dialsession_id, occurred_at, source, recording_url, raw)
  - person_key is set only when the call matches an existing person/lead (match‑only)

RLS:
- Service role can write; team members can read their team’s rows (mirrors `inference_events`)

How to connect:
1) Go to Data Playground → Connect Platform → PhoneBurner / Dialer
2) Paste your PhoneBurner Personal Access Token (Bearer) and click Test Connection
3) Click Connect
4) On connect, the app backfills recent calls for the last 90 days (match‑only)

Sync & matching:
- Calls are fetched by dial session window, then detailed to per‑call rows.
- MATCH‑ONLY: we attach `person_key` only when the call matches an existing person on the team. Match order (high → low confidence):
  1) Email — team‑scoped exact match on `people.email`.
  2) LinkedIn URL — normalized (lowercased, no query/fragment/trailing slash; protocol/www unified). First match `people.linkedin_url` (team‑scoped). If no hit, use `synced_contacts.linkedin_url` or team‑scoped `agent_leads.linkedin_url` to obtain an email, then only attach when that email exists in `people`.
  3) Phone — normalized: prefer team‑scoped `synced_contacts.phone` (digits substring → E.164 normalization) to get an email and verify in `people`; if still unmatched, fall back to `phoneburner_contacts.phone_e164` and set `person_key` only if that `person_key` already exists in `people` for the team.
  4) Company (WEAK) — only attach when (a) PB provides a company AND a person name and there’s an exact `people` match on both `company_name` + `full_name`, OR (b) the team has exactly one `people` row with that `company_name`. Ambiguous (0 or 2+) → leave `person_key` null.
- Strictly match‑only: no `people`, `agent_leads`, or other records are created by the poller.
- The inbox is never pre‑filled from PhoneBurner; no `agent_leads` writes.

Calls & dispositions:
- Calls are fetched via `GET /rest/1/dialsession` (window) then `GET /rest/1/dialsession/{id}`
- Stored in `dialer_events` only (additive)
- Best‑effort `inference_events` mapping (teachable outcomes only):
  - “Appointment Scheduled” (any of: appointment/appt/meeting/booked/scheduled) → `meeting_booked`
  - “Not Interested” (any of: not interested/no interest/not a fit/no fit/no thanks) → `classified` + `intent=not_interested`
  - “DNC” (do not call) → `opted_out`
  - No Answer / Busy / Left Message → dialer_events ONLY (no inference spam)
- Channel is recorded as `other` with `sequence_step_type='call'` (no CHECK-widen shipped here)

Provider response shapes:
- The official list endpoint returns an object: `{ dialsessions: { page, total_results, dialsessions: [ { dialsession_id, ... } ] } }`.
- The list is paginated (`page=N`); the poller loops pages until all results in the window are collected (bounded to a sane max pages to avoid provider abuse). If truncated by the cap, a warning is logged.
- The poller now reads `dialsessions.dialsessions` first, with defensive fallbacks for prior shapes.
- Session identifiers are taken from `dialsession_id` when present (fallback `id`).
- Session detail calls are read from any of: `dialsessions.dialsessions[].calls`, `dialsession.calls`, or top‑level `calls`.

Timezones:
- PhoneBurner times are US Central. The poller sends `date_start`/`date_end` as Central calendar dates (`YYYY-MM-DD`) to the list endpoint for safer provider matching. Individual call timestamps are still stored as precise UTC ISO strings.

Limitations / notes:
- No OAuth app setup — PAT (Bearer) only
- No click‑to‑dial or outbound POST
- No recordings/transcripts processing; `recording_url` is stored when present
- Disposition labels are customizable in PhoneBurner; mapping uses case‑insensitive includes with a conservative default
- Poll‑first delivery — webhooks are dashboard‑paste only; add the URL later
- Full contact‑book sync is intentionally not part of the product path. The legacy `sync-phoneburner-contacts` function and draft PR #20 (batch contact upserts) are superseded by dial/session sync and should not be merged.

Security:
- API tokens are never logged; validators and pollers redact secrets
- RLS mirrors `inference_events` (service‑role writes; team read)
- Cron auth header: `x-agent-key` is sourced from Vault `agent_api_key` (matches Edge `AGENT_API_KEY`)

Inbox safety:
- Connect‑time does NOT dump contacts into `agent_leads`
- The Calls UI is read‑only and scoped by `person_key`/email

