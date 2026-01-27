-- Make integration_id nullable for campaigns created from CSV imports
ALTER TABLE public.synced_campaigns 
ALTER COLUMN integration_id DROP NOT NULL;