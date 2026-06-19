-- Reply.io v3 integration — Step 1: schema only.
--
-- Two changes, both belt-and-suspenders narrow:
--
--   PART A. client_analysis.reply_io_integration_id (nullable FK)
--
--           A client_analysis row already carries platform-native selections
--           for HeyReach (heyreach_account_ids INTEGER[]) and Smartlead
--           (smartlead_campaign_ids TEXT[]). Reply.io is workspace-scoped:
--           one workspace ⇄ one API key ⇄ one outbound_integrations row,
--           and the workspace IS the scope — there's no per-campaign picker
--           equivalent the way HR/SL have account_ids / campaign_ids.
--
--           So the natural shape is a single FK to outbound_integrations,
--           not an array. Nullable + ON DELETE SET NULL — removing the
--           integration drops the link but leaves the analysis row intact
--           (matches the "soft" semantics of clearing heyreach_account_ids,
--           and avoids cascading a CASCADE delete the operator didn't ask
--           for).
--
--   PART B. outbound_integrations.reply_team_id partial unique index
--
--           reply_team_id is load-bearing for inbound webhook routing
--           (reply-webhook/index.ts:64 looks up the integration by
--           reply_team_id alone). If two rows share the same team_id, the
--           webhook handler's .single() lookup errors and we silently drop
--           inbound events for that workspace.
--
--           Today nothing in the code enforces this. AddIntegrationDialog
--           auto-detects the team_id from the API key (one workspace per
--           key) and EditIntegrationDialog lets the operator override it
--           by hand — both can collide. The partial unique index is the
--           backstop: the write fails fast at insert time, before any
--           webhook is misrouted.
--
--           Partial (WHERE reply_team_id IS NOT NULL AND platform = 'reply.io')
--           so HR/SL rows (which leave reply_team_id NULL) are unaffected,
--           and so future platforms that might reuse the column for an
--           unrelated purpose aren't accidentally constrained.
--
-- Both statements are idempotent (ADD COLUMN IF NOT EXISTS / CREATE UNIQUE
-- INDEX IF NOT EXISTS). No backfill, no data migration — column defaults
-- NULL and stays NULL until the operator links it in the UI (Step 3 work).
--
-- SAFETY NOTE for the operator: before applying, confirm no existing
-- duplicate reply_team_id values among platform='reply.io' rows would
-- block the unique index creation. Run:
--
--   SELECT reply_team_id, COUNT(*) AS n
--     FROM public.outbound_integrations
--    WHERE platform = 'reply.io' AND reply_team_id IS NOT NULL
--    GROUP BY reply_team_id
--   HAVING COUNT(*) > 1;
--
-- An empty result set means safe to apply. If any rows come back, resolve
-- the duplicate (delete the stale row, or set its reply_team_id to NULL)
-- BEFORE running this migration — otherwise the whole file rolls back.

-- =============================================================================
-- PART A — client_analysis.reply_io_integration_id
-- =============================================================================

ALTER TABLE public.client_analysis
  ADD COLUMN IF NOT EXISTS reply_io_integration_id UUID
    REFERENCES public.outbound_integrations(id) ON DELETE SET NULL;

-- =============================================================================
-- PART B — outbound_integrations(reply_team_id) partial unique index
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS outbound_integrations_reply_team_id_unique
  ON public.outbound_integrations(reply_team_id)
  WHERE reply_team_id IS NOT NULL AND platform = 'reply.io';
