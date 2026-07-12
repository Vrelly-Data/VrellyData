-- Organizations & superadmin financial layer.
--
-- ADDITIVE, superadmin-only. Does NOT change the client isolation model:
-- integrations stay user_id-owned, client-facing RLS is untouched. organizations
-- merely REFERENCES user_id for a financial/CRM roll-up visible only to a
-- superadmin. Financial data is the most sensitive in the app → deny-by-default:
-- RLS on, NO client-facing policy, a single superadmin policy.
--
-- Run in dev AND prod Studio, then: NOTIFY pgrst, 'reload schema';
-- Then verify:  SELECT policyname, cmd FROM pg_policies WHERE tablename='organizations';

-- 1. Superadmin tier (alongside is_platform_admin, on profiles).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- 1b. SELF-PROMOTION LOCK. The "Users can update their own profile" RLS policy
-- lets any authenticated user UPDATE their own profiles row via PostgREST. The
-- existing trigger only guarded is_platform_admin — extend it so is_super_admin
-- (financial visibility) is ALSO service-role-only. Without this, a client could
-- SET is_super_admin=true on their own row and read all org/financial data.
CREATE OR REPLACE FUNCTION public.prevent_platform_admin_self_promotion()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
      OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin)
     AND current_setting('role', true) <> 'service_role'
  THEN
    RAISE EXCEPTION 'is_platform_admin / is_super_admin can only be modified via service role'
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

-- 2. Organizations (one per user).
CREATE TABLE IF NOT EXISTS public.organizations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- identity / CRM
  name                  text NOT NULL,
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  notes                 text,

  -- lifecycle (manual toggle)
  is_active             boolean NOT NULL DEFAULT true,

  -- billing: manual override wins over Stripe
  manual_monthly_cents  integer,        -- authoritative when set
  stripe_customer_id    text,
  stripe_subscription_id text,
  stripe_monthly_cents  integer,        -- synced from Stripe, read-only
  stripe_synced_at      timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- keep updated_at fresh (reuse the shared trigger fn used elsewhere).
DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. RLS — superadmin-only, deny-by-default. NO other policy may exist here.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DO $pol$ BEGIN
  CREATE POLICY organizations_superadmin_all
    ON public.organizations
    FOR ALL
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_super_admin = true
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_super_admin = true
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;
