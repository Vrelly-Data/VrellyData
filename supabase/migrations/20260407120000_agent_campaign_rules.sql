ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS campaign_rules JSONB DEFAULT '{}';
