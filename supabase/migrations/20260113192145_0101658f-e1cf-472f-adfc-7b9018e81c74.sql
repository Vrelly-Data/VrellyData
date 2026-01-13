-- Phase 1: Remove legacy overload permanently

-- Drop the legacy overload by its EXACT identity signature (OID 126052)
DROP FUNCTION IF EXISTS public.search_free_data_builder(
  p_entity_type text,
  p_filters jsonb,
  p_has_personal_email boolean,
  p_has_business_email boolean,
  p_has_phone boolean,
  p_has_linkedin boolean,
  p_has_facebook boolean,
  p_has_twitter boolean,
  p_has_company_phone boolean,
  p_has_company_linkedin boolean,
  p_has_company_facebook boolean,
  p_has_company_twitter boolean,
  p_has_company_name boolean,
  p_has_company_website boolean,
  p_has_company_industry boolean,
  p_has_company_size boolean,
  p_has_company_revenue boolean,
  p_has_company_location boolean,
  p_has_job_title boolean,
  p_has_seniority boolean,
  p_has_department boolean,
  p_has_skills boolean,
  p_page integer,
  p_per_page integer,
  p_sort_field text,
  p_sort_direction text,
  p_search_query text
);

-- Invariant check - fail if more than one overload exists
DO $$
DECLARE
  overload_count integer;
BEGIN
  SELECT COUNT(DISTINCT p.oid)
  INTO overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'search_free_data_builder';
  
  IF overload_count > 1 THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: Found % overloads of search_free_data_builder. Only 1 is allowed.', overload_count;
  END IF;
  
  IF overload_count = 0 THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: search_free_data_builder function not found. Something went wrong.';
  END IF;
  
  RAISE NOTICE 'INVARIANT CHECK PASSED: Exactly 1 search_free_data_builder function exists.';
END $$;