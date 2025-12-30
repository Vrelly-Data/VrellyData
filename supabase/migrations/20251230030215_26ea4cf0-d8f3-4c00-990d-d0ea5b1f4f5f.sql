-- Drop the old function and create a simplified version
DROP FUNCTION IF EXISTS deduct_credits(uuid, integer);

-- Create simplified deduct_credits function that just deducts from credits balance
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id uuid, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_credits integer;
  v_new_credits integer;
BEGIN
  -- Get current credits
  SELECT credits INTO v_current_credits
  FROM profiles
  WHERE id = p_user_id;
  
  IF v_current_credits IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'remaining_credits', 0,
      'error', 'User profile not found'
    );
  END IF;
  
  -- Check if enough credits
  IF v_current_credits < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'remaining_credits', v_current_credits,
      'error', 'Insufficient credits'
    );
  END IF;
  
  -- Deduct credits
  v_new_credits := v_current_credits - p_amount;
  
  UPDATE profiles
  SET credits = v_new_credits,
      updated_at = now()
  WHERE id = p_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'remaining_credits', v_new_credits
  );
END;
$$;

-- Drop the old get_daily_credit_status function as it's no longer needed
DROP FUNCTION IF EXISTS get_daily_credit_status(uuid);