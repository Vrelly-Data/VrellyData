-- Add step_type column to synced_sequences table
-- This allows storing step types like: email, linkedin_connect, linkedin_message, linkedin_view_profile, linkedin_inmail, etc.
ALTER TABLE synced_sequences 
ADD COLUMN step_type TEXT;