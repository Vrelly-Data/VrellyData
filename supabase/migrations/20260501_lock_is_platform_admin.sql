-- Lock public.profiles.is_platform_admin against self-promotion.
--
-- Threat: the existing UPDATE policy on profiles allows any authenticated
-- user to update their own row (USING (auth.uid() = id)), with no WITH
-- CHECK and no column-level grant. is_platform_admin (added in
-- 20260331_fix_admin_security.sql) gates is_global_admin() and unlocks
-- admin-delete-user / admin-only resource manipulation. Without column
-- protection, any logged-in user can self-promote via PostgREST.
--
-- Fix: BEFORE UPDATE trigger that raises insufficient_privilege when
-- is_platform_admin is being changed AND the calling role is not
-- service_role. RLS policies are unchanged — this is a separate layer.
--
-- Service role passes through (Supabase SQL editor's default, edge
-- functions using service_role_key). Authenticated PostgREST requests
-- are blocked.
--
-- Run this in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.prevent_platform_admin_self_promotion()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
     AND current_setting('role', true) <> 'service_role'
  THEN
    RAISE EXCEPTION 'is_platform_admin can only be modified via service role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_platform_admin_self_promotion_trigger ON public.profiles;
CREATE TRIGGER prevent_platform_admin_self_promotion_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_platform_admin_self_promotion();

-- Smoke test: verify the trigger fires when an authenticated PostgREST
-- request tries to flip is_platform_admin. Wrapped so a test failure
-- never aborts the migration; result reported via RAISE NOTICE/WARNING.
--
-- Mechanics: we simulate a PostgREST request by setting
-- request.jwt.claims (which auth.uid() reads) to the test row's id, then
-- SET LOCAL ROLE authenticated so RLS USING (auth.uid() = id) admits the
-- row to the BEFORE UPDATE phase where the trigger lives. The trigger
-- should raise insufficient_privilege; we catch it and report PASS.
-- Subtransaction rollback restores SET LOCAL on the exception path; the
-- explicit RESET ROLE / set_config reset handles the no-exception path.
DO $do$
DECLARE
  v_test_id uuid;
  v_blocked boolean := false;
BEGIN
  SELECT id INTO v_test_id FROM public.profiles LIMIT 1;
  IF v_test_id IS NULL THEN
    RAISE NOTICE '[trigger test] No profiles rows — skipping behavioral test (function + trigger are still installed)';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', v_test_id, 'role', 'authenticated')::text,
      true
    );
    SET LOCAL ROLE authenticated;

    UPDATE public.profiles
    SET is_platform_admin = NOT COALESCE(is_platform_admin, false)
    WHERE id = v_test_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_blocked := true;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  IF v_blocked THEN
    RAISE NOTICE '[trigger test] PASS: trigger blocked is_platform_admin self-promotion under role=authenticated';
  ELSE
    RAISE WARNING '[trigger test] FAIL: trigger did NOT block the update under role=authenticated — verify trigger function logic';
  END IF;
END $do$;
