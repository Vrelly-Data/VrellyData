-- Create a function to update credits for testing purposes
CREATE OR REPLACE FUNCTION public.update_credits_for_testing(
  p_user_id UUID,
  p_new_credits INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.profiles
  SET 
    credits = p_new_credits,
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;