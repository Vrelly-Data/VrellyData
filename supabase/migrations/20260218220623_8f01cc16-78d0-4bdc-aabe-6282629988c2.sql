
-- Create resources table for SEO article CMS
CREATE TABLE public.resources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  meta_description TEXT,
  content_markdown TEXT NOT NULL DEFAULT '',
  excerpt TEXT,
  tags TEXT[] DEFAULT '{}',
  author TEXT DEFAULT 'Vrelly Team',
  cover_image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

-- Public can read published resources (for SEO)
CREATE POLICY "Anyone can view published resources"
  ON public.resources
  FOR SELECT
  USING (is_published = true);

-- Only service role can insert/update/delete (agent uses service role via edge function)
CREATE POLICY "Service role can manage resources"
  ON public.resources
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create API keys table for agent auth
CREATE TABLE public.resource_api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.resource_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage resource api keys"
  ON public.resource_api_keys
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_resources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_resources_updated_at
  BEFORE UPDATE ON public.resources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_resources_updated_at();
