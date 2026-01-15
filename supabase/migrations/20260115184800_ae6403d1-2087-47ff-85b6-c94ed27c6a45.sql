-- Fix Personal LinkedIn filter to check both 'linkedin' and 'linkedinUrl' field names
-- This is a targeted fix that ONLY modifies the p_has_linkedin check (2 locations)
-- Using CREATE OR REPLACE to update the existing function (no duplicates created)

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT 'person',
  p_keywords text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_company_size_ranges text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_technologies text[] DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(entity_data jsonb, entity_external_id text, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_total bigint;
BEGIN
  -- First, get the total count
  SELECT count(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Keywords filter: search across multiple text fields
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'lastName' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'fullName' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'title' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'headline' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'summary' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'bio' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'skills' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'interests' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'companyName' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'company' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'organization' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'industry' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'city' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'state' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'country' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'location' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'department' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'education' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'name' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'description' ILIKE '%' || kw || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE 
        fd.entity_data->>'title' ILIKE '%' || jt || '%' OR
        fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%' OR
        fd.entity_data->>'headline' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter using the helper function
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR 
      title_matches_seniority(
        p_seniority_levels,
        coalesce(fd.entity_data->>'title', fd.entity_data->>'jobTitle', fd.entity_data->>'headline', '')
      )
    )
    -- Department filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        fd.entity_data->>'department' ILIKE '%' || dept || '%' OR
        fd.entity_data->>'title' ILIKE '%' || dept || '%' OR
        fd.entity_data->>'jobTitle' ILIKE '%' || dept || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE 
        fd.entity_data->>'industry' ILIKE '%' || ind || '%' OR
        fd.entity_data->>'companyIndustry' ILIKE '%' || ind || '%'
    ))
    -- Company size filter with range parsing
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE (
        CASE 
          WHEN size_range = '1-10' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 1 AND 10
          WHEN size_range = '11-50' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 11 AND 50
          WHEN size_range = '51-200' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 51 AND 200
          WHEN size_range = '201-500' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 201 AND 500
          WHEN size_range = '501-1000' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 501 AND 1000
          WHEN size_range = '1001-5000' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 1001 AND 5000
          WHEN size_range = '5001-10000' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 5001 AND 10000
          WHEN size_range = '10001+' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) > 10000
          ELSE false
        END
      )
    ))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE 
        fd.entity_data->>'revenue' ILIKE '%' || rev || '%' OR
        fd.entity_data->>'companyRevenue' ILIKE '%' || rev || '%' OR
        fd.entity_data->>'annualRevenue' ILIKE '%' || rev || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) country
      WHERE 
        fd.entity_data->>'country' ILIKE '%' || country || '%' OR
        fd.entity_data->>'location' ILIKE '%' || country || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) city
      WHERE 
        fd.entity_data->>'city' ILIKE '%' || city || '%' OR
        fd.entity_data->>'location' ILIKE '%' || city || '%'
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE 
        fd.entity_data->>'technologies' ILIKE '%' || tech || '%' OR
        fd.entity_data->>'techStack' ILIKE '%' || tech || '%' OR
        fd.entity_data->>'skills' ILIKE '%' || tech || '%'
    ))
    -- Prospect data filters - FIXED: check both 'linkedin' and 'linkedinUrl' field names
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         coalesce(fd.entity_data->>'linkedin', '') <> '' OR
         coalesce(fd.entity_data->>'linkedinUrl', '') <> '')
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         coalesce(fd.entity_data->>'phone', '') <> '' OR 
         coalesce(fd.entity_data->>'phoneNumber', '') <> '' OR
         coalesce(fd.entity_data->>'mobilePhone', '') <> '')
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         coalesce(fd.entity_data->>'personalEmail', '') <> '' OR
         coalesce(fd.entity_data->>'email', '') <> '')
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         coalesce(fd.entity_data->>'workEmail', '') <> '' OR
         coalesce(fd.entity_data->>'businessEmail', '') <> '' OR
         coalesce(fd.entity_data->>'corporateEmail', '') <> '')
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         coalesce(fd.entity_data->>'facebook', '') <> '' OR
         coalesce(fd.entity_data->>'facebookUrl', '') <> '')
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         coalesce(fd.entity_data->>'twitter', '') <> '' OR
         coalesce(fd.entity_data->>'twitterUrl', '') <> '')
    -- Company social filters
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         coalesce(fd.entity_data->>'companyLinkedin', '') <> '' OR
         coalesce(fd.entity_data->>'companyLinkedinUrl', '') <> '')
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         coalesce(fd.entity_data->>'companyPhone', '') <> '')
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         coalesce(fd.entity_data->>'companyFacebook', '') <> '' OR
         coalesce(fd.entity_data->>'companyFacebookUrl', '') <> '')
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         coalesce(fd.entity_data->>'companyTwitter', '') <> '' OR
         coalesce(fd.entity_data->>'companyTwitterUrl', '') <> '')
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         fd.entity_data->>'gender' = ANY(p_gender))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
    ))
    -- Skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill
      WHERE fd.entity_data->>'skills' ILIKE '%' || skill || '%'
    ))
    -- Interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ));

  -- Return paginated results with total count
  RETURN QUERY
  SELECT 
    fd.entity_data,
    fd.entity_external_id,
    v_total as total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Keywords filter: search across multiple text fields
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'lastName' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'fullName' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'title' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'headline' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'summary' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'bio' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'skills' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'interests' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'companyName' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'company' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'organization' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'industry' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'city' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'state' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'country' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'location' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'department' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'education' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'name' ILIKE '%' || kw || '%' OR
        fd.entity_data->>'description' ILIKE '%' || kw || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE 
        fd.entity_data->>'title' ILIKE '%' || jt || '%' OR
        fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%' OR
        fd.entity_data->>'headline' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter using the helper function
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR 
      title_matches_seniority(
        p_seniority_levels,
        coalesce(fd.entity_data->>'title', fd.entity_data->>'jobTitle', fd.entity_data->>'headline', '')
      )
    )
    -- Department filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        fd.entity_data->>'department' ILIKE '%' || dept || '%' OR
        fd.entity_data->>'title' ILIKE '%' || dept || '%' OR
        fd.entity_data->>'jobTitle' ILIKE '%' || dept || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE 
        fd.entity_data->>'industry' ILIKE '%' || ind || '%' OR
        fd.entity_data->>'companyIndustry' ILIKE '%' || ind || '%'
    ))
    -- Company size filter with range parsing
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE (
        CASE 
          WHEN size_range = '1-10' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 1 AND 10
          WHEN size_range = '11-50' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 11 AND 50
          WHEN size_range = '51-200' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 51 AND 200
          WHEN size_range = '201-500' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 201 AND 500
          WHEN size_range = '501-1000' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 501 AND 1000
          WHEN size_range = '1001-5000' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 1001 AND 5000
          WHEN size_range = '5001-10000' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) BETWEEN 5001 AND 10000
          WHEN size_range = '10001+' THEN 
            parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', fd.entity_data->>'employees', '0')) > 10000
          ELSE false
        END
      )
    ))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE 
        fd.entity_data->>'revenue' ILIKE '%' || rev || '%' OR
        fd.entity_data->>'companyRevenue' ILIKE '%' || rev || '%' OR
        fd.entity_data->>'annualRevenue' ILIKE '%' || rev || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) country
      WHERE 
        fd.entity_data->>'country' ILIKE '%' || country || '%' OR
        fd.entity_data->>'location' ILIKE '%' || country || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) city
      WHERE 
        fd.entity_data->>'city' ILIKE '%' || city || '%' OR
        fd.entity_data->>'location' ILIKE '%' || city || '%'
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE 
        fd.entity_data->>'technologies' ILIKE '%' || tech || '%' OR
        fd.entity_data->>'techStack' ILIKE '%' || tech || '%' OR
        fd.entity_data->>'skills' ILIKE '%' || tech || '%'
    ))
    -- Prospect data filters - FIXED: check both 'linkedin' and 'linkedinUrl' field names
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         coalesce(fd.entity_data->>'linkedin', '') <> '' OR
         coalesce(fd.entity_data->>'linkedinUrl', '') <> '')
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         coalesce(fd.entity_data->>'phone', '') <> '' OR 
         coalesce(fd.entity_data->>'phoneNumber', '') <> '' OR
         coalesce(fd.entity_data->>'mobilePhone', '') <> '')
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         coalesce(fd.entity_data->>'personalEmail', '') <> '' OR
         coalesce(fd.entity_data->>'email', '') <> '')
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         coalesce(fd.entity_data->>'workEmail', '') <> '' OR
         coalesce(fd.entity_data->>'businessEmail', '') <> '' OR
         coalesce(fd.entity_data->>'corporateEmail', '') <> '')
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         coalesce(fd.entity_data->>'facebook', '') <> '' OR
         coalesce(fd.entity_data->>'facebookUrl', '') <> '')
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         coalesce(fd.entity_data->>'twitter', '') <> '' OR
         coalesce(fd.entity_data->>'twitterUrl', '') <> '')
    -- Company social filters
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         coalesce(fd.entity_data->>'companyLinkedin', '') <> '' OR
         coalesce(fd.entity_data->>'companyLinkedinUrl', '') <> '')
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         coalesce(fd.entity_data->>'companyPhone', '') <> '')
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         coalesce(fd.entity_data->>'companyFacebook', '') <> '' OR
         coalesce(fd.entity_data->>'companyFacebookUrl', '') <> '')
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         coalesce(fd.entity_data->>'companyTwitter', '') <> '' OR
         coalesce(fd.entity_data->>'companyTwitterUrl', '') <> '')
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         fd.entity_data->>'gender' = ANY(p_gender))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
    ))
    -- Skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill
      WHERE fd.entity_data->>'skills' ILIKE '%' || skill || '%'
    ))
    -- Interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))
  ORDER BY fd.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;