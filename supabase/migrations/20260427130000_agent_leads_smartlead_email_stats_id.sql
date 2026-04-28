-- Add agent_leads.smartlead_email_stats_id and extend the noop trigger to
-- include it.
--
-- Why: Smartlead's POST /campaigns/{id}/reply-email-thread requires a
-- field named `email_stats_id` that's not documented but IS validated.
-- The value travels in the EMAIL_REPLY webhook payload as `stats_id`
-- (top-level). Without persisting it on agent_leads, send-smartlead-email
-- has nothing to forward and Smartlead 400s.
--
-- Naming: column prefix `smartlead_` matches our existing convention
-- (smartlead_lead_id / smartlead_campaign_id / reply_message_id);
-- `email_stats_id` mirrors the upstream API field name verbatim.
--
-- Noop trigger: add the new column to the IS NOT DISTINCT FROM chain
-- so a brand-new stats_id on an otherwise-unchanged lead row still
-- counts as a meaningful update. Same rationale as the prior
-- 20260427120000 migration that added the other Smartlead columns.

ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS smartlead_email_stats_id TEXT;

CREATE OR REPLACE FUNCTION public.agent_leads_skip_noop()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.last_reply_text   IS NOT DISTINCT FROM OLD.last_reply_text
     AND NEW.inbox_status  IS NOT DISTINCT FROM OLD.inbox_status
     AND NEW.draft_approved IS NOT DISTINCT FROM OLD.draft_approved
     AND NEW.full_name     IS NOT DISTINCT FROM OLD.full_name
     AND NEW.email         IS NOT DISTINCT FROM OLD.email
     AND NEW.channel       IS NOT DISTINCT FROM OLD.channel
     AND NEW.heyreach_conversation_id IS NOT DISTINCT FROM OLD.heyreach_conversation_id
     AND NEW.heyreach_account_id      IS NOT DISTINCT FROM OLD.heyreach_account_id
     AND NEW.linkedin_url  IS NOT DISTINCT FROM OLD.linkedin_url
     AND NEW.smartlead_lead_id      IS NOT DISTINCT FROM OLD.smartlead_lead_id
     AND NEW.smartlead_campaign_id  IS NOT DISTINCT FROM OLD.smartlead_campaign_id
     AND NEW.reply_message_id       IS NOT DISTINCT FROM OLD.reply_message_id
     AND NEW.last_reply_raw_html    IS NOT DISTINCT FROM OLD.last_reply_raw_html
     AND NEW.last_reply_at          IS NOT DISTINCT FROM OLD.last_reply_at
     -- Added 2026-04-27: Smartlead email_stats_id (required by reply-email-thread API)
     AND NEW.smartlead_email_stats_id IS NOT DISTINCT FROM OLD.smartlead_email_stats_id
  THEN
    RETURN NULL; -- cancel truly no-op updates
  END IF;
  RETURN NEW;
END;
$function$;
