-- Performance indexes for scalable search on free_data table
-- These GIN indexes optimize JSONB field lookups for millions of records

-- Index for text-based searches (name, title, company, etc.)
CREATE INDEX IF NOT EXISTS idx_free_data_entity_data_gin 
ON public.free_data USING gin (entity_data jsonb_path_ops);

-- Index for entity type filtering (most queries filter by this first)
CREATE INDEX IF NOT EXISTS idx_free_data_entity_type 
ON public.free_data (entity_type);

-- Composite index for common query pattern: entity_type + created_at
CREATE INDEX IF NOT EXISTS idx_free_data_type_created 
ON public.free_data (entity_type, created_at DESC);

-- Index for external ID lookups (deduplication checks)
CREATE INDEX IF NOT EXISTS idx_free_data_external_id 
ON public.free_data (entity_external_id);

-- Index for source template filtering (admin queries)
CREATE INDEX IF NOT EXISTS idx_free_data_source_template 
ON public.free_data (source_template_id) 
WHERE source_template_id IS NOT NULL;

-- Similar indexes for unlocked_records table (user's saved data)
CREATE INDEX IF NOT EXISTS idx_unlocked_records_entity_data_gin 
ON public.unlocked_records USING gin (entity_data jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_unlocked_records_entity_type 
ON public.unlocked_records (entity_type);

CREATE INDEX IF NOT EXISTS idx_unlocked_records_team_type 
ON public.unlocked_records (team_id, entity_type);

-- Similar indexes for people_records table
CREATE INDEX IF NOT EXISTS idx_people_records_entity_data_gin 
ON public.people_records USING gin (entity_data jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_people_records_team_id 
ON public.people_records (team_id);

-- Similar indexes for company_records table
CREATE INDEX IF NOT EXISTS idx_company_records_entity_data_gin 
ON public.company_records USING gin (entity_data jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_company_records_team_id 
ON public.company_records (team_id);

-- Add comment documenting the current field mappings for future reference
COMMENT ON FUNCTION public.search_free_data_builder IS 
'Canonical search function for free_data table. 
Field mappings (UI → DB):
- Seniority: "C-Level" → "c suite", "c-level", "c level"
- Department: "Executive" → "c-suite", "executive" 
- Company Size: Numeric parsing with range matching (e.g., "4" → "1-10")
- Company Revenue: Numeric parsing with range matching (e.g., "270000000" → "$100M - $500M")
- Prospect Data: Checks both field variants (companyLinkedin OR companyLinkedinUrl)
Last updated: 2026-01-13';