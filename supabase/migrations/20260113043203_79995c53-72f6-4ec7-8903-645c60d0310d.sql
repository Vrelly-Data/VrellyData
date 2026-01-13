
-- ============================================================
-- HARD RESET: Drop all overloads and recreate canonical function
-- ============================================================

-- Step 1: Drop ALL existing overloads of search_free_data_builder
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_free_data_builder'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- Step 2: Create the CANONICAL function matching useFreeDataSearch.ts exactly
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text,
  p_keywords text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_company_size_ranges text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  entity_external_id text,
  entity_data jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  -- Count total matching records first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Keywords filter (search in multiple fields)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE fd.entity_data->>'company_name' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'full_name' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter (with expansion for common terms)
    AND (p_seniority_levels IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE fd.entity_data->>'seniority' ILIKE '%' || sl || '%'
         OR (sl ILIKE '%c-suite%' AND fd.entity_data->>'seniority' ILIKE '%chief%')
         OR (sl ILIKE '%vp%' AND fd.entity_data->>'seniority' ILIKE '%vice president%')
         OR (sl ILIKE '%director%' AND fd.entity_data->>'seniority' ILIKE '%director%')
         OR (sl ILIKE '%manager%' AND fd.entity_data->>'seniority' ILIKE '%manager%')
         OR (sl ILIKE '%senior%' AND fd.entity_data->>'seniority' ILIKE '%senior%')
         OR (sl ILIKE '%entry%' AND fd.entity_data->>'seniority' ILIKE '%entry%')
    ))
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) cs
      WHERE fd.entity_data->>'employee_count_range' ILIKE '%' || cs || '%'
         OR fd.entity_data->>'company_size' ILIKE '%' || cs || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) co
      WHERE fd.entity_data->>'country' ILIKE '%' || co || '%'
         OR fd.entity_data->>'person_country' ILIKE '%' || co || '%'
         OR fd.entity_data->>'company_country' ILIKE '%' || co || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) ci
      WHERE fd.entity_data->>'city' ILIKE '%' || ci || '%'
         OR fd.entity_data->>'person_city' ILIKE '%' || ci || '%'
         OR fd.entity_data->>'company_city' ILIKE '%' || ci || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE fd.entity_data->>'gender' ILIKE g || '%'
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'net_worth' ILIKE '%' || nw || '%'
    ))
    -- Income filter
    AND (p_income IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    -- Departments filter
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dep
      WHERE fd.entity_data->>'department' ILIKE '%' || dep || '%'
    ))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE fd.entity_data->>'revenue' ILIKE '%' || rev || '%'
         OR fd.entity_data->>'company_revenue' ILIKE '%' || rev || '%'
    ))
    -- Person interests filter
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) pi
      WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
    ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) ps
      WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
    ))
    -- Prospect data availability filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (fd.entity_data->>'personal_email' IS NOT NULL AND fd.entity_data->>'personal_email' <> ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (fd.entity_data->>'business_email' IS NOT NULL AND fd.entity_data->>'business_email' <> ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '') OR (fd.entity_data->>'mobile_phone' IS NOT NULL AND fd.entity_data->>'mobile_phone' <> ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedin_url' IS NOT NULL AND fd.entity_data->>'linkedin_url' <> ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (fd.entity_data->>'facebook_url' IS NOT NULL AND fd.entity_data->>'facebook_url' <> ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (fd.entity_data->>'twitter_url' IS NOT NULL AND fd.entity_data->>'twitter_url' <> ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (fd.entity_data->>'company_phone' IS NOT NULL AND fd.entity_data->>'company_phone' <> ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'company_linkedin_url' IS NOT NULL AND fd.entity_data->>'company_linkedin_url' <> ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (fd.entity_data->>'company_facebook_url' IS NOT NULL AND fd.entity_data->>'company_facebook_url' <> ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (fd.entity_data->>'company_twitter_url' IS NOT NULL AND fd.entity_data->>'company_twitter_url' <> ''));

  -- Return paginated results with total_count in every row
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total AS total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Keywords filter
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE fd.entity_data->>'company_name' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'full_name' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter
    AND (p_seniority_levels IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE fd.entity_data->>'seniority' ILIKE '%' || sl || '%'
         OR (sl ILIKE '%c-suite%' AND fd.entity_data->>'seniority' ILIKE '%chief%')
         OR (sl ILIKE '%vp%' AND fd.entity_data->>'seniority' ILIKE '%vice president%')
         OR (sl ILIKE '%director%' AND fd.entity_data->>'seniority' ILIKE '%director%')
         OR (sl ILIKE '%manager%' AND fd.entity_data->>'seniority' ILIKE '%manager%')
         OR (sl ILIKE '%senior%' AND fd.entity_data->>'seniority' ILIKE '%senior%')
         OR (sl ILIKE '%entry%' AND fd.entity_data->>'seniority' ILIKE '%entry%')
    ))
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) cs
      WHERE fd.entity_data->>'employee_count_range' ILIKE '%' || cs || '%'
         OR fd.entity_data->>'company_size' ILIKE '%' || cs || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) co
      WHERE fd.entity_data->>'country' ILIKE '%' || co || '%'
         OR fd.entity_data->>'person_country' ILIKE '%' || co || '%'
         OR fd.entity_data->>'company_country' ILIKE '%' || co || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) ci
      WHERE fd.entity_data->>'city' ILIKE '%' || ci || '%'
         OR fd.entity_data->>'person_city' ILIKE '%' || ci || '%'
         OR fd.entity_data->>'company_city' ILIKE '%' || ci || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE fd.entity_data->>'gender' ILIKE g || '%'
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'net_worth' ILIKE '%' || nw || '%'
    ))
    -- Income filter
    AND (p_income IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    -- Departments filter
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dep
      WHERE fd.entity_data->>'department' ILIKE '%' || dep || '%'
    ))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE fd.entity_data->>'revenue' ILIKE '%' || rev || '%'
         OR fd.entity_data->>'company_revenue' ILIKE '%' || rev || '%'
    ))
    -- Person interests filter
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) pi
      WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
    ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) ps
      WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
    ))
    -- Prospect data availability filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (fd.entity_data->>'personal_email' IS NOT NULL AND fd.entity_data->>'personal_email' <> ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (fd.entity_data->>'business_email' IS NOT NULL AND fd.entity_data->>'business_email' <> ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '') OR (fd.entity_data->>'mobile_phone' IS NOT NULL AND fd.entity_data->>'mobile_phone' <> ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedin_url' IS NOT NULL AND fd.entity_data->>'linkedin_url' <> ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (fd.entity_data->>'facebook_url' IS NOT NULL AND fd.entity_data->>'facebook_url' <> ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (fd.entity_data->>'twitter_url' IS NOT NULL AND fd.entity_data->>'twitter_url' <> ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (fd.entity_data->>'company_phone' IS NOT NULL AND fd.entity_data->>'company_phone' <> ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'company_linkedin_url' IS NOT NULL AND fd.entity_data->>'company_linkedin_url' <> ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (fd.entity_data->>'company_facebook_url' IS NOT NULL AND fd.entity_data->>'company_facebook_url' <> ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (fd.entity_data->>'company_twitter_url' IS NOT NULL AND fd.entity_data->>'company_twitter_url' <> ''))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Add comment to mark as canonical
COMMENT ON FUNCTION public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer) 
IS 'CANONICAL Builder search function - matches useFreeDataSearch.ts exactly. Do not create overloads.';

-- Force schema cache refresh
NOTIFY pgrst, 'reload schema';
