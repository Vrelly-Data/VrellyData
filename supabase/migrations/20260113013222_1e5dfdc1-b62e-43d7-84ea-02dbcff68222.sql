-- Create a new version of the search function with correct entity_type ENUM
CREATE OR REPLACE FUNCTION public.search_free_data_with_filters_v2(
  p_entity_type entity_type,
  p_keywords text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority text[] DEFAULT NULL,
  p_department text[] DEFAULT NULL,
  p_company_size text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_person_city text[] DEFAULT NULL,
  p_person_country text[] DEFAULT NULL,
  p_company_city text[] DEFAULT NULL,
  p_company_country text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
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
SET search_path = public
AS $$
DECLARE
  v_total_count bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter (search in multiple fields)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) k
      WHERE fd.entity_data->>'firstName' ILIKE '%' || k || '%'
         OR fd.entity_data->>'lastName' ILIKE '%' || k || '%'
         OR fd.entity_data->>'fullName' ILIKE '%' || k || '%'
         OR fd.entity_data->>'companyName' ILIKE '%' || k || '%'
         OR fd.entity_data->>'name' ILIKE '%' || k || '%'
         OR fd.entity_data->>'jobTitle' ILIKE '%' || k || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    -- Cities filter (legacy, checks both person and company city)
    AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities) OR fd.entity_data->>'companyCity' = ANY(p_cities))
    -- Gender filter
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = p_gender)
    -- Job titles filter
    AND (p_job_titles IS NULL OR fd.entity_data->>'jobTitle' = ANY(p_job_titles))
    -- Seniority filter
    AND (p_seniority IS NULL OR fd.entity_data->>'seniority' = ANY(p_seniority))
    -- Department filter
    AND (p_department IS NULL OR fd.entity_data->>'department' = ANY(p_department))
    -- Company size filter
    AND (p_company_size IS NULL OR fd.entity_data->>'companySize' = ANY(p_company_size))
    -- Net worth filter
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    -- Income filter
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    -- Person city filter
    AND (p_person_city IS NULL OR fd.entity_data->>'city' = ANY(p_person_city))
    -- Person country filter
    AND (p_person_country IS NULL OR fd.entity_data->>'country' = ANY(p_person_country))
    -- Company city filter
    AND (p_company_city IS NULL OR fd.entity_data->>'companyCity' = ANY(p_company_city))
    -- Company country filter
    AND (p_company_country IS NULL OR fd.entity_data->>'companyCountry' = ANY(p_company_country))
    -- Person interests filter
    AND (p_person_interests IS NULL OR fd.entity_data->'interests' ?| p_person_interests)
    -- Person skills filter
    AND (p_person_skills IS NULL OR fd.entity_data->'skills' ?| p_person_skills)
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    -- Prospect data filters for person
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> ''
    ))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '') OR
      (fd.entity_data->>'directNumber' IS NOT NULL AND fd.entity_data->>'directNumber' <> '')
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> '') OR
      (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> '')
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> '') OR
      (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> '')
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> '') OR
      (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> '')
    ))
    -- Prospect data filters for company
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> '') OR
      (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' <> '')
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> '') OR
      (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> '')
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> '') OR
      (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> '')
    ));

  -- Return paginated results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total_count as total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) k
      WHERE fd.entity_data->>'firstName' ILIKE '%' || k || '%'
         OR fd.entity_data->>'lastName' ILIKE '%' || k || '%'
         OR fd.entity_data->>'fullName' ILIKE '%' || k || '%'
         OR fd.entity_data->>'companyName' ILIKE '%' || k || '%'
         OR fd.entity_data->>'name' ILIKE '%' || k || '%'
         OR fd.entity_data->>'jobTitle' ILIKE '%' || k || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    -- Cities filter
    AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities) OR fd.entity_data->>'companyCity' = ANY(p_cities))
    -- Gender filter
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = p_gender)
    -- Job titles filter
    AND (p_job_titles IS NULL OR fd.entity_data->>'jobTitle' = ANY(p_job_titles))
    -- Seniority filter
    AND (p_seniority IS NULL OR fd.entity_data->>'seniority' = ANY(p_seniority))
    -- Department filter
    AND (p_department IS NULL OR fd.entity_data->>'department' = ANY(p_department))
    -- Company size filter
    AND (p_company_size IS NULL OR fd.entity_data->>'companySize' = ANY(p_company_size))
    -- Net worth filter
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    -- Income filter
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    -- Person city filter
    AND (p_person_city IS NULL OR fd.entity_data->>'city' = ANY(p_person_city))
    -- Person country filter
    AND (p_person_country IS NULL OR fd.entity_data->>'country' = ANY(p_person_country))
    -- Company city filter
    AND (p_company_city IS NULL OR fd.entity_data->>'companyCity' = ANY(p_company_city))
    -- Company country filter
    AND (p_company_country IS NULL OR fd.entity_data->>'companyCountry' = ANY(p_company_country))
    -- Person interests filter
    AND (p_person_interests IS NULL OR fd.entity_data->'interests' ?| p_person_interests)
    -- Person skills filter
    AND (p_person_skills IS NULL OR fd.entity_data->'skills' ?| p_person_skills)
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    -- Prospect data filters for person
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> ''
    ))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '') OR
      (fd.entity_data->>'directNumber' IS NOT NULL AND fd.entity_data->>'directNumber' <> '')
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> '') OR
      (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> '')
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> '') OR
      (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> '')
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> '') OR
      (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> '')
    ))
    -- Prospect data filters for company
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> '') OR
      (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' <> '')
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> '') OR
      (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> '')
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> '') OR
      (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> '')
    ))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;