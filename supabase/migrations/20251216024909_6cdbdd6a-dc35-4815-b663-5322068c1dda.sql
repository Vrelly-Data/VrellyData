-- Add missing columns to profiles table for daily credit tracking
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS credits_used_today integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_credit_reset_date date;

-- Create function to reset daily credits if needed
CREATE OR REPLACE FUNCTION public.reset_daily_credits_if_needed(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last_reset date;
BEGIN
  SELECT last_credit_reset_date INTO v_last_reset
  FROM public.profiles WHERE id = p_user_id;
  
  -- Reset if it's a new day or never reset before
  IF v_last_reset IS NULL OR v_last_reset < CURRENT_DATE THEN
    UPDATE public.profiles
    SET credits_used_today = 0,
        last_credit_reset_date = CURRENT_DATE
    WHERE id = p_user_id;
  END IF;
END;
$$;