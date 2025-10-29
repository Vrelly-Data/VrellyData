-- Create credit_transactions table
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  audience_id text,
  entity_type text NOT NULL CHECK (entity_type IN ('person', 'company')),
  records_returned integer NOT NULL DEFAULT 0,
  credits_deducted integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own transactions
CREATE POLICY "Users can view their own credit transactions"
ON public.credit_transactions
FOR SELECT
USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own transactions
CREATE POLICY "Users can insert their own credit transactions"
ON public.credit_transactions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create deduct_credits function
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id uuid,
  p_amount integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update credits and credits_used_this_month
  UPDATE public.profiles
  SET 
    credits = GREATEST(credits - p_amount, 0),
    credits_used_this_month = credits_used_this_month + p_amount
  WHERE id = p_user_id;
  
  -- Raise exception if not enough credits
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;