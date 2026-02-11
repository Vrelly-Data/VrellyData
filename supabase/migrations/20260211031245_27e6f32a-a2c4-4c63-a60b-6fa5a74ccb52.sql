
-- Create sales_knowledge table
CREATE TABLE public.sales_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}'::text[],
  metrics JSONB DEFAULT '{}'::jsonb,
  source_campaign TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add constraint for valid categories
ALTER TABLE public.sales_knowledge
  ADD CONSTRAINT sales_knowledge_category_check
  CHECK (category IN ('email_template', 'sequence_playbook', 'campaign_result', 'sales_guideline', 'audience_insight'));

-- Enable RLS
ALTER TABLE public.sales_knowledge ENABLE ROW LEVEL SECURITY;

-- Admin-only policies using existing is_global_admin function
CREATE POLICY "Admins can view sales knowledge"
  ON public.sales_knowledge FOR SELECT
  USING (is_global_admin(auth.uid()));

CREATE POLICY "Admins can create sales knowledge"
  ON public.sales_knowledge FOR INSERT
  WITH CHECK (is_global_admin(auth.uid()));

CREATE POLICY "Admins can update sales knowledge"
  ON public.sales_knowledge FOR UPDATE
  USING (is_global_admin(auth.uid()));

CREATE POLICY "Admins can delete sales knowledge"
  ON public.sales_knowledge FOR DELETE
  USING (is_global_admin(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_sales_knowledge_updated_at
  BEFORE UPDATE ON public.sales_knowledge
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
