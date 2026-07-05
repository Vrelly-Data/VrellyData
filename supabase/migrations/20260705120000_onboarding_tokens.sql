-- Self-serve onboarding tokens.
--
-- Backs the public onboarding flow (get-onboarding-context +
-- provision-onboarding). An admin mints a token via
-- admin-create-onboarding-link, which ALSO creates the client's auth user
-- up front (so triggers auto-provision profiles/team/credits). The admin
-- sends the link to the client; the client fills the questionnaire and the
-- account is provisioned on submit.
--
-- Two deltas from report_tokens:
--   * Scoped to a pre-created auth USER (user_id), not a client_analysis row.
--   * Time-boxed (expires_at) and single-completion (consumed_at) — an
--     onboarding link should not stay live forever or be completable twice.
--
-- Security model (mirrors report_tokens):
--   * Admins are the only authenticated users who can touch this table. RLS
--     gates them to their own tokens (created_by = auth.uid()) AND requires
--     is_platform_admin.
--   * The public endpoints run under the service role (RLS bypassed) and look
--     up tokens directly. No public SELECT policy exists, by design.
--
-- IDEMPOTENCY (critical): provision-onboarding claims the token atomically
-- with `UPDATE ... SET consumed_at = now() WHERE token = $1 AND consumed_at
-- IS NULL` and aborts if 0 rows update — BEFORE any Stripe call. The partial
-- unique index below is a second guard: at most one live (unconsumed,
-- unrevoked) token per user, so a user can never have two claimable links.
--
-- already_paid is set HERE by the admin at generate time and is the ONLY
-- source of truth for the free-tier decision — never trusted from the client
-- request body.

CREATE TABLE IF NOT EXISTS public.onboarding_tokens (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,
  user_id       UUID NOT NULL
                  REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT,
  display_name  TEXT,
  company       TEXT,
  already_paid  BOOLEAN NOT NULL DEFAULT false,
  consumed_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  revoked       BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tokens_token
  ON public.onboarding_tokens(token);

-- At most one live link per user (unconsumed + not revoked). Re-minting for a
-- user requires revoking/consuming the previous link first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_tokens_one_live_per_user
  ON public.onboarding_tokens(user_id)
  WHERE consumed_at IS NULL AND revoked = false;

ALTER TABLE public.onboarding_tokens ENABLE ROW LEVEL SECURITY;

-- Admin-only RLS: must be is_platform_admin AND own the row. Defense-in-depth
-- alongside the function-level admin check in admin-create-onboarding-link.

DO $pol$ BEGIN
  CREATE POLICY "Admins can select their onboarding tokens"
    ON public.onboarding_tokens FOR SELECT
    USING (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_platform_admin = true
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Admins can insert their onboarding tokens"
    ON public.onboarding_tokens FOR INSERT
    WITH CHECK (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_platform_admin = true
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Admins can update their onboarding tokens"
    ON public.onboarding_tokens FOR UPDATE
    USING (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_platform_admin = true
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;
