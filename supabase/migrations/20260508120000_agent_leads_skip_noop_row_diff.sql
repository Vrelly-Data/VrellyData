-- Replace the field-by-field diff in agent_leads_skip_noop with a row-level
-- diff. Background:
--
-- The original trigger (20260412_create_agent_leads.sql) cancelled any
-- UPDATE where last_reply_text was unchanged. Three follow-up migrations
-- (20260413, 20260427120000, 20260429120000) widened the AND-chain to
-- include the columns the webhooks happen to write, but each new feature
-- (notes, pipeline_stage tag dropdown, reply_thread sender appends, etc.)
-- has to be remembered and added to the chain — and pipeline_stage / notes
-- / draft_response / intent were never added, so panel-driven UPDATEs
-- against those columns silently RETURN NULL'd, looked like success to
-- PostgREST, and disappeared on the next refetch.
--
-- The trigger's actual purpose is "suppress webhook replays where every
-- column is identical" — a row-level equality check expresses that
-- directly without enumerating columns:
--
--   IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
--
-- `IS NOT DISTINCT FROM` between row values applies value-equality field
-- by field (NULL = NULL, jsonb compared by value), so genuine no-op
-- payload replays still suppress, while any real change — including
-- future columns added without a migration to this trigger — passes.

CREATE OR REPLACE FUNCTION public.agent_leads_skip_noop()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;
