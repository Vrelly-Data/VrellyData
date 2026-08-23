-- Migration: baseline blog_posts (catch out-of-band prod table under version control)
-- Source: pg_dump of prod (lgnvolndyftsbcjprmic) on 2026-05-28, schema-only, no-owner/no-privileges.
-- On a fresh dev DB this runs as-is. On prod the table already exists; reconcile
-- supabase_migrations.schema_migrations separately (do NOT re-apply on prod).
--
-- Prereq: public.update_updated_at_column() — defined in older tracked migrations.
-- Extensions used: pgcrypto (gen_random_uuid()) — already prod-installed.

-- Table

CREATE TABLE public.blog_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    excerpt text,
    content text NOT NULL,
    cover_image_url text,
    meta_title text,
    meta_description text,
    meta_keywords text[],
    canonical_url text,
    category text DEFAULT 'general'::text,
    tags text[] DEFAULT '{}'::text[],
    status text DEFAULT 'draft'::text,
    published_at timestamp with time zone,
    author_name text DEFAULT 'Vrelly Team'::text,
    author_avatar_url text,
    reading_time_minutes integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT blog_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


-- Constraints

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_slug_key UNIQUE (slug);


-- Indexes
CREATE INDEX idx_blog_posts_category ON public.blog_posts USING btree (category);
CREATE INDEX idx_blog_posts_published ON public.blog_posts USING btree (status, published_at DESC);
CREATE INDEX idx_blog_posts_slug ON public.blog_posts USING btree (slug);

-- Trigger
CREATE TRIGGER update_blog_posts_updated_at BEFORE UPDATE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Row Level Security
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Public can read published posts" ON public.blog_posts FOR SELECT USING ((status = 'published'::text));
CREATE POLICY "Service role has full access" ON public.blog_posts USING (true) WITH CHECK (true);
