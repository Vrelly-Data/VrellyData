-- Fix: the old trigger blocked updates where only inbox_status or draft_approved changed
-- (it cancelled any update where last_reply_text was unchanged).
-- New version only skips when ALL mutable fields are unchanged.
CREATE OR REPLACE FUNCTION public.agent_leads_skip_noop()
RETURNS TRIGGER AS $$
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
  THEN
    RETURN NULL; -- cancel truly no-op updates
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
