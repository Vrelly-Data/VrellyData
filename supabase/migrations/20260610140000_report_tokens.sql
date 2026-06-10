-- Public client-report tokens.
--
-- Backs the read-only public endpoint get-client-report. Each row is one
-- "shareable link" — the admin mints a token via create-report-token,
-- gives it to the client (likely as a query param on a public URL), and
-- anyone holding the token can read THAT one client's report data via
-- the public endpoint. Revoking sets revoked=true and the public endpoint
-- returns 404 thereafter.
--
-- Security model:
--   * Admins are the ONLY authenticated users who can interact with this
--     table. RLS gates them to their own tokens (created_by = auth.uid())
--     AND requires is_platform_admin on the caller's profile row.
--   * The public endpoint runs under the service role (RLS bypassed) and
--     looks up tokens directly. Tokens are stored plaintext for MVP; a
--     future iteration can store hashes if leak-resistance becomes a
--     priority (cost: can no longer return the token verbatim after mint).
--   * No public SELECT policy exists, by design. The service-role bypass
--     in the edge function is the only public read path; an anon role
--     querying this table directly returns nothing.

CREATE TABLE IF NOT EXISTS public.report_tokens (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  client_id  UUID NOT NULL
               REFERENCES public.client_analysis(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  revoked    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_tokens_token
  ON public.report_tokens(token);

ALTER TABLE public.report_tokens ENABLE ROW LEVEL SECURITY;

-- Admin-only RLS: must be is_platform_admin AND own the row. Defense-in-
-- depth alongside the function-level admin check in create-report-token.

DO $pol$ BEGIN
  CREATE POLICY "Admins can select their tokens"
    ON public.report_tokens FOR SELECT
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
  CREATE POLICY "Admins can insert their tokens"
    ON public.report_tokens FOR INSERT
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
  CREATE POLICY "Admins can update their tokens"
    ON public.report_tokens FOR UPDATE
    USING (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_platform_admin = true
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;
