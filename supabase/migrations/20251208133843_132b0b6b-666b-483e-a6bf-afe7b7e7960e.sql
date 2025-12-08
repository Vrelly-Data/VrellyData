
-- Create data_source_templates table for storing CSV column mappings
CREATE TABLE public.data_source_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  entity_type public.entity_type NOT NULL,
  column_mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, entity_type)
);

-- Create free_data table for public lead data available to all users
CREATE TABLE public.free_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type public.entity_type NOT NULL,
  entity_data JSONB NOT NULL,
  entity_external_id TEXT NOT NULL,
  source_template_id UUID REFERENCES public.data_source_templates(id),
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_type, entity_external_id)
);

-- Enable RLS
ALTER TABLE public.data_source_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_data ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check if user is admin (without team context)
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'
  )
$$;

-- RLS policies for data_source_templates
-- Admins can do everything
CREATE POLICY "Admins can manage data source templates"
ON public.data_source_templates
FOR ALL
USING (public.is_global_admin(auth.uid()));

-- All authenticated users can view templates
CREATE POLICY "Authenticated users can view templates"
ON public.data_source_templates
FOR SELECT
TO authenticated
USING (true);

-- RLS policies for free_data
-- Admins can do everything
CREATE POLICY "Admins can manage free data"
ON public.free_data
FOR ALL
USING (public.is_global_admin(auth.uid()));

-- All authenticated users can view free data
CREATE POLICY "Authenticated users can view free data"
ON public.free_data
FOR SELECT
TO authenticated
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_data_source_templates_updated_at
BEFORE UPDATE ON public.data_source_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
