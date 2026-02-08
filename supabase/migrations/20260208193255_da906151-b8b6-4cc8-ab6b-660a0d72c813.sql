-- Add links_initialized flag to track first-time auto-linking
ALTER TABLE public.outbound_integrations 
ADD COLUMN links_initialized boolean NOT NULL DEFAULT false;