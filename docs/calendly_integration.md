Calendly integration (MVP)

- Connect path: Personal Access Token (PAT) entered in Settings → Integrations → Add Integration → Calendly.
- Sync path: Supabase Edge Function `sync-calendly-events` polls recent events and upserts into `public.calendly_events`. Best‑effort writes `meeting_booked` rows to `public.inference_events` when matched to an existing person.
- Matching: email-first against `public.people` (team-scoped). MATCH-ONLY — no new people/leads are created.
- UI: Bookings surface inline on the lead thread timeline when an email match exists (scheduled/canceled/completed).

Secrets / configuration

- No platform secrets required for the MVP PAT flow.
- Operator provides their Calendly PAT in-app. Validation is via `validate-calendly-key` (GET `https://api.calendly.com/users/me`).

Optional OAuth (not required for MVP)

- If you prefer OAuth over PAT, provision the following on the `sync-calendly-events` and future callback function:
  - CALENDLY_CLIENT_ID=<set in Supabase Edge Function env>
  - CALENDLY_CLIENT_SECRET=<set in Supabase Edge Function env>
  - CALENDLY_REDIRECT_URI=<https://<your-domain>/functions/v1/calendly-oauth-callback>
  - CALENDLY_WEBHOOK_SIGNING_KEY=<optional, if adding webhooks later>
- Notes:
  - This PR ships PAT-based connect. OAuth can be added by introducing an `calendly-oauth-callback` Edge Function that exchanges the `code` for tokens and writes them to the integration (JSON in `api_key_encrypted` or a small `integration_tokens` table), and by wiring a “Connect with Calendly” button in place of the API key field.
  - Webhooks are optional; polling is sufficient for MVP. If/when added, keep writes additive-only and verify signatures with the signing key.

Tables / migrations

- `public.calendly_events` (new): additive booking outcomes, RLS mirrors `dialer_events`/`inference_events`.
  - Columns: integration_id, team_id, person_key (nullable), email, scheduled_event_uuid, invitee_uuid, event_name, status ('scheduled'|'canceled'|'completed'), start_time, end_time, source ('poll'|'webhook'|'callback'), raw.
  - Unique: (integration_id, invitee_uuid). Indexed on (team_id, start_time), person_key, email, integration_id.

Edge Functions

- `validate-calendly-key`: PAT validation (users/me).
- `sync-calendly-events`: Polls `scheduled_events` + per-event `invitees`, normalizes status, matches to people by email, upserts into `calendly_events`, and best‑effort writes `inference_events (meeting_booked)` when matched.

Testing steps

1) Settings → Integrations → Add Integration → Calendly → paste a valid PAT → Test Connection → Connect.
2) After connect, an initial backfill runs (90 days). You can also click the Sync button on the Calendly row to re-run.
3) Open a person/lead with the same email as a recent booking. The Booking event appears in the conversation timeline.
4) Verify `public.calendly_events` rows exist for your team; `status` transitions to `completed` after `end_time` passes.

Notes

- Additive only: no writes to `agent_leads` or user inbox; `people` is never created or mutated by this path.
- Inference moat: only `meeting_booked` is written today; mapping for cancellations/no‑shows can be added later if useful.

