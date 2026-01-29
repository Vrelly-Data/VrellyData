-- Add unique constraint for upsert to work on synced_sequences
ALTER TABLE synced_sequences
ADD CONSTRAINT synced_sequences_campaign_step_unique 
UNIQUE (campaign_id, step_number);