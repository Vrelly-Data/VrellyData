-- Extend agent_leads_skip_noop trigger to include the Phase A Smartlead
-- columns. Without this, the trigger's AND-chain treated all-Smartlead
-- updates as no-ops because none of the Smartlead-specific fields were
-- compared, causing the upsert in smartlead-webhook to silently abort
-- (RETURN NULL) and the .select().single() chain to surface PGRST116.
--
-- For HeyReach, heyreach_conversation_id changes per message so the
-- existing chain already let real updates through. For Smartlead, the
-- equivalent per-message identifier is reply_message_id; including it
-- (along with the other captured Smartlead state) closes the gap.
--
-- last_reply_at is included for safety: smartlead-webhook stores the
-- payload-derived reply_message.time, which means true idempotent
-- replays of the *exact same* Smartlead payload still match here and
-- still get suppressed (correct behaviour). For HeyReach, last_reply_at
-- is server-generated on every webhook call, so this row will never
-- match between consecutive deliveries — i.e. HeyReach's no-op
-- suppression now effectively only catches updates where every other
-- listed field is unchanged AND the prior timestamp coincidentally
-- matches, which in practice means HeyReach's noop skip rarely fires.
-- That's a minor efficiency loss (extra updated_at trigger fires +
-- realtime emissions on duplicate webhooks) with no correctness impact.

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
     -- Phase A Smartlead columns: required for Smartlead webhook updates to land
     AND NEW.smartlead_lead_id      IS NOT DISTINCT FROM OLD.smartlead_lead_id
     AND NEW.smartlead_campaign_id  IS NOT DISTINCT FROM OLD.smartlead_campaign_id
     AND NEW.reply_message_id       IS NOT DISTINCT FROM OLD.reply_message_id
     AND NEW.last_reply_raw_html    IS NOT DISTINCT FROM OLD.last_reply_raw_html
     AND NEW.last_reply_at          IS NOT DISTINCT FROM OLD.last_reply_at
  THEN
    RETURN NULL; -- cancel truly no-op updates
  END IF;
  RETURN NEW;
END;
$function$;
