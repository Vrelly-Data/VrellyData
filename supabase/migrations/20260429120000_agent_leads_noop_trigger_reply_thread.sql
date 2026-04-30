-- Extend agent_leads_skip_noop to recognise reply_thread changes.
--
-- Background: heyreach-webhook and smartlead-webhook now run a secondary
-- UPDATE after their upsert to overwrite reply_thread with the full
-- conversation history fetched from the source platform's API. That
-- secondary UPDATE touches *only* reply_thread — every other field is
-- identical to what the upsert just wrote.
--
-- Without reply_thread in the diff list, the trigger's AND chain evaluates
-- to TRUE for that secondary UPDATE (every listed field unchanged) and
-- returns NULL, silently dropping the write. The lead's reply_thread
-- stays at the partial single-message state captured by the webhook
-- payload, which was the original bug ("Andrew Solano shows 1 message
-- when HeyReach has 4+").
--
-- Adding reply_thread to the chain means: when only reply_thread differs,
-- the AND evaluates to FALSE, the trigger returns NEW, and the UPDATE
-- lands. jsonb's IS NOT DISTINCT FROM does value-equality, so genuine
-- idempotent replays of the *same* full thread still get suppressed.

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
     -- Full-thread sync: required so the secondary UPDATE in
     -- heyreach-webhook / smartlead-webhook (which overwrites reply_thread
     -- with the platform's full conversation history) is not suppressed.
     AND NEW.reply_thread           IS NOT DISTINCT FROM OLD.reply_thread
  THEN
    RETURN NULL; -- cancel truly no-op updates
  END IF;
  RETURN NEW;
END;
$function$;
