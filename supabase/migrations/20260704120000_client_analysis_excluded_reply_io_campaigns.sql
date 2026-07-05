-- Per-client EXCLUDE list of Reply.io campaigns hidden from the client's
-- shared Performance Report. Keyed by synced_campaigns.external_campaign_id.
-- EXCLUDE (not INCLUDE) so campaigns synced later default to SHOWN — a brand
-- new reply_io campaign is included until an admin explicitly unchecks it in
-- the "Edit campaigns" modal. Does NOT reuse is_linked (that's global sync
-- state, not per-client display scope).
--
-- Consumed by generate-client-analysis (filters replyIoInScope) and written
-- by NewClientAnalysisDialog. Run in dev then prod; follow with
--   NOTIFY pgrst, 'reload schema';
-- in the same Studio env so PostgREST picks up the new column.
ALTER TABLE client_analysis
  ADD COLUMN IF NOT EXISTS excluded_reply_io_campaign_ids text[] DEFAULT '{}';
