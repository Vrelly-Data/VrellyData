-- Saved audiences from the Data Playground AI audience builder
CREATE TABLE public.saved_audiences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  result_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_saved_audiences_user ON public.saved_audiences(user_id);

ALTER TABLE public.saved_audiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own saved audiences"
  ON public.saved_audiences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Use the same updated_at trigger pattern used elsewhere in this project
CREATE TRIGGER saved_audiences_updated_at
  BEFORE UPDATE ON public.saved_audiences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
