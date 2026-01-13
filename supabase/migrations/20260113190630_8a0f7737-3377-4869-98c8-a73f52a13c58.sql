
-- Drop ALL existing overloads of search_free_data_builder
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, text[], text[], text[], text[], text, text[], text[], text[], text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, jsonb, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, text, text, text);

-- Create the SINGLE canonical search_free_data_builder function
-- This is the version the UI calls with p_keywords text[], p_limit, p_offset
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT NULL,
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
RETURNS TABLE(entity_external_id text, entity_data jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
BEGIN
  -- First, get the total count with filters applied
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE
    -- FIXED: Cast p_entity_type to entity_type enum
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    -- Keywords: search in multiple text fields
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'bio' ILIKE '%' || kw || '%'
    ))
    -- Job titles
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- Seniority levels
    AND (p_seniority_levels IS NULL OR fd.entity_data->>'seniority' = ANY(p_seniority_levels))
    -- Company size ranges
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'companySize' = ANY(p_company_size_ranges))
    -- Industries
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    -- Countries
    AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries) OR fd.entity_data->>'companyCountry' = ANY(p_countries))
    -- Cities
    AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities) OR fd.entity_data->>'companyCity' = ANY(p_cities))
    -- Gender
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    -- Net worth
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    -- Income
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    -- Departments
    AND (p_departments IS NULL OR fd.entity_data->>'department' = ANY(p_departments))
    -- Company revenue
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    -- Person interests
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'interests') interest
      WHERE interest = ANY(p_person_interests)
    ))
    -- Person skills
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'skills') skill
      WHERE skill = ANY(p_person_skills)
    ))
    -- PROSPECT DATA FILTERS
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> '')
      OR (fd.entity_data->'personalEmails' IS NOT NULL AND jsonb_array_length(fd.entity_data->'personalEmails') > 0)
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> '')
      OR (fd.entity_data->'businessEmails' IS NOT NULL AND jsonb_array_length(fd.entity_data->'businessEmails') > 0)
      OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> '')
    ))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '')
      OR (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' <> '')
      OR (fd.entity_data->'phones' IS NOT NULL AND jsonb_array_length(fd.entity_data->'phones') > 0)
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> '')
      OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> '')
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> '')
      OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> '')
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> '')
      OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> '')
    ))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> '')
      OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' <> '')
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> '')
      OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> '')
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> '')
      OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> '')
    ));

  -- Return the paginated results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE
    -- FIXED: Cast p_entity_type to entity_type enum
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    -- Keywords: search in multiple text fields
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'bio' ILIKE '%' || kw || '%'
    ))
    -- Job titles
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- Seniority levels
    AND (p_seniority_levels IS NULL OR fd.entity_data->>'seniority' = ANY(p_seniority_levels))
    -- Company size ranges
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'companySize' = ANY(p_company_size_ranges))
    -- Industries
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    -- Countries
    AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries) OR fd.entity_data->>'companyCountry' = ANY(p_countries))
    -- Cities
    AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities) OR fd.entity_data->>'companyCity' = ANY(p_cities))
    -- Gender
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    -- Net worth
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    -- Income
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    -- Departments
    AND (p_departments IS NULL OR fd.entity_data->>'department' = ANY(p_departments))
    -- Company revenue
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    -- Person interests
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'interests') interest
      WHERE interest = ANY(p_person_interests)
    ))
    -- Person skills
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'skills') skill
      WHERE skill = ANY(p_person_skills)
    ))
    -- PROSPECT DATA FILTERS
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> '')
      OR (fd.entity_data->'personalEmails' IS NOT NULL AND jsonb_array_length(fd.entity_data->'personalEmails') > 0)
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> '')
      OR (fd.entity_data->'businessEmails' IS NOT NULL AND jsonb_array_length(fd.entity_data->'businessEmails') > 0)
      OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> '')
    ))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '')
      OR (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' <> '')
      OR (fd.entity_data->'phones' IS NOT NULL AND jsonb_array_length(fd.entity_data->'phones') > 0)
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> '')
      OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> '')
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> '')
      OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> '')
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> '')
      OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> '')
    ))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> '')
      OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' <> '')
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> '')
      OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> '')
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> '')
      OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> '')
    ))
  ORDER BY fd.entity_data->>'lastName', fd.entity_data->>'firstName'
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Add comment to prevent future duplicate overloads
COMMENT ON FUNCTION public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer) IS 'CANONICAL Builder function. Do not create overloads; use new function names if different signature needed.';
