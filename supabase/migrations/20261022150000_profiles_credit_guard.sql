-- Credits and billing on public.profiles could be changed by any logged-in user.
--
-- 1. update_credits_for_testing(p_user_id, p_new_credits) and
--    deduct_credits(p_user_id, p_amount) are SECURITY DEFINER, never check the
--    caller, and were executable by `authenticated` (20261021125624 removed
--    only anon/PUBLIC). Any user could set any user's credits, and a negative
--    p_amount added credits. Nothing calls either one (no app, edge function,
--    cron or database caller; 0 calls in pg_stat_statements, checked
--    2026-10-22), so both are now service_role only, and deduct_credits
--    refuses an amount <= 0 and locks the row it changes.
--
-- 2. `authenticated` had UPDATE on every column of profiles, and the policy
--    "Users can update their own profile" allows any change to the caller's own
--    row, so a user could set their own credits, plan, subscription_tier,
--    subscription_status, credit limits and Stripe ids through PostgREST. The
--    app only ever writes `name` (Settings); every other writer is
--    service_role (stripe-webhook, check-subscription, reset-monthly-credits)
--    or a SECURITY DEFINER function owned by postgres. UPDATE is now granted
--    on `name` only. updated_at is still set by its trigger. (is_platform_admin
--    / is_super_admin stay guarded by prevent_platform_admin_self_promotion.)

create or replace function public.deduct_credits(p_user_id uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_credits integer;
  v_new_credits integer;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object(
      'success', false,
      'remaining_credits', 0,
      'error', 'Amount must be a positive number of credits'
    );
  end if;

  -- Get current credits (locked, so two deductions can't both read the same balance)
  select credits into v_current_credits
  from profiles
  where id = p_user_id
  for update;

  if v_current_credits is null then
    return jsonb_build_object(
      'success', false,
      'remaining_credits', 0,
      'error', 'User profile not found'
    );
  end if;

  -- Check if enough credits
  if v_current_credits < p_amount then
    return jsonb_build_object(
      'success', false,
      'remaining_credits', v_current_credits,
      'error', 'Insufficient credits'
    );
  end if;

  -- Deduct credits
  v_new_credits := v_current_credits - p_amount;

  update profiles
  set credits = v_new_credits,
      updated_at = now()
  where id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'remaining_credits', v_new_credits
  );
end;
$function$;

revoke execute on function public.update_credits_for_testing(uuid, integer) from public, anon, authenticated;
revoke execute on function public.deduct_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.update_credits_for_testing(uuid, integer) to service_role;
grant execute on function public.deduct_credits(uuid, integer) to service_role;

revoke update on public.profiles from anon, authenticated;
grant update (name) on public.profiles to authenticated;
