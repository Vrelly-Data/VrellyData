-- Article subscribers for blog resources
-- Allow anonymous INSERT only; no SELECT/UPDATE/DELETE via RLS.

CREATE TABLE IF NOT EXISTS public.article_subscribers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    first_name text,
    source_slug text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT article_subscribers_email_unique UNIQUE (email)
);

-- RLS: only allow anonymous inserts
ALTER TABLE public.article_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anonymous can insert article subscribers"
ON public.article_subscribers
FOR INSERT
TO anon
WITH CHECK (true);

