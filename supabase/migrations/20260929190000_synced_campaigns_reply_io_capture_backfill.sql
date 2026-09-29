-- Capture Scope: bring Reply.io under capture_enabled (PR #91 follow-up).
--
-- STATUS: NOT APPLIED to any environment. Needs Myall's OK before it runs.
--
-- ORDER: apply this migration BEFORE deploying the PR #91 functions
-- (reply-webhook, poll-reply-inbox, sync-reply-contacts). Those functions
-- enforce capture_enabled fail-closed on Reply.io. Stage 1
-- (20260822020000) deliberately left every reply_io row at the column default
-- (false) because no Reply.io code read the column. Deploying #91 without this
-- backfill would therefore drop Reply.io capture to zero for every client.
--
-- WHAT IT DOES
--   Sets capture_enabled = true on every existing reply_io row, preserving
--   today's behaviour (every Reply.io campaign captures), exactly as Stage 1
--   did for Smartlead + HeyReach. Curation then happens in the Capture Scope
--   UI, which now supports Reply.io.
--   New Reply.io campaigns created after this runs get the column default
--   (false), the same as Smartlead and HeyReach: fetch-available-campaigns and
--   sync-reply-campaigns never write capture_enabled, so existing values are
--   preserved and new rows start not captured until toggled on.
--   is_linked (Data Analysis / reporting scope) is not touched.
--
-- GUARDED TO FIRST APPLICATION ONLY (same standard as Stage 1): re-running this
-- file must be a true no-op. Without the guard a replay would flip every
-- reply_io row back to true and silently wipe whatever was curated in the
-- Capture Scope UI. Idempotent-in-final-state is not sufficient. The guard is a
-- marker in the column comment, written in the same transaction as the update.
DO $migration$
DECLARE
  marker   constant text := 'capture-scope:reply_io-backfill-20260929';
  existing text;
  flipped  bigint;
BEGIN
  SELECT col_description('public.synced_campaigns'::regclass, a.attnum)
    INTO existing
    FROM pg_attribute a
   WHERE a.attrelid = 'public.synced_campaigns'::regclass
     AND a.attname  = 'capture_enabled'
     AND NOT a.attisdropped;

  IF existing IS NOT NULL AND position(marker IN existing) > 0 THEN
    RAISE NOTICE 'reply_io capture backfill already applied (marker present) - no-op';
    RETURN;
  END IF;

  UPDATE public.synced_campaigns
     SET capture_enabled = true
   WHERE source = 'reply_io'
     AND capture_enabled IS DISTINCT FROM true;
  GET DIAGNOSTICS flipped = ROW_COUNT;
  RAISE NOTICE 'reply_io capture backfill: % row(s) set capture_enabled = true', flipped;

  EXECUTE format(
    'COMMENT ON COLUMN public.synced_campaigns.capture_enabled IS %L',
    'Capture Scope: whether replies from this campaign are captured into agent_leads. '
      || 'Enforced fail-closed on every platform (Smartlead, HeyReach, Reply.io). '
      || 'New campaigns default to false until enabled in the Capture Scope UI. '
      || 'NOT is_linked (Data Analysis / reporting scope). '
      || 'Queries should still be scoped by source or integration_id. [' || marker || ']'
  );
END
$migration$;
