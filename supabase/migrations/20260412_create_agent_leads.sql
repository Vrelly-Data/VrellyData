-- Agent leads: contacts that replied, surfaced for inbox review
CREATE TABLE IF NOT EXISTS public.agent_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  last_reply_text TEXT,
  inbox_status TEXT NOT NULL DEFAULT 'pending',
  channel TEXT NOT NULL DEFAULT 'email',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_leads_user ON public.agent_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_leads_status ON public.agent_leads(inbox_status);

ALTER TABLE public.agent_leads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view their own leads"
    ON public.agent_leads FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own leads"
    ON public.agent_leads FOR UPDATE
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Skip no-op updates when last_reply_text hasn't changed
CREATE OR REPLACE FUNCTION public.agent_leads_skip_noop()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_reply_text IS NOT DISTINCT FROM OLD.last_reply_text THEN
    RETURN NULL; -- cancel the update
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_leads_skip_noop_trigger ON public.agent_leads;
CREATE TRIGGER agent_leads_skip_noop_trigger
  BEFORE UPDATE ON public.agent_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_leads_skip_noop();

DROP TRIGGER IF EXISTS update_agent_leads_updated_at ON public.agent_leads;
CREATE TRIGGER update_agent_leads_updated_at
  BEFORE UPDATE ON public.agent_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
