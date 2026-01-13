-- Hard reset: Drop ALL overloads of search_free_data_builder dynamically
DO $$
DECLARE
    func_rec RECORD;
BEGIN
    FOR func_rec IN 
        SELECT p.oid::regprocedure::text AS func_signature
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
        AND p.proname = 'search_free_data_builder'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || func_rec.func_signature || ' CASCADE';
        RAISE NOTICE 'Dropped: %', func_rec.func_signature;
    END LOOP;
END $$;

-- Create the ONE canonical function matching actual free_data schema (jsonb-based)
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
    p_entity_type text,
    p_industries text[] DEFAULT NULL,
    p_countries text[] DEFAULT NULL,
    p_states text[] DEFAULT NULL,
    p_cities text[] DEFAULT NULL,
    p_genders text[] DEFAULT NULL,
    p_job_titles text[] DEFAULT NULL,
    p_seniorities text[] DEFAULT NULL,
    p_departments text[] DEFAULT NULL,
    p_company_sizes text[] DEFAULT NULL,
    p_revenue_min numeric DEFAULT NULL,
    p_revenue_max numeric DEFAULT NULL,
    p_has_email boolean DEFAULT NULL,
    p_has_phone boolean DEFAULT NULL,
    p_has_linkedin boolean DEFAULT NULL,
    p_has_facebook boolean DEFAULT NULL,
    p_has_twitter boolean DEFAULT NULL,
    p_page integer DEFAULT 1,
    p_per_page integer DEFAULT 25
)
RETURNS TABLE (
    entity_external_id text,
    entity_data jsonb,
    total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
    v_offset integer;
    v_total bigint;
    v_expanded_seniorities text[];
BEGIN
    v_offset := (COALESCE(p_page, 1) - 1) * COALESCE(p_per_page, 25);
    
    -- Expand seniority levels to include related titles
    IF p_seniorities IS NOT NULL AND array_length(p_seniorities, 1) > 0 THEN
        v_expanded_seniorities := p_seniorities;
        IF 'C-Level' = ANY(p_seniorities) OR 'c-level' = ANY(p_seniorities) THEN
            v_expanded_seniorities := array_cat(v_expanded_seniorities, ARRAY['CEO', 'CFO', 'CTO', 'COO', 'CMO', 'CIO', 'CISO', 'CRO', 'CPO', 'Chief']);
        END IF;
        IF 'VP' = ANY(p_seniorities) OR 'vp' = ANY(p_seniorities) THEN
            v_expanded_seniorities := array_cat(v_expanded_seniorities, ARRAY['Vice President', 'VP of', 'SVP', 'EVP', 'AVP']);
        END IF;
        IF 'Director' = ANY(p_seniorities) OR 'director' = ANY(p_seniorities) THEN
            v_expanded_seniorities := array_cat(v_expanded_seniorities, ARRAY['Director of', 'Senior Director', 'Managing Director', 'Executive Director']);
        END IF;
        IF 'Manager' = ANY(p_seniorities) OR 'manager' = ANY(p_seniorities) THEN
            v_expanded_seniorities := array_cat(v_expanded_seniorities, ARRAY['Manager of', 'Senior Manager', 'General Manager', 'Assistant Manager']);
        END IF;
    ELSE
        v_expanded_seniorities := NULL;
    END IF;
    
    -- Get total count
    SELECT COUNT(*) INTO v_total
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type::entity_type
      AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
           fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_industries) || '%'))
      AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'country', fd.entity_data->>'person_country', fd.entity_data->>'company_country') ILIKE ANY(SELECT '%' || unnest(p_countries) || '%'))
      AND (p_states IS NULL OR array_length(p_states, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'state', fd.entity_data->>'person_state', fd.entity_data->>'company_state') ILIKE ANY(SELECT '%' || unnest(p_states) || '%'))
      AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'city', fd.entity_data->>'person_city', fd.entity_data->>'company_city') ILIKE ANY(SELECT '%' || unnest(p_cities) || '%'))
      AND (p_genders IS NULL OR array_length(p_genders, 1) IS NULL OR 
           fd.entity_data->>'gender' ILIKE ANY(SELECT '%' || unnest(p_genders) || '%'))
      AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'title', fd.entity_data->>'job_title') ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%'))
      AND (v_expanded_seniorities IS NULL OR array_length(v_expanded_seniorities, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'seniority', fd.entity_data->>'title', fd.entity_data->>'job_title') ILIKE ANY(SELECT '%' || unnest(v_expanded_seniorities) || '%'))
      AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'department', fd.entity_data->>'departments') ILIKE ANY(SELECT '%' || unnest(p_departments) || '%'))
      AND (p_company_sizes IS NULL OR array_length(p_company_sizes, 1) IS NULL OR 
           fd.entity_data->>'employees' ILIKE ANY(SELECT '%' || unnest(p_company_sizes) || '%') OR
           fd.entity_data->>'employee_count' ILIKE ANY(SELECT '%' || unnest(p_company_sizes) || '%') OR
           fd.entity_data->>'company_size' ILIKE ANY(SELECT '%' || unnest(p_company_sizes) || '%'))
      AND (p_revenue_min IS NULL OR (
           CASE 
               WHEN fd.entity_data->>'revenue' ~ '^\d+(\.\d+)?$' THEN (fd.entity_data->>'revenue')::numeric
               WHEN fd.entity_data->>'annual_revenue' ~ '^\d+(\.\d+)?$' THEN (fd.entity_data->>'annual_revenue')::numeric
               ELSE NULL
           END >= p_revenue_min))
      AND (p_revenue_max IS NULL OR (
           CASE 
               WHEN fd.entity_data->>'revenue' ~ '^\d+(\.\d+)?$' THEN (fd.entity_data->>'revenue')::numeric
               WHEN fd.entity_data->>'annual_revenue' ~ '^\d+(\.\d+)?$' THEN (fd.entity_data->>'annual_revenue')::numeric
               ELSE NULL
           END <= p_revenue_max))
      AND (p_has_email IS NULL OR p_has_email = FALSE OR 
           (COALESCE(fd.entity_data->>'email', fd.entity_data->>'work_email', fd.entity_data->>'personal_email', '') <> ''))
      AND (p_has_phone IS NULL OR p_has_phone = FALSE OR 
           (COALESCE(fd.entity_data->>'phone', fd.entity_data->>'mobile_phone', fd.entity_data->>'direct_phone', '') <> ''))
      AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR 
           (COALESCE(fd.entity_data->>'linkedin_url', fd.entity_data->>'linkedin', fd.entity_data->>'company_linkedin_url', '') <> ''))
      AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR 
           (COALESCE(fd.entity_data->>'facebook_url', fd.entity_data->>'facebook', fd.entity_data->>'company_facebook_url', '') <> ''))
      AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR 
           (COALESCE(fd.entity_data->>'twitter_url', fd.entity_data->>'twitter', fd.entity_data->>'company_twitter_url', '') <> ''));

    -- Return results with total_count on each row
    RETURN QUERY
    SELECT 
        fd.entity_external_id,
        fd.entity_data,
        v_total AS total_count
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type::entity_type
      AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
           fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_industries) || '%'))
      AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'country', fd.entity_data->>'person_country', fd.entity_data->>'company_country') ILIKE ANY(SELECT '%' || unnest(p_countries) || '%'))
      AND (p_states IS NULL OR array_length(p_states, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'state', fd.entity_data->>'person_state', fd.entity_data->>'company_state') ILIKE ANY(SELECT '%' || unnest(p_states) || '%'))
      AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'city', fd.entity_data->>'person_city', fd.entity_data->>'company_city') ILIKE ANY(SELECT '%' || unnest(p_cities) || '%'))
      AND (p_genders IS NULL OR array_length(p_genders, 1) IS NULL OR 
           fd.entity_data->>'gender' ILIKE ANY(SELECT '%' || unnest(p_genders) || '%'))
      AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'title', fd.entity_data->>'job_title') ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%'))
      AND (v_expanded_seniorities IS NULL OR array_length(v_expanded_seniorities, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'seniority', fd.entity_data->>'title', fd.entity_data->>'job_title') ILIKE ANY(SELECT '%' || unnest(v_expanded_seniorities) || '%'))
      AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR 
           COALESCE(fd.entity_data->>'department', fd.entity_data->>'departments') ILIKE ANY(SELECT '%' || unnest(p_departments) || '%'))
      AND (p_company_sizes IS NULL OR array_length(p_company_sizes, 1) IS NULL OR 
           fd.entity_data->>'employees' ILIKE ANY(SELECT '%' || unnest(p_company_sizes) || '%') OR
           fd.entity_data->>'employee_count' ILIKE ANY(SELECT '%' || unnest(p_company_sizes) || '%') OR
           fd.entity_data->>'company_size' ILIKE ANY(SELECT '%' || unnest(p_company_sizes) || '%'))
      AND (p_revenue_min IS NULL OR (
           CASE 
               WHEN fd.entity_data->>'revenue' ~ '^\d+(\.\d+)?$' THEN (fd.entity_data->>'revenue')::numeric
               WHEN fd.entity_data->>'annual_revenue' ~ '^\d+(\.\d+)?$' THEN (fd.entity_data->>'annual_revenue')::numeric
               ELSE NULL
           END >= p_revenue_min))
      AND (p_revenue_max IS NULL OR (
           CASE 
               WHEN fd.entity_data->>'revenue' ~ '^\d+(\.\d+)?$' THEN (fd.entity_data->>'revenue')::numeric
               WHEN fd.entity_data->>'annual_revenue' ~ '^\d+(\.\d+)?$' THEN (fd.entity_data->>'annual_revenue')::numeric
               ELSE NULL
           END <= p_revenue_max))
      AND (p_has_email IS NULL OR p_has_email = FALSE OR 
           (COALESCE(fd.entity_data->>'email', fd.entity_data->>'work_email', fd.entity_data->>'personal_email', '') <> ''))
      AND (p_has_phone IS NULL OR p_has_phone = FALSE OR 
           (COALESCE(fd.entity_data->>'phone', fd.entity_data->>'mobile_phone', fd.entity_data->>'direct_phone', '') <> ''))
      AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR 
           (COALESCE(fd.entity_data->>'linkedin_url', fd.entity_data->>'linkedin', fd.entity_data->>'company_linkedin_url', '') <> ''))
      AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR 
           (COALESCE(fd.entity_data->>'facebook_url', fd.entity_data->>'facebook', fd.entity_data->>'company_facebook_url', '') <> ''))
      AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR 
           (COALESCE(fd.entity_data->>'twitter_url', fd.entity_data->>'twitter', fd.entity_data->>'company_twitter_url', '') <> ''))
    ORDER BY fd.entity_external_id
    LIMIT COALESCE(p_per_page, 25)
    OFFSET v_offset;
END;
$func$;

-- Add comment to mark this as canonical
COMMENT ON FUNCTION public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], numeric, numeric, boolean, boolean, boolean, boolean, boolean, integer, integer) 
IS 'Canonical search function for free_data table. Uses jsonb entity_data column. Do not create overloads.';