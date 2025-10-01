-- Add subscription fields to profiles table
ALTER TABLE public.profiles
ADD COLUMN subscription_tier text DEFAULT 'free',
ADD COLUMN monthly_credit_limit integer DEFAULT 0,
ADD COLUMN credits_used_this_month integer DEFAULT 0,
ADD COLUMN billing_period_start timestamp with time zone,
ADD COLUMN billing_period_end timestamp with time zone,
ADD COLUMN stripe_subscription_id text,
ADD COLUMN stripe_customer_id text,
ADD COLUMN subscription_status text DEFAULT 'inactive';

-- Add check constraint for valid subscription tiers
ALTER TABLE public.profiles
ADD CONSTRAINT valid_subscription_tier 
CHECK (subscription_tier IN ('free', 'starter', 'professional', 'enterprise'));

-- Add check constraint for valid subscription status
ALTER TABLE public.profiles
ADD CONSTRAINT valid_subscription_status
CHECK (subscription_status IN ('active', 'inactive', 'canceled', 'past_due', 'trialing'));

-- Create index for Stripe lookups
CREATE INDEX idx_profiles_stripe_customer_id ON public.profiles(stripe_customer_id);
CREATE INDEX idx_profiles_stripe_subscription_id ON public.profiles(stripe_subscription_id);

-- Function to reset monthly credits at billing cycle
CREATE OR REPLACE FUNCTION public.reset_monthly_credits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET credits_used_this_month = 0,
      billing_period_start = billing_period_end,
      billing_period_end = billing_period_end + interval '1 month'
  WHERE billing_period_end <= now()
    AND subscription_status = 'active';
END;
$$;