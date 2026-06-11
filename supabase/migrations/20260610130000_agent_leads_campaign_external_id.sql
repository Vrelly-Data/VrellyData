-- Add HeyReach/LinkedIn campaign attribution to agent_leads.
--
-- agent_leads already has smartlead_campaign_id (populated by
-- smartlead-webhook on the email side). The HeyReach/LinkedIn side has had
-- no such column — heyreach-webhook computes campaignExternalId from the
-- inbound payload (~line 196) and writes it into webhook_events, but the
-- agent_leads upsert object never included it. This migration adds the
-- parallel column for LinkedIn leads; the webhook is updated in the same
-- PR to write to it (with a null-clobber guard via conditional spread, so
-- a later reply with no campaignId doesn't blank out an existing
-- attribution).
--
-- Why a SEPARATE column rather than reusing one symbol-named column for
-- both channels:
--   * smartlead_campaign_id is the Smartlead-native id (already populated
--     historically; rename would force a backfill cascade across other
--     consumers of that field).
--   * Keeping it parallel mirrors how heyreach_account_id sits beside
--     smartlead-specific fields — same convention.
--
-- Existing rows: campaign_external_id is NULL by default. A standalone
-- backfill script (NOT in migrations) joins through webhook_events to
-- retroactively attribute historical LinkedIn leads where the attribution
-- is unambiguous: backfill_agent_leads_campaign_attribution.sql at the
-- repo root.

ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS campaign_external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_leads_campaign_external_id
  ON public.agent_leads(campaign_external_id);
