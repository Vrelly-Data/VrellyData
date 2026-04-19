-- Distinguish campaign replies from cold inbound leads.
-- Webhook / polling layers categorize each new lead on insert; existing rows
-- stay NULL and can be classified later via a backfill or UI review.

ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS lead_category TEXT
    CHECK (lead_category IS NULL OR lead_category IN ('campaign_reply', 'inbound_lead'));

CREATE INDEX IF NOT EXISTS idx_agent_leads_user_category
  ON public.agent_leads(user_id, lead_category);
