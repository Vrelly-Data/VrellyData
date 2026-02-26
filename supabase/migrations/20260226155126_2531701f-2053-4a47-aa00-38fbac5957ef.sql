
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_free_data_trgm_title
  ON public.free_data USING gin ((entity_data->>'title') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_free_data_trgm_firstname
  ON public.free_data USING gin ((entity_data->>'firstName') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_free_data_trgm_lastname
  ON public.free_data USING gin ((entity_data->>'lastName') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_free_data_trgm_company
  ON public.free_data USING gin ((entity_data->>'company') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_free_data_trgm_companyname
  ON public.free_data USING gin ((entity_data->>'companyName') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_free_data_trgm_skills
  ON public.free_data USING gin ((entity_data->>'skills') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_free_data_trgm_interests
  ON public.free_data USING gin ((entity_data->>'interests') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_free_data_trgm_technologies
  ON public.free_data USING gin ((entity_data->>'technologies') gin_trgm_ops);
