-- Add is_linked column to synced_campaigns
ALTER TABLE synced_campaigns 
ADD COLUMN is_linked boolean NOT NULL DEFAULT false;

-- Add index for filtering linked campaigns
CREATE INDEX idx_synced_campaigns_is_linked 
ON synced_campaigns(team_id, is_linked) 
WHERE is_linked = true;