
-- Add composite index for fast ORDER BY + pagination on free_data
CREATE INDEX IF NOT EXISTS idx_free_data_type_extid 
ON public.free_data (entity_type, entity_external_id);

-- Run ANALYZE to refresh pg_class statistics for the estimate strategy
ANALYZE public.free_data;
