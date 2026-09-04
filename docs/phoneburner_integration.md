### PhoneBurner Dialer (MVP)

This PR adds PhoneBurner as a first-class Dialer integration. It is fully additive — no changes to `agent_leads`, `people`, or `synced_contacts`. Inbox is NOT populated at connect time.

What’s included:
- Connect via Data Playground → Connect Platform → PhoneBurner / Dialer (Personal Access Token)
- Key validation edge function: `validate-phoneburner-key` (Bearer PAT → `GET /rest/1/members`)
- Call polling as the primary path: `poll-phoneburner-calls` → `public.dialer_events` (+ best‑effort `inference_events`)
- Minimal UI: a Calls panel on People → each contact row has a Calls button to view `dialer_events`
- pg_cron schedule: poll PhoneBurner calls every 30 minutes (templated from the Reply.io job)

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
- Calls are fetched by dial session window, then detailed to per‑call rows
- `person_key` is set only when a dial matches an existing person on the integration’s team:
  - First by email (preferred): match `people.email` (team‑scoped) and set `person_key` to that row’s existing `person_key`
  - Otherwise by normalized phone (match‑only): prefer a team‑scoped match against `synced_contacts.phone` (digits substring → E.164 normalization), then use the candidate’s email only if a `people` row already exists for the team; if still unmatched, fall back to `phoneburner_contacts.phone_e164` and set `person_key` only if that `person_key` already exists in `people` for the team
- This is strictly match‑only: no `people`, `agent_leads`, or other records are created by the poller
- The inbox is never pre‑filled from PhoneBurner; no `agent_leads` writes

Calls & dispositions:
- Calls are fetched via `GET /rest/1/dialsession` (window) then `GET /rest/1/dialsession/{id}`
- Stored in `dialer_events` only (additive)
- Best‑effort `inference_events` mapping (teachable outcomes only):
  - “Appointment Scheduled” (any of: appointment/appt/meeting/booked/scheduled) → `meeting_booked`
  - “Not Interested” (any of: not interested/no interest/not a fit/no fit/no thanks) → `classified` + `intent=not_interested`
  - “DNC” (do not call) → `opted_out`
  - No Answer / Busy / Left Message → dialer_events ONLY (no inference spam)
- Channel is recorded as `other` with `sequence_step_type='call'` (no CHECK-widen shipped here)

Timezones:
- PhoneBurner times are US Central. The MVP uses UTC ISO strings; Central-localization can be added later if needed.

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

Inbox safety:
- Connect‑time does NOT dump contacts into `agent_leads`
- The Calls UI is read‑only and scoped by `person_key`/email

