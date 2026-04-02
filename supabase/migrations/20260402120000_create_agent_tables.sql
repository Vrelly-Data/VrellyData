-- Agent Phase 1 tables
CREATE TABLE public.agent_configs (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name        TEXT NOT NULL,
  company_url         TEXT,
  sender_name         TEXT NOT NULL,
  sender_title        TEXT,
  sender_linkedin     TEXT,
  sender_bio          TEXT,
  offer_description   TEXT NOT NULL,
  target_icp          TEXT,
  outcome_delivered   TEXT,
  desired_action      TEXT,
  saved_audience_id   UUID REFERENCES saved_audiences(id),
  communication_style TEXT DEFAULT 'conversational',
  avoid_phrases       TEXT[] DEFAULT '{}',
  sample_message      TEXT,
  reply_api_key       TEXT,
  managed_campaigns   TEXT[] DEFAULT '{}',
  mode                TEXT DEFAULT 'copilot'
                      CHECK (mode IN ('auto', 'copilot')),
  is_active           BOOLEAN DEFAULT false,
  onboarding_complete BOOLEAN DEFAULT false,
  onboarding_step     INTEGER DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_agent_configs_user
  ON public.agent_configs(user_id);

CREATE TABLE public.agent_runs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_config_id UUID REFERENCES agent_configs(id) ON DELETE CASCADE,
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','running','completed','failed')),
  audience_size   INTEGER,
  contacts_pushed INTEGER,
  copy_variant    TEXT,
  error_message   TEXT,
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE public.agent_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_config_id UUID REFERENCES agent_configs(id) ON DELETE CASCADE,
  agent_run_id    UUID REFERENCES agent_runs(id),
  external_id     TEXT,
  full_name       TEXT,
  company         TEXT,
  job_title       TEXT,
  linkedin_url    TEXT,
  email           TEXT,
  channel         TEXT CHECK (channel IN ('linkedin','email')),
  pipeline_stage  TEXT DEFAULT 'contacted'
                  CHECK (pipeline_stage IN (
                    'contacted','replied','engaged',
                    'meeting_booked','closed','dead'
                  )),
  last_reply_at   TIMESTAMPTZ,
  last_reply_text TEXT,
  draft_response  TEXT,
  draft_approved  BOOLEAN DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own agent config"
  ON public.agent_configs FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own agent runs"
  ON public.agent_runs FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own agent leads"
  ON public.agent_leads FOR ALL
  USING (auth.uid() = user_id);

-- Auto-update updated_at triggers
CREATE TRIGGER agent_configs_updated_at
  BEFORE UPDATE ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER agent_leads_updated_at
  BEFORE UPDATE ON public.agent_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
