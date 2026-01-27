-- Add unique constraint on synced_contacts for upsert to work
ALTER TABLE synced_contacts 
ADD CONSTRAINT synced_contacts_campaign_email_unique 
UNIQUE (campaign_id, email);