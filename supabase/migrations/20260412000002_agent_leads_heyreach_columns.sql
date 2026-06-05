ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_conversation_id TEXT;
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_account_id INTEGER;
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS draft_approved BOOLEAN DEFAULT false;
