-- Drop the old deduct_credits function that returns void
DROP FUNCTION IF EXISTS public.deduct_credits(uuid, integer);

-- Recreate with jsonb return type
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id uuid, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available integer;
  v_daily_limit integer := 10000;
BEGIN
  -- First reset if new day
  PERFORM public.reset_daily_credits_if_needed(p_user_id);
  
  -- Get available credits for today
  SELECT v_daily_limit - credits_used_today INTO v_available
  FROM public.profiles WHERE id = p_user_id;
  
  IF v_available < p_amount THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Daily limit exceeded', 
      'remaining_today', v_available
    );
  END IF;
  
  -- Deduct credits
  UPDATE public.profiles
  SET credits_used_today = credits_used_today + p_amount,
      credits_used_this_month = credits_used_this_month + p_amount,
      updated_at = now()
  WHERE id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true, 
    'remaining_today', v_available - p_amount
  );
END;
$$;

-- Function to get daily credit status
CREATE OR REPLACE FUNCTION public.get_daily_credit_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits_used integer;
  v_daily_limit integer := 10000;
  v_last_reset date;
BEGIN
  -- Reset if needed first
  PERFORM public.reset_daily_credits_if_needed(p_user_id);
  
  SELECT credits_used_today, last_credit_reset_date 
  INTO v_credits_used, v_last_reset
  FROM public.profiles WHERE id = p_user_id;
  
  RETURN jsonb_build_object(
    'credits_used_today', COALESCE(v_credits_used, 0),
    'daily_limit', v_daily_limit,
    'remaining_today', v_daily_limit - COALESCE(v_credits_used, 0),
    'last_reset_date', v_last_reset
  );
END;
$$;