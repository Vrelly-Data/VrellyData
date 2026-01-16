
-- Fix Seniority Normalization in search_free_data_builder
-- UI sends: C-Level, Vice President, VP, Director, Manager, Founder, Individual Contributor
-- DB stores: C suite, Cxo, Vp, Director, Founder

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT 'person',
  p_keywords text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_company_size_ranges text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
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
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(entity_external_id text, entity_data jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_all_sizes_selected boolean := false;
  v_all_revenues_selected boolean := false;
BEGIN
  -- Check if all company sizes are selected (bypass filter)
  IF p_company_size_ranges IS NOT NULL AND array_length(p_company_size_ranges, 1) >= 8 THEN
    v_all_sizes_selected := true;
  END IF;

  -- Check if all revenues are selected (bypass filter)
  IF p_company_revenue IS NOT NULL AND array_length(p_company_revenue, 1) >= 7 THEN
    v_all_revenues_selected := true;
  END IF;

  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Keywords filter: search across multiple fields
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'name' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'email' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'businessEmail' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'personalEmail' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'domain' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'website' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'city' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'state' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'country' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'companyCity' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'companyState' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'companyCountry' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'skills' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'interests' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'technologies' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'keywords' ILIKE '%' || kw || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
         OR fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter with FIXED normalization (UI values -> DB values)
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) usl
      WHERE 
        -- C-Level -> matches "C suite" and "Cxo"
        (lower(usl) IN ('c-level', 'c-suite', 'c level', 'csuite') 
          AND lower(COALESCE(fd.entity_data->>'seniority', '')) IN ('c suite', 'c-suite', 'csuite', 'cxo', 'c level', 'c-level', 'chief'))
        -- Vice President / VP -> matches "Vp"
        OR (lower(usl) IN ('vp', 'vice president', 'vice-president') 
          AND lower(COALESCE(fd.entity_data->>'seniority', '')) IN ('vp', 'vice president', 'vice-president', 'v.p.', 'vice pres'))
        -- Director -> matches "Director"
        OR (lower(usl) = 'director' 
          AND lower(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%director%')
        -- Manager -> matches manager in seniority or title
        OR (lower(usl) = 'manager' 
          AND (lower(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%manager%'
               OR lower(COALESCE(fd.entity_data->>'title', '')) ILIKE '%manager%'))
        -- Founder -> matches "Founder"
        OR (lower(usl) = 'founder' 
          AND (lower(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%founder%'
               OR lower(COALESCE(fd.entity_data->>'title', '')) ILIKE '%founder%'))
        -- Head of -> matches head in title
        OR (lower(usl) IN ('head of', 'head') 
          AND lower(COALESCE(fd.entity_data->>'title', '')) ILIKE '%head of%')
        -- President -> matches president
        OR (lower(usl) = 'president' 
          AND lower(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%president%')
        -- Individual Contributor -> exclude executive titles
        OR (lower(usl) IN ('individual contributor', 'ic', 'entry level', 'entry-level')
          AND (fd.entity_data->>'seniority' IS NULL 
               OR lower(fd.entity_data->>'seniority') NOT IN ('c suite', 'cxo', 'vp', 'director', 'founder')))
    ))
    -- Departments filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        (lower(dept) IN ('c-suite', 'csuite', 'c suite', 'executive') 
          AND (lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%executive%'
               OR lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%c-suite%'
               OR lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%leadership%'
               OR lower(COALESCE(fd.entity_data->>'seniority', '')) IN ('c suite', 'cxo')))
        OR (lower(dept) = 'engineering' 
          AND (lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%engineer%'
               OR lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%development%'
               OR lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%technical%'))
        OR (lower(dept) NOT IN ('c-suite', 'csuite', 'c suite', 'executive', 'engineering')
          AND lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%' || dept || '%')
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Company size filter with bypass logic
    AND (v_all_sizes_selected OR p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) csr
      WHERE (
        CASE 
          WHEN csr = '1-10' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 1 AND 10
          WHEN csr = '11-50' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 11 AND 50
          WHEN csr = '51-200' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 51 AND 200
          WHEN csr = '201-500' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 201 AND 500
          WHEN csr = '501-1000' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 501 AND 1000
          WHEN csr = '1001-5000' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 1001 AND 5000
          WHEN csr = '5001-10000' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 5001 AND 10000
          WHEN csr = '10001+' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) > 10000
          ELSE false
        END
      )
    ))
    -- Company revenue filter with bypass logic
    AND (v_all_revenues_selected OR p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE (
        CASE 
          WHEN cr = 'Under $1M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) < 1000000
          WHEN cr = '$1M-$10M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 1000000 AND 10000000
          WHEN cr = '$10M-$50M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 10000001 AND 50000000
          WHEN cr = '$50M-$100M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 50000001 AND 100000000
          WHEN cr = '$100M-$500M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 100000001 AND 500000000
          WHEN cr = '$500M-$1B' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 500000001 AND 1000000000
          WHEN cr = 'Over $1B' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) > 1000000000
          ELSE false
        END
      )
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) ct
      WHERE fd.entity_data->>'city' ILIKE '%' || ct || '%'
         OR fd.entity_data->>'companyCity' ILIKE '%' || ct || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) co
      WHERE fd.entity_data->>'country' ILIKE '%' || co || '%'
         OR fd.entity_data->>'companyCountry' ILIKE '%' || co || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE lower(fd.entity_data->>'gender') = lower(g)
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
         OR fd.entity_data->>'netWorthRange' ILIKE '%' || nw || '%'
    ))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'incomeRange' ILIKE '%' || inc || '%'
         OR fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    -- Person interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) pi
      WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
    ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) ps
      WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    -- Prospect data filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') OR
         (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
         (fd.entity_data->>'directNumber' IS NOT NULL AND fd.entity_data->>'directNumber' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != '') OR
         (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' != ''));

  -- Return results
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Keywords filter: search across multiple fields
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'name' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'email' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'businessEmail' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'personalEmail' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'domain' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'website' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'city' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'state' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'country' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'companyCity' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'companyState' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'companyCountry' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'skills' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'interests' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'technologies' ILIKE '%' || kw || '%'
         OR fd.entity_data->>'keywords' ILIKE '%' || kw || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
         OR fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter with FIXED normalization (UI values -> DB values)
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) usl
      WHERE 
        -- C-Level -> matches "C suite" and "Cxo"
        (lower(usl) IN ('c-level', 'c-suite', 'c level', 'csuite') 
          AND lower(COALESCE(fd.entity_data->>'seniority', '')) IN ('c suite', 'c-suite', 'csuite', 'cxo', 'c level', 'c-level', 'chief'))
        -- Vice President / VP -> matches "Vp"
        OR (lower(usl) IN ('vp', 'vice president', 'vice-president') 
          AND lower(COALESCE(fd.entity_data->>'seniority', '')) IN ('vp', 'vice president', 'vice-president', 'v.p.', 'vice pres'))
        -- Director -> matches "Director"
        OR (lower(usl) = 'director' 
          AND lower(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%director%')
        -- Manager -> matches manager in seniority or title
        OR (lower(usl) = 'manager' 
          AND (lower(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%manager%'
               OR lower(COALESCE(fd.entity_data->>'title', '')) ILIKE '%manager%'))
        -- Founder -> matches "Founder"
        OR (lower(usl) = 'founder' 
          AND (lower(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%founder%'
               OR lower(COALESCE(fd.entity_data->>'title', '')) ILIKE '%founder%'))
        -- Head of -> matches head in title
        OR (lower(usl) IN ('head of', 'head') 
          AND lower(COALESCE(fd.entity_data->>'title', '')) ILIKE '%head of%')
        -- President -> matches president
        OR (lower(usl) = 'president' 
          AND lower(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%president%')
        -- Individual Contributor -> exclude executive titles
        OR (lower(usl) IN ('individual contributor', 'ic', 'entry level', 'entry-level')
          AND (fd.entity_data->>'seniority' IS NULL 
               OR lower(fd.entity_data->>'seniority') NOT IN ('c suite', 'cxo', 'vp', 'director', 'founder')))
    ))
    -- Departments filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        (lower(dept) IN ('c-suite', 'csuite', 'c suite', 'executive') 
          AND (lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%executive%'
               OR lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%c-suite%'
               OR lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%leadership%'
               OR lower(COALESCE(fd.entity_data->>'seniority', '')) IN ('c suite', 'cxo')))
        OR (lower(dept) = 'engineering' 
          AND (lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%engineer%'
               OR lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%development%'
               OR lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%technical%'))
        OR (lower(dept) NOT IN ('c-suite', 'csuite', 'c suite', 'executive', 'engineering')
          AND lower(COALESCE(fd.entity_data->>'department', '')) ILIKE '%' || dept || '%')
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Company size filter with bypass logic
    AND (v_all_sizes_selected OR p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) csr
      WHERE (
        CASE 
          WHEN csr = '1-10' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 1 AND 10
          WHEN csr = '11-50' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 11 AND 50
          WHEN csr = '51-200' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 51 AND 200
          WHEN csr = '201-500' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 201 AND 500
          WHEN csr = '501-1000' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 501 AND 1000
          WHEN csr = '1001-5000' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 1001 AND 5000
          WHEN csr = '5001-10000' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 5001 AND 10000
          WHEN csr = '10001+' THEN COALESCE(parse_employee_count_upper(fd.entity_data->>'employeeCount'), parse_employee_count_upper(fd.entity_data->>'companySize'), 0) > 10000
          ELSE false
        END
      )
    ))
    -- Company revenue filter with bypass logic
    AND (v_all_revenues_selected OR p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE (
        CASE 
          WHEN cr = 'Under $1M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) < 1000000
          WHEN cr = '$1M-$10M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 1000000 AND 10000000
          WHEN cr = '$10M-$50M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 10000001 AND 50000000
          WHEN cr = '$50M-$100M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 50000001 AND 100000000
          WHEN cr = '$100M-$500M' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 100000001 AND 500000000
          WHEN cr = '$500M-$1B' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 500000001 AND 1000000000
          WHEN cr = 'Over $1B' THEN COALESCE(NULLIF(regexp_replace(fd.entity_data->>'revenue', '[^0-9]', '', 'g'), '')::bigint, 0) > 1000000000
          ELSE false
        END
      )
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) ct
      WHERE fd.entity_data->>'city' ILIKE '%' || ct || '%'
         OR fd.entity_data->>'companyCity' ILIKE '%' || ct || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) co
      WHERE fd.entity_data->>'country' ILIKE '%' || co || '%'
         OR fd.entity_data->>'companyCountry' ILIKE '%' || co || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE lower(fd.entity_data->>'gender') = lower(g)
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
         OR fd.entity_data->>'netWorthRange' ILIKE '%' || nw || '%'
    ))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'incomeRange' ILIKE '%' || inc || '%'
         OR fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    -- Person interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) pi
      WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
    ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) ps
      WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    -- Prospect data filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') OR
         (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
         (fd.entity_data->>'directNumber' IS NOT NULL AND fd.entity_data->>'directNumber' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != '') OR
         (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' != ''))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
