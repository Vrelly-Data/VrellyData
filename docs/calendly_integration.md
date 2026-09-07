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

Webhook (instant)

- Edge Function: `calendly-webhook` (public; JWT disabled).
- Purpose: receive `invitee.created` (booked) and `invitee.canceled` events in real time. Writes into `public.calendly_events` with `source='webhook'` and best‑effort `inference_events(meeting_booked)` when matched to an existing person (email).
- Registration (per Calendly connection / integration):
  1) Choose the callback URL shape (either is accepted):
     - Easiest: `https://<SUPABASE_URL>/functions/v1/calendly-webhook?integration_id=<OUTBOUND_INTEGRATIONS_ID>`
     - Preferred when available: `https://<SUPABASE_URL>/functions/v1/calendly-webhook?t=<OUTBOUND_INTEGRATIONS.WEBHOOK_SECRET>`
       - Use the per‑integration `webhook_secret` token as a routing key. If it’s empty, generate one and store it on the integration.
  2) (Optional) Add a shared gate secret: append `&secret=<CALENDLY_WEBHOOK_SECRET>`, and set `CALENDLY_WEBHOOK_SECRET` in the Edge Function environment. Requests without the correct secret will be 401.
  3) Subscribe to events: `invitee.created` and `invitee.canceled` (Calendly sometimes uses `invitee_canceled` — both are accepted).
- Deploy notes:
  - Ensure `supabase/config.toml` contains:
    - `[functions.calendly-webhook]\nverify_jwt = false`
  - Deploy functions, then register webhooks in Calendly’s Webhooks UI or API with your chosen URL (prod and dev projects should point to their respective Supabase `.../functions/v1/calendly-webhook` endpoints).
- Security:
  - Endpoint requires no JWT. Use the optional `?secret=` gate and/or the per‑integration token `?t=` to prevent cross‑tenant routing.
  - Calendly’s signature header can be added later; today we rely on the URL gate + routing token.

Testing steps

1) Settings → Integrations → Add Integration → Calendly → paste a valid PAT → Test Connection → Connect.
2) After connect, an initial backfill runs (90 days). You can also click the Sync button on the Calendly row to re-run.
3) Open a person/lead with the same email as a recent booking. The Booking event appears in the conversation timeline.
4) Verify `public.calendly_events` rows exist for your team; `status` transitions to `completed` after `end_time` passes.

Notes

- Additive only: no writes to `agent_leads` or user inbox; `people` is never created or mutated by this path.
- Inference moat: only `meeting_booked` is written today; mapping for cancellations/no‑shows can be added later if useful.

