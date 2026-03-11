-- User credits and subscription tracking
CREATE TABLE public.user_credits (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  plan                  TEXT NOT NULL DEFAULT 'none'
                          CHECK (plan IN ('none', 'starter', 'professional', 'enterprise')),
  billing_interval      TEXT DEFAULT 'monthly'
                          CHECK (billing_interval IN ('monthly', 'annual')),

  -- Stripe references
  stripe_customer_id    TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  subscription_status   TEXT DEFAULT 'inactive',
  current_period_end    TIMESTAMPTZ,

  -- Export credits
  export_credits_total  INTEGER NOT NULL DEFAULT 0,
  export_credits_used   INTEGER NOT NULL DEFAULT 0,
  export_credits_reset_at TIMESTAMPTZ DEFAULT now(),

  -- Enterprise daily export tracking
  enterprise_daily_exports INTEGER NOT NULL DEFAULT 0,
  enterprise_daily_reset_at TIMESTAMPTZ DEFAULT now(),

  -- AI generation credits
  ai_credits_total      INTEGER NOT NULL DEFAULT 0,
  ai_credits_used       INTEGER NOT NULL DEFAULT 0,
  ai_credits_reset_at   TIMESTAMPTZ DEFAULT now(),

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_user_credits_user_id ON public.user_credits(user_id);
CREATE INDEX idx_user_credits_stripe_customer ON public.user_credits(stripe_customer_id);
CREATE INDEX idx_user_credits_stripe_sub ON public.user_credits(stripe_subscription_id);

-- Helper function for auto-updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at
CREATE TRIGGER user_credits_updated_at
  BEFORE UPDATE ON public.user_credits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: users can only read their own credits
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own credits"
  ON public.user_credits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access"
  ON public.user_credits
  USING (auth.role() = 'service_role');

-- Auto-create credit row when user signs up
CREATE OR REPLACE FUNCTION handle_new_user_credits()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_credits (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_credits();

-- Backfill: create credit rows for existing users
INSERT INTO public.user_credits (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
