-- Per-client document library (hosted-link approach).
--
-- Clients upload PDFs (e.g. a one-pager) once; operators insert the document's
-- public URL into a reply from the inbox. No send-path change — the link is just
-- text in the reply body, so it works identically on LinkedIn and email
-- (unlike Reply.io's Beta, feature-gated attachment upload).
--
-- Additive + null-safe: nothing here touches existing tables or drafting.

-- ---------------------------------------------------------------------------
-- 1. Table: one row per uploaded document, scoped per client by user_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id       UUID,
  title         TEXT NOT NULL,
  description   TEXT,                 -- optional "when to use" note
  storage_path  TEXT NOT NULL,        -- object key in the client-documents bucket
  file_name     TEXT,
  public_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_documents_user_id
  ON public.agent_documents(user_id);

ALTER TABLE public.agent_documents ENABLE ROW LEVEL SECURITY;

-- RLS mirrors agent_configs: user-scoped via auth.uid() = user_id.
DO $$
BEGIN
  CREATE POLICY "Users manage own agent documents"
    ON public.agent_documents
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Storage bucket: public (so the hosted link resolves for prospects).
--    Files are stored under "<user_id>/..." so the owner-scoped policies below
--    key off the first path segment.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'client-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Owner-scoped write/read via the storage API (public reads still work through
-- the public URL / CDN regardless of these). First folder segment = auth.uid().
DO $$
BEGIN
  CREATE POLICY "client-documents owner select"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'client-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "client-documents owner insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'client-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "client-documents owner update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'client-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "client-documents owner delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'client-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
