
-- Add unique constraint to prevent duplicate campaigns within the same team
ALTER TABLE public.synced_campaigns 
ADD CONSTRAINT synced_campaigns_team_external_unique 
UNIQUE (team_id, external_campaign_id);
