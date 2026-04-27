-- Drop NOT NULL on webhook_events.integration_id and webhook_events.team_id.
--
-- Why: smartlead-webhook intentionally inserts an audit-log row BEFORE
-- resolving which outbound_integration / team the payload belongs to. The
-- Smartlead payload doesn't expose an integration identifier, so we want the
-- raw event captured even when routing later fails (e.g. no active
-- integration). The existing NOT NULL constraints made those audit inserts
-- silently fail. heyreach-webhook and reply-webhook always resolve a non-null
-- integration_id/team_id before inserting, so this change does NOT loosen
-- their behavior.
--
-- Safety:
--   * FK on integration_id is unchanged (NULL is permitted by the FK; only
--     non-null values must reference an existing integration).
--   * RLS policy "Users can view team webhook events" filters on
--     team_id = get_user_team_id(auth.uid()). NULL = NULL evaluates to UNKNOWN
--     (treated as false), so rows with NULL team_id remain invisible to
--     non-service-role readers.
--   * Service role inserts are unaffected.

ALTER TABLE public.webhook_events
  ALTER COLUMN integration_id DROP NOT NULL,
  ALTER COLUMN team_id DROP NOT NULL;

COMMENT ON COLUMN public.webhook_events.integration_id IS
  'Outbound integration this event belongs to. May be NULL for raw audit-log inserts where the integration could not yet be resolved (e.g. Smartlead webhooks that need post-parse routing).';

COMMENT ON COLUMN public.webhook_events.team_id IS
  'Team this event belongs to. May be NULL for raw audit-log inserts where the team could not yet be resolved. RLS hides NULL-team rows from non-service-role readers.';
