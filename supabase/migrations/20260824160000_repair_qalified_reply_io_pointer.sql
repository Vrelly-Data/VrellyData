-- Repair QAlified's Reply.io pointer, blanked by an ON DELETE SET NULL.
--
-- WHAT HAPPENED. AgentSettings/AgentOnboarding sent platform:'reply_io' to
-- validate-api-key, which tests platform = 'reply.io'. The underscore missed,
-- fell through to the no-validator branch, and reported a valid key as invalid
-- (fixed in code, commit 077bca6). The operator concluded the key was broken,
-- deleted the integration and re-added it. client_analysis.reply_io_integration_id
-- is declared ON DELETE SET NULL (migration 20260619120000), so the delete
-- silently blanked the pointer. generate-client-analysis short-circuits to an
-- empty scope when that column is NULL, so every weekly figure read zero with
-- no error raised anywhere.
--
-- The replacement integration synced perfectly — 2 linked campaigns, 105
-- synced_contacts — it was simply orphaned: no client_analysis row referenced
-- it. Repointing restored real figures immediately (103 LinkedIn sent, 105
-- connections sent, 6 accepted).
--
-- WHY THIS IS A DATA MIGRATION AND NOT A BACKFILL. It repairs exactly one row,
-- identified by primary key. There is no rule to generalise: every other client
-- either has a pointer that resolves or has legitimately never been onboarded.
-- A blanket "repoint clients at their user's active reply.io integration" would
-- be wrong — Axion Cred has no integration at all, SourceCo is Smartlead +
-- HeyReach, and the Top Talent archive row is intentionally unlinked.
--
-- ALREADY APPLIED TO PROD by hand on 2026-08-24, before this file existed. This
-- migration exists so the repair replays if prod is ever rebuilt from
-- migrations. Against current prod it is a deliberate no-op.
--
-- IDEMPOTENT AND SAFE TO RE-RUN. Three guards, all of which must hold:
--   1. the client row exists AND its pointer is still NULL — so a good value,
--      including one set later through the picker, is never overwritten;
--   2. the integration row exists — on a rebuilt database it may not, and the
--      FK would otherwise abort the whole migration;
--   3. the integration is owned by the same user and is a reply.io row — the
--      same preconditions the manual repair asserted.
-- If any guard fails the statement matches zero rows and the migration passes.

DO $$
DECLARE
  v_client_id      CONSTANT UUID := '9b9cb667-8da1-4985-8296-335d65419751'; -- QAlified
  v_integration_id CONSTANT UUID := 'a6f27225-24e1-4791-ba03-6bf9313066e6'; -- Qalified<>Vrelly
  v_updated        INTEGER := 0;
  v_current        UUID;
BEGIN
  -- Nothing to do if either side is absent (fresh/partial database).
  IF NOT EXISTS (SELECT 1 FROM public.client_analysis WHERE id = v_client_id) THEN
    RAISE NOTICE 'repair_qalified_pointer: client % not present — skipping', v_client_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.outbound_integrations
     WHERE id = v_integration_id
       AND platform = 'reply.io'
  ) THEN
    RAISE NOTICE 'repair_qalified_pointer: integration % not present — skipping', v_integration_id;
    RETURN;
  END IF;

  SELECT reply_io_integration_id INTO v_current
    FROM public.client_analysis WHERE id = v_client_id;

  IF v_current IS NOT NULL THEN
    RAISE NOTICE 'repair_qalified_pointer: pointer already set to % — no-op', v_current;
    RETURN;
  END IF;

  -- Ownership is re-asserted inside the UPDATE so this cannot point a client at
  -- another user's integration even if the ids above are ever edited.
  UPDATE public.client_analysis c
     SET reply_io_integration_id = v_integration_id
    FROM public.outbound_integrations i
   WHERE c.id = v_client_id
     AND c.reply_io_integration_id IS NULL
     AND i.id = v_integration_id
     AND i.created_by = c.user_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    RAISE NOTICE 'repair_qalified_pointer: repaired client % -> integration %', v_client_id, v_integration_id;
  ELSE
    RAISE NOTICE 'repair_qalified_pointer: 0 rows updated (ownership guard did not match) — no-op';
  END IF;
END $$;
