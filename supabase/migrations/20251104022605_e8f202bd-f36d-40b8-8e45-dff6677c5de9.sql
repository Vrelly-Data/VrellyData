-- Update handle_new_user function to give new users 25 credits instead of 100
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, credits, monthly_credit_limit, subscription_tier, credits_used_this_month)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'name', 25, 25, 'free', 0);
  RETURN NEW;
END;
$$;

-- Update existing free tier users to have correct credit limits
UPDATE public.profiles
SET 
  monthly_credit_limit = 25,
  subscription_tier = 'free'
WHERE subscription_tier IS NULL 
   OR subscription_tier = 'free';