-- Admin read-only cross-user access to data-analysis rows.
--
-- Context: data-analysis is moving from admin-only to every-user (each user
-- manages their own client_analysis + uses their OWN outbound_integrations
-- row). The existing RLS is strictly owner-only (user_id = auth.uid()). To let
-- a platform admin VIEW any client's analysis read-only (without owning it or
-- touching their inbox), we add ADDITIVE SELECT policies gated on
-- is_platform_admin. Postgres combines permissive policies with OR, so owners
-- keep full access and admins gain read-only visibility across users.
--
-- SELECT-only by design: admins do not INSERT/UPDATE/DELETE another user's
-- rows here. generate-client-analysis (service role) is the only writer for a
-- non-owner, and it authorizes owner-or-admin in code.
--
-- Run in dev then prod, then: NOTIFY pgrst, 'reload schema';

DO $pol$ BEGIN
  CREATE POLICY "Platform admins can read all client_analysis"
    ON public.client_analysis FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = true
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Platform admins can read all client_analysis_snapshots"
    ON public.client_analysis_snapshots FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = true
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Platform admins can read all client_checklist_items"
    ON public.client_checklist_items FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = true
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

-- report_tokens: the original SELECT policy required is_platform_admin, so a
-- non-admin owner couldn't list their own share links in ShareReportDialog.
-- Now that data-analysis is open to all users, add an OWNER-scoped SELECT so
-- owners see their own tokens. (Create/revoke still run under service role in
-- create-report-token with owner checks, so no INSERT/UPDATE policy change is
-- needed.) The pre-existing admin-scoped policy stays — harmless overlap.
DO $pol$ BEGIN
  CREATE POLICY "Owners can select their report_tokens"
    ON public.report_tokens FOR SELECT
    USING (created_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;
