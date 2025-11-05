-- Update the reset_monthly_credits function to add credits to wallet each month
CREATE OR REPLACE FUNCTION public.reset_monthly_credits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.profiles
  SET 
    credits_used_this_month = 0,
    credits = credits + monthly_credit_limit,
    billing_period_start = billing_period_end,
    billing_period_end = billing_period_end + interval '1 month'
  WHERE billing_period_end <= now()
    AND subscription_status = 'active'
    AND monthly_credit_limit > 0;
END;
$function$;