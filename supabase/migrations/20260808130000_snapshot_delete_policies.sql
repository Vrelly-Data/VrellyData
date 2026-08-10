-- client_analysis_snapshots: give platform admins DELETE, take it away from
-- clients.
--
-- WHY ADMINS NEED IT
-- ------------------
-- Snapshots are append-only by design: every Generate INSERTs a new row and
-- nothing has ever deleted one (verified — no delete against this table exists
-- anywhere in the codebase). Repeated Generate clicks therefore accumulate
-- exact-duplicate periods; prod currently holds e.g. the same
-- last_week 2026-07-13..19 snapshot three times for one client. Admins need a
-- way to remove those without hand-running SQL.
--
-- Gated on is_platform_admin, matching the existing
-- "Platform admins can read all client_analysis_snapshots" SELECT policy on
-- this same table. NOTE this is deliberately NOT is_super_admin, which the
-- organizations table uses — the two flags are different populations
-- (2 platform admins vs 1 super admin), and read/delete on this table should
-- line up with each other rather than with a different table's rule.
--
-- WHY CLIENTS LOSE IT
-- -------------------
-- The original migration (20260610120000) created all four CRUD policies
-- symmetrically, which handed clients DELETE on their own snapshots:
--
--   "Owners can delete their snapshots"  USING (user_id = auth.uid())
--
-- No UI ever exposed it, but the policy is live: a client with their own token
-- can DELETE /rest/v1/client_analysis_snapshots and permanently destroy their
-- own reporting history. There is no soft-delete column and no backup of this
-- table, so it is unrecoverable. Nothing in the product depends on a client
-- deleting a snapshot, so the capability is removed rather than left as a
-- latent footgun.
--
-- Owners keep SELECT (they read their own reports) and UPDATE (the admin
-- summary editor writes analysis_text through the owner's session). Only DELETE
-- is withdrawn.
--
-- Policies are OR'd, so adding the admin policy does not weaken the owner
-- policies, and dropping the owner DELETE policy does not affect the others.
--
-- A DELETE POLICY IS NOT ENOUGH ON ITS OWN
-- ----------------------------------------
-- Postgres applies SELECT policies to the rows an UPDATE/DELETE has to read in
-- order to match its WHERE clause. So an admin with a DELETE policy but no
-- SELECT policy covering the row deletes NOTHING — silently, with no error and
-- no rows affected, which looks exactly like a working no-op. Verified on dev:
-- the DELETE policy's predicate evaluated true while the row stayed put, and
-- the same DELETE removed 1 row the moment an admin SELECT policy existed.
--
-- Prod happens to carry "Platform admins can read all client_analysis_snapshots"
-- and dev does not, so this migration would have worked in prod and silently
-- failed in dev. Rather than depend on that drift, the admin SELECT policy is
-- (re)created here too — idempotently, under the same name prod already uses,
-- so prod is a no-op and dev is brought into line.
--
-- Safe to re-run. Run in dev, verify, then prod.

-- 0. Admins must be able to SEE a snapshot in order to delete it.
DROP POLICY IF EXISTS "Platform admins can read all client_analysis_snapshots"
  ON public.client_analysis_snapshots;
CREATE POLICY "Platform admins can read all client_analysis_snapshots"
  ON public.client_analysis_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = true
    )
  );

-- 1. Admins can delete any snapshot.
DROP POLICY IF EXISTS "Platform admins can delete any snapshot"
  ON public.client_analysis_snapshots;
CREATE POLICY "Platform admins can delete any snapshot"
  ON public.client_analysis_snapshots FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = true
    )
  );

-- 2. Clients can no longer delete their own history.
DROP POLICY IF EXISTS "Owners can delete their snapshots"
  ON public.client_analysis_snapshots;

NOTIFY pgrst, 'reload schema';
