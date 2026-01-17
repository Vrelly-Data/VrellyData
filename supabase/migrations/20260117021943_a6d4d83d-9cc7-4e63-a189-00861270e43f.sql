-- v2.4: Fix 5 broken field names using EXACT function identity
-- Drop using exact identity arguments from pg_proc

DROP FUNCTION IF EXISTS public.search_free_data_builder(
  p_entity_type entity_type,
  p_keywords text[],
  p_industries text[],
  p_cities text[],
  p_countries text[],
  p_job_titles text[],
  p_seniority_levels text[],
  p_departments text[],
  p_company_size_ranges text[],
  p_company_revenue text[],
  p_technologies text[],
  p_gender text[],
  p_income text[],
  p_net_worth text[],
  p_person_skills text[],
  p_person_interests text[],
  p_has_email boolean,
  p_has_phone boolean,
  p_has_linkedin boolean,
  p_has_facebook boolean,
  p_has_twitter boolean,
  p_has_personal_email boolean,
  p_has_business_email boolean,
  p_has_company_phone boolean,
  p_has_company_linkedin boolean,
  p_has_company_facebook boolean,
  p_has_company_twitter boolean,
  p_limit integer,
  p_offset integer
);

-- Recreate with SAME parameter order and v2.4 field name fixes
CREATE FUNCTION public.search_free_data_builder(
  p_entity_type public.entity_type DEFAULT 'person',
  p_keywords text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_size_ranges text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_technologies text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
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
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE fd.entity_data->>'firstName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'lastName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'title' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'company' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'industry' ILIKE '%' || kw || '%'
    ))
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind WHERE LOWER(fd.entity_data->>'industry') = LOWER(ind)
    ))
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) city
      WHERE LOWER(fd.entity_data->>'city') = LOWER(city) OR
            LOWER(fd.entity_data->>'personCity') = LOWER(city) OR
            LOWER(fd.entity_data->>'companyCity') = LOWER(city)
    ))
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) country
      WHERE LOWER(fd.entity_data->>'country') = LOWER(country) OR
            LOWER(fd.entity_data->>'personCountry') = LOWER(country) OR
            LOWER(fd.entity_data->>'companyCountry') = LOWER(country)
    ))
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR 
      title_matches_seniority(COALESCE(fd.entity_data->>'title', ''), COALESCE(fd.entity_data->>'seniority', ''), p_seniority_levels)
    )
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE LOWER(fd.entity_data->>'department') = LOWER(dept) OR
        (LOWER(dept) = 'engineering' AND (LOWER(fd.entity_data->>'department') LIKE '%engineer%' OR LOWER(fd.entity_data->>'department') LIKE '%development%' OR LOWER(fd.entity_data->>'department') LIKE '%technical%' OR LOWER(fd.entity_data->>'department') LIKE '%software%' OR LOWER(fd.entity_data->>'department') LIKE '%it%' OR LOWER(fd.entity_data->>'department') LIKE '%technology%')) OR
        (LOWER(dept) = 'sales' AND (LOWER(fd.entity_data->>'department') LIKE '%sales%' OR LOWER(fd.entity_data->>'department') LIKE '%business development%' OR LOWER(fd.entity_data->>'department') LIKE '%account%')) OR
        (LOWER(dept) = 'marketing' AND (LOWER(fd.entity_data->>'department') LIKE '%marketing%' OR LOWER(fd.entity_data->>'department') LIKE '%brand%' OR LOWER(fd.entity_data->>'department') LIKE '%communications%' OR LOWER(fd.entity_data->>'department') LIKE '%growth%')) OR
        (LOWER(dept) = 'finance' AND (LOWER(fd.entity_data->>'department') LIKE '%finance%' OR LOWER(fd.entity_data->>'department') LIKE '%accounting%' OR LOWER(fd.entity_data->>'department') LIKE '%financial%')) OR
        (LOWER(dept) = 'operations' AND (LOWER(fd.entity_data->>'department') LIKE '%operations%' OR LOWER(fd.entity_data->>'department') LIKE '%supply chain%' OR LOWER(fd.entity_data->>'department') LIKE '%logistics%')) OR
        (LOWER(dept) = 'human resources' AND (LOWER(fd.entity_data->>'department') LIKE '%human resources%' OR LOWER(fd.entity_data->>'department') LIKE '%hr%' OR LOWER(fd.entity_data->>'department') LIKE '%people%' OR LOWER(fd.entity_data->>'department') LIKE '%talent%' OR LOWER(fd.entity_data->>'department') LIKE '%recruiting%')) OR
        (LOWER(dept) = 'customer success' AND (LOWER(fd.entity_data->>'department') LIKE '%customer success%' OR LOWER(fd.entity_data->>'department') LIKE '%customer service%' OR LOWER(fd.entity_data->>'department') LIKE '%support%' OR LOWER(fd.entity_data->>'department') LIKE '%client%')) OR
        (LOWER(dept) = 'product' AND (LOWER(fd.entity_data->>'department') LIKE '%product%')) OR
        (LOWER(dept) = 'executive' AND (LOWER(fd.entity_data->>'department') LIKE '%executive%' OR LOWER(fd.entity_data->>'department') LIKE '%c-suite%' OR LOWER(fd.entity_data->>'department') LIKE '%leadership%' OR LOWER(fd.entity_data->>'department') LIKE '%management%')) OR
        (LOWER(dept) = 'legal' AND (LOWER(fd.entity_data->>'department') LIKE '%legal%' OR LOWER(fd.entity_data->>'department') LIKE '%compliance%' OR LOWER(fd.entity_data->>'department') LIKE '%regulatory%')) OR
        (LOWER(dept) = 'community and social services' AND (LOWER(fd.entity_data->>'department') LIKE '%community%' OR LOWER(fd.entity_data->>'department') LIKE '%social%' OR LOWER(fd.entity_data->>'department') LIKE '%nonprofit%' OR LOWER(fd.entity_data->>'department') LIKE '%outreach%'))
    ))
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE CASE 
        WHEN size_range = '1-10' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 1 AND 10
        WHEN size_range = '11-50' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 11 AND 50
        WHEN size_range = '51-200' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 51 AND 200
        WHEN size_range = '201-500' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 201 AND 500
        WHEN size_range = '501-1000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 501 AND 1000
        WHEN size_range = '1001-5000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 1001 AND 5000
        WHEN size_range = '5001-10000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 5001 AND 10000
        WHEN size_range = '10001+' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) > 10000
        ELSE false END
    ))
    -- v2.4 FIX: companyRevenue
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev WHERE COALESCE(fd.entity_data->>'companyRevenue', '') ILIKE '%' || rev || '%'
    ))
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g WHERE LOWER(fd.entity_data->>'gender') = LOWER(g)
    ))
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR (
      fd.entity_data->>'incomeRange' IS NOT NULL AND fd.entity_data->>'incomeRange' != '' AND EXISTS (
        SELECT 1 FROM unnest(p_income) inc WHERE CASE 
          WHEN inc = 'Under $50K' THEN fd.entity_data->>'incomeRange' ILIKE '%under%50%' OR fd.entity_data->>'incomeRange' ILIKE '%<50%' OR fd.entity_data->>'incomeRange' ILIKE '%0-50%' OR fd.entity_data->>'incomeRange' ILIKE '%less than 50%'
          WHEN inc = '$50K-$100K' THEN fd.entity_data->>'incomeRange' ILIKE '%50%100%' OR fd.entity_data->>'incomeRange' ILIKE '%50k-100k%'
          WHEN inc = '$100K-$200K' THEN fd.entity_data->>'incomeRange' ILIKE '%100%200%' OR fd.entity_data->>'incomeRange' ILIKE '%100k-200k%'
          WHEN inc = '$200K+' THEN fd.entity_data->>'incomeRange' ILIKE '%200%' OR fd.entity_data->>'incomeRange' ILIKE '%over 200%' OR fd.entity_data->>'incomeRange' ILIKE '%>200%'
          ELSE fd.entity_data->>'incomeRange' ILIKE '%' || inc || '%' END
      )
    ))
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR (
      fd.entity_data->>'netWorth' IS NOT NULL AND fd.entity_data->>'netWorth' != '' AND EXISTS (
        SELECT 1 FROM unnest(p_net_worth) nw WHERE CASE 
          WHEN nw = 'Under $100K' THEN (fd.entity_data->>'netWorth')::numeric < 100000
          WHEN nw = '$100K-$500K' THEN (fd.entity_data->>'netWorth')::numeric BETWEEN 100000 AND 500000
          WHEN nw = '$500K-$1M' THEN (fd.entity_data->>'netWorth')::numeric BETWEEN 500000 AND 1000000
          WHEN nw = '$1M-$5M' THEN (fd.entity_data->>'netWorth')::numeric BETWEEN 1000000 AND 5000000
          WHEN nw = '$5M+' THEN (fd.entity_data->>'netWorth')::numeric > 5000000
          ELSE false END
      )
    ))
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill WHERE fd.entity_data->>'skills' ILIKE '%' || skill || '%'
    ))
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))
    AND (p_has_email IS NULL OR (CASE WHEN p_has_email THEN 
      (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != '') OR
      (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '') OR
      (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '')
    ELSE (fd.entity_data->>'email' IS NULL OR fd.entity_data->>'email' = '') AND
         (fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = '') AND
         (fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = '') END))
    AND (p_has_phone IS NULL OR (CASE WHEN p_has_phone THEN fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''
      ELSE fd.entity_data->>'phone' IS NULL OR fd.entity_data->>'phone' = '' END))
    AND (p_has_linkedin IS NULL OR (CASE WHEN p_has_linkedin THEN fd.entity_data->>'linkedInUrl' IS NOT NULL AND fd.entity_data->>'linkedInUrl' != ''
      ELSE fd.entity_data->>'linkedInUrl' IS NULL OR fd.entity_data->>'linkedInUrl' = '' END))
    -- v2.4 FIX: facebookUrl
    AND (p_has_facebook IS NULL OR (CASE WHEN p_has_facebook THEN fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''
      ELSE fd.entity_data->>'facebookUrl' IS NULL OR fd.entity_data->>'facebookUrl' = '' END))
    -- v2.4 FIX: twitterUrl
    AND (p_has_twitter IS NULL OR (CASE WHEN p_has_twitter THEN fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''
      ELSE fd.entity_data->>'twitterUrl' IS NULL OR fd.entity_data->>'twitterUrl' = '' END))
    AND (p_has_personal_email IS NULL OR (CASE WHEN p_has_personal_email THEN fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''
      ELSE fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = '' END))
    AND (p_has_business_email IS NULL OR (CASE WHEN p_has_business_email THEN fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''
      ELSE fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = '' END))
    AND (p_has_company_phone IS NULL OR (CASE WHEN p_has_company_phone THEN fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''
      ELSE fd.entity_data->>'companyPhone' IS NULL OR fd.entity_data->>'companyPhone' = '' END))
    AND (p_has_company_linkedin IS NULL OR (CASE WHEN p_has_company_linkedin THEN fd.entity_data->>'companyLinkedInUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedInUrl' != ''
      ELSE fd.entity_data->>'companyLinkedInUrl' IS NULL OR fd.entity_data->>'companyLinkedInUrl' = '' END))
    -- v2.4 FIX: companyFacebookUrl
    AND (p_has_company_facebook IS NULL OR (CASE WHEN p_has_company_facebook THEN fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''
      ELSE fd.entity_data->>'companyFacebookUrl' IS NULL OR fd.entity_data->>'companyFacebookUrl' = '' END))
    -- v2.4 FIX: companyTwitterUrl
    AND (p_has_company_twitter IS NULL OR (CASE WHEN p_has_company_twitter THEN fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''
      ELSE fd.entity_data->>'companyTwitterUrl' IS NULL OR fd.entity_data->>'companyTwitterUrl' = '' END));

  RETURN QUERY
  SELECT fd.entity_external_id::text, fd.entity_data, v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE fd.entity_data->>'firstName' ILIKE '%' || kw || '%' OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'title' ILIKE '%' || kw || '%' OR fd.entity_data->>'company' ILIKE '%' || kw || '%' OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
    ))
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_industries) ind WHERE LOWER(fd.entity_data->>'industry') = LOWER(ind)))
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_cities) city WHERE LOWER(fd.entity_data->>'city') = LOWER(city) OR LOWER(fd.entity_data->>'personCity') = LOWER(city) OR LOWER(fd.entity_data->>'companyCity') = LOWER(city)))
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_countries) country WHERE LOWER(fd.entity_data->>'country') = LOWER(country) OR LOWER(fd.entity_data->>'personCountry') = LOWER(country) OR LOWER(fd.entity_data->>'companyCountry') = LOWER(country)))
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_job_titles) jt WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'))
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR title_matches_seniority(COALESCE(fd.entity_data->>'title', ''), COALESCE(fd.entity_data->>'seniority', ''), p_seniority_levels))
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE LOWER(fd.entity_data->>'department') = LOWER(dept) OR
        (LOWER(dept) = 'engineering' AND (LOWER(fd.entity_data->>'department') LIKE '%engineer%' OR LOWER(fd.entity_data->>'department') LIKE '%development%' OR LOWER(fd.entity_data->>'department') LIKE '%technical%' OR LOWER(fd.entity_data->>'department') LIKE '%software%' OR LOWER(fd.entity_data->>'department') LIKE '%it%' OR LOWER(fd.entity_data->>'department') LIKE '%technology%')) OR
        (LOWER(dept) = 'sales' AND (LOWER(fd.entity_data->>'department') LIKE '%sales%' OR LOWER(fd.entity_data->>'department') LIKE '%business development%' OR LOWER(fd.entity_data->>'department') LIKE '%account%')) OR
        (LOWER(dept) = 'marketing' AND (LOWER(fd.entity_data->>'department') LIKE '%marketing%' OR LOWER(fd.entity_data->>'department') LIKE '%brand%' OR LOWER(fd.entity_data->>'department') LIKE '%communications%' OR LOWER(fd.entity_data->>'department') LIKE '%growth%')) OR
        (LOWER(dept) = 'finance' AND (LOWER(fd.entity_data->>'department') LIKE '%finance%' OR LOWER(fd.entity_data->>'department') LIKE '%accounting%' OR LOWER(fd.entity_data->>'department') LIKE '%financial%')) OR
        (LOWER(dept) = 'operations' AND (LOWER(fd.entity_data->>'department') LIKE '%operations%' OR LOWER(fd.entity_data->>'department') LIKE '%supply chain%' OR LOWER(fd.entity_data->>'department') LIKE '%logistics%')) OR
        (LOWER(dept) = 'human resources' AND (LOWER(fd.entity_data->>'department') LIKE '%human resources%' OR LOWER(fd.entity_data->>'department') LIKE '%hr%' OR LOWER(fd.entity_data->>'department') LIKE '%people%' OR LOWER(fd.entity_data->>'department') LIKE '%talent%' OR LOWER(fd.entity_data->>'department') LIKE '%recruiting%')) OR
        (LOWER(dept) = 'customer success' AND (LOWER(fd.entity_data->>'department') LIKE '%customer success%' OR LOWER(fd.entity_data->>'department') LIKE '%customer service%' OR LOWER(fd.entity_data->>'department') LIKE '%support%' OR LOWER(fd.entity_data->>'department') LIKE '%client%')) OR
        (LOWER(dept) = 'product' AND (LOWER(fd.entity_data->>'department') LIKE '%product%')) OR
        (LOWER(dept) = 'executive' AND (LOWER(fd.entity_data->>'department') LIKE '%executive%' OR LOWER(fd.entity_data->>'department') LIKE '%c-suite%' OR LOWER(fd.entity_data->>'department') LIKE '%leadership%' OR LOWER(fd.entity_data->>'department') LIKE '%management%')) OR
        (LOWER(dept) = 'legal' AND (LOWER(fd.entity_data->>'department') LIKE '%legal%' OR LOWER(fd.entity_data->>'department') LIKE '%compliance%' OR LOWER(fd.entity_data->>'department') LIKE '%regulatory%')) OR
        (LOWER(dept) = 'community and social services' AND (LOWER(fd.entity_data->>'department') LIKE '%community%' OR LOWER(fd.entity_data->>'department') LIKE '%social%' OR LOWER(fd.entity_data->>'department') LIKE '%nonprofit%' OR LOWER(fd.entity_data->>'department') LIKE '%outreach%'))
    ))
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range WHERE CASE 
        WHEN size_range = '1-10' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 1 AND 10
        WHEN size_range = '11-50' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 11 AND 50
        WHEN size_range = '51-200' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 51 AND 200
        WHEN size_range = '201-500' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 201 AND 500
        WHEN size_range = '501-1000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 501 AND 1000
        WHEN size_range = '1001-5000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 1001 AND 5000
        WHEN size_range = '5001-10000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 5001 AND 10000
        WHEN size_range = '10001+' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) > 10000 ELSE false END
    ))
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_company_revenue) rev WHERE COALESCE(fd.entity_data->>'companyRevenue', '') ILIKE '%' || rev || '%'))
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_technologies) tech WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'))
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_gender) g WHERE LOWER(fd.entity_data->>'gender') = LOWER(g)))
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR (fd.entity_data->>'incomeRange' IS NOT NULL AND fd.entity_data->>'incomeRange' != '' AND EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE CASE WHEN inc = 'Under $50K' THEN fd.entity_data->>'incomeRange' ILIKE '%under%50%' OR fd.entity_data->>'incomeRange' ILIKE '%<50%' OR fd.entity_data->>'incomeRange' ILIKE '%0-50%' OR fd.entity_data->>'incomeRange' ILIKE '%less than 50%' WHEN inc = '$50K-$100K' THEN fd.entity_data->>'incomeRange' ILIKE '%50%100%' OR fd.entity_data->>'incomeRange' ILIKE '%50k-100k%' WHEN inc = '$100K-$200K' THEN fd.entity_data->>'incomeRange' ILIKE '%100%200%' OR fd.entity_data->>'incomeRange' ILIKE '%100k-200k%' WHEN inc = '$200K+' THEN fd.entity_data->>'incomeRange' ILIKE '%200%' OR fd.entity_data->>'incomeRange' ILIKE '%over 200%' OR fd.entity_data->>'incomeRange' ILIKE '%>200%' ELSE fd.entity_data->>'incomeRange' ILIKE '%' || inc || '%' END)))
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR (fd.entity_data->>'netWorth' IS NOT NULL AND fd.entity_data->>'netWorth' != '' AND EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE CASE WHEN nw = 'Under $100K' THEN (fd.entity_data->>'netWorth')::numeric < 100000 WHEN nw = '$100K-$500K' THEN (fd.entity_data->>'netWorth')::numeric BETWEEN 100000 AND 500000 WHEN nw = '$500K-$1M' THEN (fd.entity_data->>'netWorth')::numeric BETWEEN 500000 AND 1000000 WHEN nw = '$1M-$5M' THEN (fd.entity_data->>'netWorth')::numeric BETWEEN 1000000 AND 5000000 WHEN nw = '$5M+' THEN (fd.entity_data->>'netWorth')::numeric > 5000000 ELSE false END)))
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_person_skills) skill WHERE fd.entity_data->>'skills' ILIKE '%' || skill || '%'))
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (SELECT 1 FROM unnest(p_person_interests) interest WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'))
    AND (p_has_email IS NULL OR (CASE WHEN p_has_email THEN (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != '') OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '') OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') ELSE (fd.entity_data->>'email' IS NULL OR fd.entity_data->>'email' = '') AND (fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = '') AND (fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = '') END))
    AND (p_has_phone IS NULL OR (CASE WHEN p_has_phone THEN fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '' ELSE fd.entity_data->>'phone' IS NULL OR fd.entity_data->>'phone' = '' END))
    AND (p_has_linkedin IS NULL OR (CASE WHEN p_has_linkedin THEN fd.entity_data->>'linkedInUrl' IS NOT NULL AND fd.entity_data->>'linkedInUrl' != '' ELSE fd.entity_data->>'linkedInUrl' IS NULL OR fd.entity_data->>'linkedInUrl' = '' END))
    AND (p_has_facebook IS NULL OR (CASE WHEN p_has_facebook THEN fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '' ELSE fd.entity_data->>'facebookUrl' IS NULL OR fd.entity_data->>'facebookUrl' = '' END))
    AND (p_has_twitter IS NULL OR (CASE WHEN p_has_twitter THEN fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '' ELSE fd.entity_data->>'twitterUrl' IS NULL OR fd.entity_data->>'twitterUrl' = '' END))
    AND (p_has_personal_email IS NULL OR (CASE WHEN p_has_personal_email THEN fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '' ELSE fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = '' END))
    AND (p_has_business_email IS NULL OR (CASE WHEN p_has_business_email THEN fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '' ELSE fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = '' END))
    AND (p_has_company_phone IS NULL OR (CASE WHEN p_has_company_phone THEN fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != '' ELSE fd.entity_data->>'companyPhone' IS NULL OR fd.entity_data->>'companyPhone' = '' END))
    AND (p_has_company_linkedin IS NULL OR (CASE WHEN p_has_company_linkedin THEN fd.entity_data->>'companyLinkedInUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedInUrl' != '' ELSE fd.entity_data->>'companyLinkedInUrl' IS NULL OR fd.entity_data->>'companyLinkedInUrl' = '' END))
    AND (p_has_company_facebook IS NULL OR (CASE WHEN p_has_company_facebook THEN fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != '' ELSE fd.entity_data->>'companyFacebookUrl' IS NULL OR fd.entity_data->>'companyFacebookUrl' = '' END))
    AND (p_has_company_twitter IS NULL OR (CASE WHEN p_has_company_twitter THEN fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != '' ELSE fd.entity_data->>'companyTwitterUrl' IS NULL OR fd.entity_data->>'companyTwitterUrl' = '' END))
  ORDER BY fd.entity_external_id
  LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.search_free_data_builder IS 'v2.4: Fixed 5 field names (facebookUrl, twitterUrl, companyFacebookUrl, companyTwitterUrl, companyRevenue). 29 parameters.';