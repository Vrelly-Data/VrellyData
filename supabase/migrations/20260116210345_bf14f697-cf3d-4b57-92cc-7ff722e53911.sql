-- ============================================
-- FIX FILTER LOGIC v2.2
-- Fixes: Seniority, Department, Income, Net Worth
-- Uses CREATE OR REPLACE - NO NEW FUNCTION
-- Same 28 parameters, same signature
-- ============================================

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type public.entity_type DEFAULT 'person'::public.entity_type,
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
  -- Calculate total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords search (searches multiple fields)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'fullName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'headline' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'summary' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'bio' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'description' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'skills' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'interests' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'technologies' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'city' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'country' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'state' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'department' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'seniority' ILIKE '%' || kw || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) c
      WHERE fd.entity_data->>'city' ILIKE '%' || c || '%'
        OR fd.entity_data->>'personCity' ILIKE '%' || c || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) c
      WHERE fd.entity_data->>'country' ILIKE '%' || c || '%'
        OR fd.entity_data->>'personCountry' ILIKE '%' || c || '%'
    ))
    -- Job Titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- FIXED: Seniority filter - Added 'c suite', 'cxo', 'founder' matches
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE 
        CASE LOWER(sl)
          WHEN 'c-level' THEN 
            LOWER(fd.entity_data->>'seniority') ~* '(c-level|c-suite|csuite|c level|c suite|cxo|chief|founder)'
            OR LOWER(fd.entity_data->>'title') ~* '^(ceo|cfo|cto|coo|cmo|cio|cpo|chief|founder)'
          WHEN 'vp' THEN 
            LOWER(fd.entity_data->>'seniority') ~* '(vp|vice president|vice-president)'
            OR LOWER(fd.entity_data->>'title') ~* '(^vp |vice president)'
          WHEN 'director' THEN 
            LOWER(fd.entity_data->>'seniority') ~* 'director'
            OR LOWER(fd.entity_data->>'title') ~* 'director'
          WHEN 'manager' THEN 
            LOWER(fd.entity_data->>'seniority') ~* 'manager'
            OR LOWER(fd.entity_data->>'title') ~* 'manager'
          WHEN 'senior' THEN 
            LOWER(fd.entity_data->>'seniority') ~* 'senior'
            OR LOWER(fd.entity_data->>'title') ~* '(^sr |^senior )'
          WHEN 'entry' THEN 
            LOWER(fd.entity_data->>'seniority') ~* '(entry|junior|associate|intern)'
            OR LOWER(fd.entity_data->>'title') ~* '(^jr |^junior |associate|intern)'
          ELSE 
            LOWER(fd.entity_data->>'seniority') ILIKE '%' || sl || '%'
        END
    ))
    -- FIXED: Department filter - Added 'Executive', 'technical' matches
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) d
      WHERE 
        CASE LOWER(d)
          WHEN 'c-suite' THEN 
            LOWER(fd.entity_data->>'department') ~* '(c-suite|c suite|csuite|executive|leadership|founder|owner)'
          WHEN 'engineering' THEN 
            LOWER(fd.entity_data->>'department') ~* '(engineering|developer|development|software|tech|technical)'
          WHEN 'sales' THEN 
            LOWER(fd.entity_data->>'department') ~* '(sales|business development|account)'
          WHEN 'marketing' THEN 
            LOWER(fd.entity_data->>'department') ~* '(marketing|growth|brand|content|digital)'
          WHEN 'finance' THEN 
            LOWER(fd.entity_data->>'department') ~* '(finance|accounting|financial|treasury)'
          WHEN 'hr' THEN 
            LOWER(fd.entity_data->>'department') ~* '(human resources|hr|people|talent|recruiting)'
          WHEN 'operations' THEN 
            LOWER(fd.entity_data->>'department') ~* '(operations|ops|supply chain|logistics)'
          WHEN 'legal' THEN 
            LOWER(fd.entity_data->>'department') ~* '(legal|compliance|regulatory)'
          WHEN 'it' THEN 
            LOWER(fd.entity_data->>'department') ~* '(^it$|information technology|infrastructure|security)'
          ELSE 
            LOWER(fd.entity_data->>'department') ILIKE '%' || d || '%'
        END
    ))
    -- Company Size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) csr
      WHERE 
        CASE csr
          WHEN '1-10' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 1 AND 10
          WHEN '11-50' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 11 AND 50
          WHEN '51-200' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 51 AND 200
          WHEN '201-500' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 201 AND 500
          WHEN '501-1000' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 501 AND 1000
          WHEN '1001-5000' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 1001 AND 5000
          WHEN '5001+' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) > 5000
          ELSE TRUE
        END
    ))
    -- Company Revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE 
        fd.entity_data->>'revenue' ILIKE '%' || cr || '%'
        OR fd.entity_data->>'annualRevenue' ILIKE '%' || cr || '%'
        OR CASE cr
          WHEN '$0-1M' THEN fd.entity_data->>'revenue' ~* '(\$[0-9]{1,3}K|\$[0-9]{1,3},?[0-9]{0,3}$|under.*1.*m|<.*1.*m)'
          WHEN '$1M-10M' THEN fd.entity_data->>'revenue' ~* '(\$[1-9]M|\$[1-9]\.?[0-9]?M|1.*-.*10.*m)'
          WHEN '$10M-50M' THEN fd.entity_data->>'revenue' ~* '(\$[1-4][0-9]M|\$10M.*50M|10.*-.*50.*m)'
          WHEN '$50M-100M' THEN fd.entity_data->>'revenue' ~* '(\$[5-9][0-9]M|\$50M.*100M|50.*-.*100.*m)'
          WHEN '$100M-500M' THEN fd.entity_data->>'revenue' ~* '(\$[1-4][0-9]{2}M|\$100M.*500M|100.*-.*500.*m)'
          WHEN '$500M+' THEN fd.entity_data->>'revenue' ~* '(\$[5-9][0-9]{2}M|\$[0-9]+B|\$500M\+|>.*500.*m|billion)'
          ELSE FALSE
        END
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) t
      WHERE fd.entity_data->>'technologies' ILIKE '%' || t || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE LOWER(fd.entity_data->>'gender') = LOWER(g)
    ))
    -- FIXED: Income filter - Parse $XX as thousands correctly
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE 
        CASE inc
          WHEN 'Under $50K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) < 50
          WHEN '$50K-$100K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 50 AND 100
          WHEN '$100K-$250K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 100 AND 250
          WHEN '$250K+' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) > 250
          ELSE fd.entity_data->>'incomeRange' IS NOT NULL
        END
    ))
    -- FIXED: Net Worth filter - Parse $XXX as thousands correctly
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE 
        CASE nw
          WHEN 'Under $100K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) < 100
          WHEN '$100K-$500K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 100 AND 500
          WHEN '$500K-$1M' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 500 AND 1000
          WHEN '$1M-$5M' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 1000 AND 5000
          WHEN '$5M+' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) > 5000
          ELSE fd.entity_data->>'netWorth' IS NOT NULL
        END
    ))
    -- Skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) s
      WHERE fd.entity_data->>'skills' ILIKE '%' || s || '%'
    ))
    -- Interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) i
      WHERE fd.entity_data->>'interests' ILIKE '%' || i || '%'
    ))
    -- Has Email filter
    AND (p_has_email IS NULL OR (p_has_email = TRUE AND (
      fd.entity_data->>'email' IS NOT NULL 
      OR fd.entity_data->>'businessEmail' IS NOT NULL
    )))
    -- Has Phone filter
    AND (p_has_phone IS NULL OR (p_has_phone = TRUE AND (
      fd.entity_data->>'phone' IS NOT NULL 
      OR fd.entity_data->>'mobilePhone' IS NOT NULL
    )))
    -- Has LinkedIn filter
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = TRUE AND (
      fd.entity_data->>'linkedin' IS NOT NULL 
      OR fd.entity_data->>'linkedinUrl' IS NOT NULL
    )))
    -- Has Facebook filter
    AND (p_has_facebook IS NULL OR (p_has_facebook = TRUE AND fd.entity_data->>'facebook' IS NOT NULL))
    -- Has Twitter filter
    AND (p_has_twitter IS NULL OR (p_has_twitter = TRUE AND fd.entity_data->>'twitter' IS NOT NULL))
    -- Has Personal Email filter
    AND (p_has_personal_email IS NULL OR (p_has_personal_email = TRUE AND fd.entity_data->>'email' IS NOT NULL))
    -- Has Business Email filter
    AND (p_has_business_email IS NULL OR (p_has_business_email = TRUE AND fd.entity_data->>'businessEmail' IS NOT NULL))
    -- Has Company Phone filter
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = TRUE AND fd.entity_data->>'companyPhone' IS NOT NULL))
    -- Has Company LinkedIn filter
    AND (p_has_company_linkedin IS NULL OR (p_has_company_linkedin = TRUE AND fd.entity_data->>'companyLinkedin' IS NOT NULL))
    -- Has Company Facebook filter
    AND (p_has_company_facebook IS NULL OR (p_has_company_facebook = TRUE AND fd.entity_data->>'companyFacebook' IS NOT NULL))
    -- Has Company Twitter filter
    AND (p_has_company_twitter IS NULL OR (p_has_company_twitter = TRUE AND fd.entity_data->>'companyTwitter' IS NOT NULL));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords search (searches multiple fields)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'fullName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'headline' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'summary' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'bio' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'description' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'skills' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'interests' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'technologies' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'city' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'country' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'state' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'department' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'seniority' ILIKE '%' || kw || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) c
      WHERE fd.entity_data->>'city' ILIKE '%' || c || '%'
        OR fd.entity_data->>'personCity' ILIKE '%' || c || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) c
      WHERE fd.entity_data->>'country' ILIKE '%' || c || '%'
        OR fd.entity_data->>'personCountry' ILIKE '%' || c || '%'
    ))
    -- Job Titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- FIXED: Seniority filter
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE 
        CASE LOWER(sl)
          WHEN 'c-level' THEN 
            LOWER(fd.entity_data->>'seniority') ~* '(c-level|c-suite|csuite|c level|c suite|cxo|chief|founder)'
            OR LOWER(fd.entity_data->>'title') ~* '^(ceo|cfo|cto|coo|cmo|cio|cpo|chief|founder)'
          WHEN 'vp' THEN 
            LOWER(fd.entity_data->>'seniority') ~* '(vp|vice president|vice-president)'
            OR LOWER(fd.entity_data->>'title') ~* '(^vp |vice president)'
          WHEN 'director' THEN 
            LOWER(fd.entity_data->>'seniority') ~* 'director'
            OR LOWER(fd.entity_data->>'title') ~* 'director'
          WHEN 'manager' THEN 
            LOWER(fd.entity_data->>'seniority') ~* 'manager'
            OR LOWER(fd.entity_data->>'title') ~* 'manager'
          WHEN 'senior' THEN 
            LOWER(fd.entity_data->>'seniority') ~* 'senior'
            OR LOWER(fd.entity_data->>'title') ~* '(^sr |^senior )'
          WHEN 'entry' THEN 
            LOWER(fd.entity_data->>'seniority') ~* '(entry|junior|associate|intern)'
            OR LOWER(fd.entity_data->>'title') ~* '(^jr |^junior |associate|intern)'
          ELSE 
            LOWER(fd.entity_data->>'seniority') ILIKE '%' || sl || '%'
        END
    ))
    -- FIXED: Department filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) d
      WHERE 
        CASE LOWER(d)
          WHEN 'c-suite' THEN 
            LOWER(fd.entity_data->>'department') ~* '(c-suite|c suite|csuite|executive|leadership|founder|owner)'
          WHEN 'engineering' THEN 
            LOWER(fd.entity_data->>'department') ~* '(engineering|developer|development|software|tech|technical)'
          WHEN 'sales' THEN 
            LOWER(fd.entity_data->>'department') ~* '(sales|business development|account)'
          WHEN 'marketing' THEN 
            LOWER(fd.entity_data->>'department') ~* '(marketing|growth|brand|content|digital)'
          WHEN 'finance' THEN 
            LOWER(fd.entity_data->>'department') ~* '(finance|accounting|financial|treasury)'
          WHEN 'hr' THEN 
            LOWER(fd.entity_data->>'department') ~* '(human resources|hr|people|talent|recruiting)'
          WHEN 'operations' THEN 
            LOWER(fd.entity_data->>'department') ~* '(operations|ops|supply chain|logistics)'
          WHEN 'legal' THEN 
            LOWER(fd.entity_data->>'department') ~* '(legal|compliance|regulatory)'
          WHEN 'it' THEN 
            LOWER(fd.entity_data->>'department') ~* '(^it$|information technology|infrastructure|security)'
          ELSE 
            LOWER(fd.entity_data->>'department') ILIKE '%' || d || '%'
        END
    ))
    -- Company Size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) csr
      WHERE 
        CASE csr
          WHEN '1-10' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 1 AND 10
          WHEN '11-50' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 11 AND 50
          WHEN '51-200' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 51 AND 200
          WHEN '201-500' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 201 AND 500
          WHEN '501-1000' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 501 AND 1000
          WHEN '1001-5000' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) BETWEEN 1001 AND 5000
          WHEN '5001+' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>'employeeCount'), public.parse_employee_count_upper(fd.entity_data->>'employees'), 0) > 5000
          ELSE TRUE
        END
    ))
    -- Company Revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE 
        fd.entity_data->>'revenue' ILIKE '%' || cr || '%'
        OR fd.entity_data->>'annualRevenue' ILIKE '%' || cr || '%'
        OR CASE cr
          WHEN '$0-1M' THEN fd.entity_data->>'revenue' ~* '(\$[0-9]{1,3}K|\$[0-9]{1,3},?[0-9]{0,3}$|under.*1.*m|<.*1.*m)'
          WHEN '$1M-10M' THEN fd.entity_data->>'revenue' ~* '(\$[1-9]M|\$[1-9]\.?[0-9]?M|1.*-.*10.*m)'
          WHEN '$10M-50M' THEN fd.entity_data->>'revenue' ~* '(\$[1-4][0-9]M|\$10M.*50M|10.*-.*50.*m)'
          WHEN '$50M-100M' THEN fd.entity_data->>'revenue' ~* '(\$[5-9][0-9]M|\$50M.*100M|50.*-.*100.*m)'
          WHEN '$100M-500M' THEN fd.entity_data->>'revenue' ~* '(\$[1-4][0-9]{2}M|\$100M.*500M|100.*-.*500.*m)'
          WHEN '$500M+' THEN fd.entity_data->>'revenue' ~* '(\$[5-9][0-9]{2}M|\$[0-9]+B|\$500M\+|>.*500.*m|billion)'
          ELSE FALSE
        END
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) t
      WHERE fd.entity_data->>'technologies' ILIKE '%' || t || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE LOWER(fd.entity_data->>'gender') = LOWER(g)
    ))
    -- FIXED: Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE 
        CASE inc
          WHEN 'Under $50K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) < 50
          WHEN '$50K-$100K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 50 AND 100
          WHEN '$100K-$250K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 100 AND 250
          WHEN '$250K+' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) > 250
          ELSE fd.entity_data->>'incomeRange' IS NOT NULL
        END
    ))
    -- FIXED: Net Worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE 
        CASE nw
          WHEN 'Under $100K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) < 100
          WHEN '$100K-$500K' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 100 AND 500
          WHEN '$500K-$1M' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 500 AND 1000
          WHEN '$1M-$5M' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 1000 AND 5000
          WHEN '$5M+' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) > 5000
          ELSE fd.entity_data->>'netWorth' IS NOT NULL
        END
    ))
    -- Skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) s
      WHERE fd.entity_data->>'skills' ILIKE '%' || s || '%'
    ))
    -- Interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) i
      WHERE fd.entity_data->>'interests' ILIKE '%' || i || '%'
    ))
    -- Has Email filter
    AND (p_has_email IS NULL OR (p_has_email = TRUE AND (
      fd.entity_data->>'email' IS NOT NULL 
      OR fd.entity_data->>'businessEmail' IS NOT NULL
    )))
    -- Has Phone filter
    AND (p_has_phone IS NULL OR (p_has_phone = TRUE AND (
      fd.entity_data->>'phone' IS NOT NULL 
      OR fd.entity_data->>'mobilePhone' IS NOT NULL
    )))
    -- Has LinkedIn filter
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = TRUE AND (
      fd.entity_data->>'linkedin' IS NOT NULL 
      OR fd.entity_data->>'linkedinUrl' IS NOT NULL
    )))
    -- Has Facebook filter
    AND (p_has_facebook IS NULL OR (p_has_facebook = TRUE AND fd.entity_data->>'facebook' IS NOT NULL))
    -- Has Twitter filter
    AND (p_has_twitter IS NULL OR (p_has_twitter = TRUE AND fd.entity_data->>'twitter' IS NOT NULL))
    -- Has Personal Email filter
    AND (p_has_personal_email IS NULL OR (p_has_personal_email = TRUE AND fd.entity_data->>'email' IS NOT NULL))
    -- Has Business Email filter
    AND (p_has_business_email IS NULL OR (p_has_business_email = TRUE AND fd.entity_data->>'businessEmail' IS NOT NULL))
    -- Has Company Phone filter
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = TRUE AND fd.entity_data->>'companyPhone' IS NOT NULL))
    -- Has Company LinkedIn filter
    AND (p_has_company_linkedin IS NULL OR (p_has_company_linkedin = TRUE AND fd.entity_data->>'companyLinkedin' IS NOT NULL))
    -- Has Company Facebook filter
    AND (p_has_company_facebook IS NULL OR (p_has_company_facebook = TRUE AND fd.entity_data->>'companyFacebook' IS NOT NULL))
    -- Has Company Twitter filter
    AND (p_has_company_twitter IS NULL OR (p_has_company_twitter = TRUE AND fd.entity_data->>'companyTwitter' IS NOT NULL))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;