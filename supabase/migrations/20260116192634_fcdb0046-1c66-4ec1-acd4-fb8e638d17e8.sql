-- Emergency restore: recreate canonical search_free_data_builder with correct enum type
-- This migration ensures exactly ONE function with 28 parameters

-- Step 1: Drop ALL existing versions of this function (including any overloads)
DO $$
DECLARE
  func_record RECORD;
BEGIN
  FOR func_record IN 
    SELECT p.oid::regprocedure::text AS func_signature
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'search_free_data_builder'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.func_signature || ' CASCADE';
  END LOOP;
END $$;

-- Step 2: Recreate the ONE canonical function (28 params, enum type for entity_type)
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type public.entity_type DEFAULT 'person'::public.entity_type,
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
  p_technologies text[] DEFAULT NULL,
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
RETURNS TABLE(
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
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter (search in multiple text fields)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE (fd.entity_data->>'firstName' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'lastName' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'title' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'company' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'companyName' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'industry' ILIKE '%' || kw || '%')
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter
    AND (p_seniority_levels IS NULL OR (fd.entity_data->>'seniority') = ANY(p_seniority_levels))
    -- Company size filter (supports ranges like "1-10", "11-50", etc.)
    AND (p_company_size_ranges IS NULL OR (fd.entity_data->>'employeeCount') = ANY(p_company_size_ranges)
         OR (fd.entity_data->>'companySize') = ANY(p_company_size_ranges))
    -- Industries filter
    AND (p_industries IS NULL OR (fd.entity_data->>'industry') = ANY(p_industries))
    -- Countries filter
    AND (p_countries IS NULL OR (fd.entity_data->>'country') = ANY(p_countries)
         OR (fd.entity_data->>'companyCountry') = ANY(p_countries))
    -- Cities filter
    AND (p_cities IS NULL OR (fd.entity_data->>'city') = ANY(p_cities)
         OR (fd.entity_data->>'companyCity') = ANY(p_cities))
    -- Gender filter
    AND (p_gender IS NULL OR (fd.entity_data->>'gender') = ANY(p_gender))
    -- Net worth filter
    AND (p_net_worth IS NULL OR (fd.entity_data->>'netWorth') = ANY(p_net_worth))
    -- Income filter
    AND (p_income IS NULL OR (fd.entity_data->>'income') = ANY(p_income))
    -- Departments filter
    AND (p_departments IS NULL OR (fd.entity_data->>'department') = ANY(p_departments))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR (fd.entity_data->>'companyRevenue') = ANY(p_company_revenue))
    -- Person interests filter
    AND (p_person_interests IS NULL OR (
      fd.entity_data->'interests' IS NOT NULL 
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'interests') interest
        WHERE interest = ANY(p_person_interests)
      )
    ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR (
      fd.entity_data->'skills' IS NOT NULL 
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'skills') skill
        WHERE skill = ANY(p_person_skills)
      )
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR (
      fd.entity_data->'technologies' IS NOT NULL 
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'technologies') tech
        WHERE tech = ANY(p_technologies)
      )
    ))
    -- Prospect data filters (check for non-null, non-empty values)
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (
      COALESCE(fd.entity_data->>'personalEmail', fd.entity_data->>'email', '') <> ''
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (
      COALESCE(fd.entity_data->>'businessEmail', fd.entity_data->>'workEmail', '') <> ''
    ))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
      COALESCE(fd.entity_data->>'phone', fd.entity_data->>'directPhone', fd.entity_data->>'mobilePhone', '') <> ''
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
      COALESCE(fd.entity_data->>'linkedin', fd.entity_data->>'linkedinUrl', '') <> ''
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (
      COALESCE(fd.entity_data->>'facebook', fd.entity_data->>'facebookUrl', '') <> ''
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (
      COALESCE(fd.entity_data->>'twitter', fd.entity_data->>'twitterUrl', '') <> ''
    ))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (
      COALESCE(fd.entity_data->>'companyPhone', '') <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (
      COALESCE(fd.entity_data->>'companyLinkedin', fd.entity_data->>'companyLinkedinUrl', '') <> ''
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (
      COALESCE(fd.entity_data->>'companyFacebook', fd.entity_data->>'companyFacebookUrl', '') <> ''
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (
      COALESCE(fd.entity_data->>'companyTwitter', fd.entity_data->>'companyTwitterUrl', '') <> ''
    ));

  -- Return paginated results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total AS total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE (fd.entity_data->>'firstName' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'lastName' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'title' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'company' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'companyName' ILIKE '%' || kw || '%')
         OR (fd.entity_data->>'industry' ILIKE '%' || kw || '%')
    ))
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    AND (p_seniority_levels IS NULL OR (fd.entity_data->>'seniority') = ANY(p_seniority_levels))
    AND (p_company_size_ranges IS NULL OR (fd.entity_data->>'employeeCount') = ANY(p_company_size_ranges)
         OR (fd.entity_data->>'companySize') = ANY(p_company_size_ranges))
    AND (p_industries IS NULL OR (fd.entity_data->>'industry') = ANY(p_industries))
    AND (p_countries IS NULL OR (fd.entity_data->>'country') = ANY(p_countries)
         OR (fd.entity_data->>'companyCountry') = ANY(p_countries))
    AND (p_cities IS NULL OR (fd.entity_data->>'city') = ANY(p_cities)
         OR (fd.entity_data->>'companyCity') = ANY(p_cities))
    AND (p_gender IS NULL OR (fd.entity_data->>'gender') = ANY(p_gender))
    AND (p_net_worth IS NULL OR (fd.entity_data->>'netWorth') = ANY(p_net_worth))
    AND (p_income IS NULL OR (fd.entity_data->>'income') = ANY(p_income))
    AND (p_departments IS NULL OR (fd.entity_data->>'department') = ANY(p_departments))
    AND (p_company_revenue IS NULL OR (fd.entity_data->>'companyRevenue') = ANY(p_company_revenue))
    AND (p_person_interests IS NULL OR (
      fd.entity_data->'interests' IS NOT NULL 
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'interests') interest
        WHERE interest = ANY(p_person_interests)
      )
    ))
    AND (p_person_skills IS NULL OR (
      fd.entity_data->'skills' IS NOT NULL 
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'skills') skill
        WHERE skill = ANY(p_person_skills)
      )
    ))
    AND (p_technologies IS NULL OR (
      fd.entity_data->'technologies' IS NOT NULL 
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'technologies') tech
        WHERE tech = ANY(p_technologies)
      )
    ))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (
      COALESCE(fd.entity_data->>'personalEmail', fd.entity_data->>'email', '') <> ''
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (
      COALESCE(fd.entity_data->>'businessEmail', fd.entity_data->>'workEmail', '') <> ''
    ))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
      COALESCE(fd.entity_data->>'phone', fd.entity_data->>'directPhone', fd.entity_data->>'mobilePhone', '') <> ''
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
      COALESCE(fd.entity_data->>'linkedin', fd.entity_data->>'linkedinUrl', '') <> ''
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (
      COALESCE(fd.entity_data->>'facebook', fd.entity_data->>'facebookUrl', '') <> ''
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (
      COALESCE(fd.entity_data->>'twitter', fd.entity_data->>'twitterUrl', '') <> ''
    ))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (
      COALESCE(fd.entity_data->>'companyPhone', '') <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (
      COALESCE(fd.entity_data->>'companyLinkedin', fd.entity_data->>'companyLinkedinUrl', '') <> ''
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (
      COALESCE(fd.entity_data->>'companyFacebook', fd.entity_data->>'companyFacebookUrl', '') <> ''
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (
      COALESCE(fd.entity_data->>'companyTwitter', fd.entity_data->>'companyTwitterUrl', '') <> ''
    ))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;