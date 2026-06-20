-- Positive source identifier on agent_leads.
--
-- Background: the agent inbox dispatches sends based on the lead's source
-- platform (HeyReach → send-heyreach-message, Smartlead → send-smartlead-email,
-- Reply.io → send-agent-reply). Until now the platform was inferred at the UI
-- layer from the presence/absence of platform-specific identifier columns
-- (heyreach_conversation_id / heyreach_account_id / smartlead_lead_id /
-- otherwise-Reply.io). This works in normal operation but has an edge case:
-- a malformed HeyReach webhook payload could produce a row with both HR
-- identifier columns NULL → inference defaults to Reply.io → dual-platform
-- customer could silently cross-contaminate. See the Step 3a diagnosis arc.
--
-- This migration adds a nullable TEXT column. Allowed values written by the
-- platform-specific writers going forward:
--   'heyreach'   — written by heyreach-webhook + poll-heyreach-inbox
--   'smartlead'  — written by smartlead-webhook
--   'reply_io'   — written by reply-webhook (both legacy + primary paths),
--                   poll-reply-inbox, sync-reply-contacts (both upsert sites)
--   NULL         — pre-migration rows that escape the inference backfill
--                   below (shouldn't happen in normal operation; safe fail
--                   case — UI falls back to the legacy column-presence
--                   inference for NULLs)
--
-- Backfill priority (HR > SL > else=Reply.io) matches the write-time
-- semantics catalogued in the diagnosis:
--   HeyReach writes always set heyreach_conversation_id and/or
--   heyreach_account_id (whichever the payload includes).
--   Smartlead writes set smartlead_lead_id.
--   Reply.io writes set neither — they're the residual.
--
-- The three UPDATEs are guarded on `source IS NULL` so re-applying the
-- migration is a no-op after the first run. The ALTER uses IF NOT EXISTS
-- for the same reason. Dev has 0 rows in agent_leads at migration time;
-- backfill is a no-op there but will run correctly on prod when applied.

ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE public.agent_leads
   SET source = 'heyreach'
 WHERE source IS NULL
   AND (heyreach_conversation_id IS NOT NULL OR heyreach_account_id IS NOT NULL);

UPDATE public.agent_leads
   SET source = 'smartlead'
 WHERE source IS NULL
   AND smartlead_lead_id IS NOT NULL;

UPDATE public.agent_leads
   SET source = 'reply_io'
 WHERE source IS NULL;
