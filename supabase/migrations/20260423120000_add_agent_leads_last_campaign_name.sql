-- Stores the HeyReach campaign name the lead was most recently added to via
-- add-to-heyreach-campaign. Read by LeadDetailPanel's Campaign History
-- section to show "Currently in campaign: <name>" for leads with
-- pipeline_stage = 'in_progress'.
ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS last_campaign_name TEXT;
