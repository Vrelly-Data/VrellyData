-- Admin read-only access to report_tokens (share links), mirroring the
-- client_analysis admin-read policies. Without this, a platform admin viewing
-- a client's report cannot SELECT that client's tokens (the owner + prior
-- admin policies both require created_by = auth.uid()), so freshly-minted
-- links appear absent in the Share modal.
--
-- Pairs with the create-report-token change that sets created_by to the CLIENT
-- (row owner): the client sees their own links via the owner-select policy,
-- and an admin sees them read-only via this policy.
--
-- Additive + idempotent. Run in dev then prod, then:
--   NOTIFY pgrst, 'reload schema';

DO $pol$ BEGIN
  CREATE POLICY "Platform admins can read all report_tokens"
    ON public.report_tokens FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_platform_admin = true
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;
