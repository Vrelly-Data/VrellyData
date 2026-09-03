### PhoneBurner Dialer (MVP)

This PR adds PhoneBurner as a first-class Dialer integration. It is fully additive — no changes to `agent_leads`, `people`, or `synced_contacts`. Inbox is NOT populated at connect time.

What’s included:
- Connect via Data Playground → Connect Platform → PhoneBurner / Dialer (Personal Access Token)
- Key validation edge function: `validate-phoneburner-key` (Bearer PAT → `GET /rest/1/members`)
- Contacts watermark sync: `sync-phoneburner-contacts` → `public.phoneburner_contacts`
- Call polling: `poll-phoneburner-calls` → `public.dialer_events` (+ best‑effort `inference_events`)
- Minimal UI: a Calls panel on People → each contact row has a Calls button to view `dialer_events`
- pg_cron schedule: poll PhoneBurner calls every 30 minutes (templated from the Reply.io job)

New additive tables:
- `public.phoneburner_contacts`: (integration_id, team_id, pb_contact_id, email, full_name, raw_phone, phone_e164, person_key, pb_updated_at, raw)
- `public.dialer_events`: (integration_id, team_id, person_key, pb_contact_id, phone_e164, call_id, disposition, connected, voicemail, duration_seconds, note, dialsession_id, occurred_at, source, recording_url, raw)

RLS:
- Service role can write; team members can read their team’s rows (mirrors `inference_events`)

How to connect:
1) Go to Data Playground → Connect Platform → PhoneBurner / Dialer
2) Paste your PhoneBurner Personal Access Token (Bearer) and click Test Connection
3) Click Connect
4) On connect, the app performs a contacts sync and a recent calls poll (last 2 days)

Sync & matching:
- Contacts are fetched incrementally with `updated_from` and stored in `phoneburner_contacts`
- `person_key` is `lower(email)` when available
- Since PhoneBurner has no phone search, we sync contacts locally and match calls by normalized E.164 phone against `phoneburner_contacts.phone_e164`
- The inbox is never pre-filled from PhoneBurner; no `agent_leads` writes

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

Security:
- API tokens are never logged; validators and pollers redact secrets
- RLS mirrors `inference_events` (service‑role writes; team read)

Inbox safety:
- Connect‑time does NOT dump contacts into `agent_leads`
- The Calls UI is read‑only and scoped by `person_key`/email

