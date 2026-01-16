-- Drop all existing overloads of search_free_data_builder
DO $$
DECLARE
  func_oid oid;
BEGIN
  FOR func_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'search_free_data_builder'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', func_oid::regprocedure);
  END LOOP;
END $$;

-- Create the comprehensive fixed version
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type        public.entity_type DEFAULT 'person'::public.entity_type,
  p_industries         text[]   DEFAULT NULL,
  p_keywords           text[]   DEFAULT NULL,
  p_job_titles         text[]   DEFAULT NULL,
  p_seniority_levels   text[]   DEFAULT NULL,
  p_departments        text[]   DEFAULT NULL,
  p_company_size_ranges text[]  DEFAULT NULL,
  p_company_revenue    text[]   DEFAULT NULL,
  p_technologies       text[]   DEFAULT NULL,
  p_cities             text[]   DEFAULT NULL,
  p_countries          text[]   DEFAULT NULL,
  p_gender             text[]   DEFAULT NULL,
  p_has_phone          boolean  DEFAULT NULL,
  p_has_linkedin       boolean  DEFAULT NULL,
  p_has_facebook       boolean  DEFAULT NULL,
  p_has_twitter        boolean  DEFAULT NULL,
  p_has_personal_email boolean  DEFAULT NULL,
  p_has_business_email boolean  DEFAULT NULL,
  p_has_company_phone  boolean  DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean  DEFAULT NULL,
  p_income             text[]   DEFAULT NULL,
  p_net_worth          text[]   DEFAULT NULL,
  p_person_skills      text[]   DEFAULT NULL,
  p_person_interests   text[]   DEFAULT NULL,
  p_limit              integer  DEFAULT 50,
  p_offset             integer  DEFAULT 0
)
RETURNS TABLE(entity_data jsonb, entity_external_id text, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_total bigint;
  -- Helper arrays for "all buckets selected" bypass
  v_all_revenue_buckets text[] := ARRAY[
    'Under $1M', '$1M - $10M', '$10M - $50M', '$50M - $100M',
    '$100M - $500M', '$500M - $1B', '$1B+'
  ];
  v_all_size_buckets text[] := ARRAY[
    '1-10', '11-50', '51-200', '201-500', '501-1000',
    '1001-5000', '5001-10000', '10000+', '10001+'
  ];
  -- Flags for bypass
  v_bypass_revenue boolean := FALSE;
  v_bypass_size boolean := FALSE;
BEGIN
  -- Check if all revenue buckets are selected (bypass revenue filter)
  IF p_company_revenue IS NOT NULL AND array_length(p_company_revenue, 1) >= 7 THEN
    v_bypass_revenue := TRUE;
  END IF;
  
  -- Check if all size buckets are selected (bypass size filter)
  IF p_company_size_ranges IS NOT NULL AND array_length(p_company_size_ranges, 1) >= 8 THEN
    v_bypass_size := TRUE;
  END IF;

  -- Count total matching records
  SELECT count(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ui
      WHERE lower(fd.entity_data->>'industry') ILIKE '%' || lower(ui) || '%'
         OR lower(fd.entity_data->>'companyIndustry') ILIKE '%' || lower(ui) || '%'
    ))
    -- Keywords filter
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) uk
      WHERE lower(fd.entity_data::text) ILIKE '%' || lower(uk) || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) ujt
      WHERE lower(fd.entity_data->>'title') ILIKE '%' || lower(ujt) || '%'
         OR lower(fd.entity_data->>'jobTitle') ILIKE '%' || lower(ujt) || '%'
    ))
    -- Seniority filter (normalized matching)
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) usl
      WHERE lower(fd.entity_data->>'seniority') = lower(usl)
         OR lower(fd.entity_data->>'seniorityLevel') = lower(usl)
         OR (lower(usl) = 'c-suite' AND lower(fd.entity_data->>'seniority') IN ('c-level', 'c-suite', 'csuite', 'c level'))
         OR (lower(usl) = 'vp' AND lower(fd.entity_data->>'seniority') IN ('vp', 'vice president', 'vice-president'))
         OR (lower(usl) = 'director' AND lower(fd.entity_data->>'seniority') ILIKE '%director%')
         OR (lower(usl) = 'manager' AND lower(fd.entity_data->>'seniority') ILIKE '%manager%')
         OR (lower(usl) = 'senior' AND lower(fd.entity_data->>'seniority') ILIKE '%senior%')
         OR (lower(usl) = 'entry' AND lower(fd.entity_data->>'seniority') IN ('entry', 'entry level', 'entry-level', 'junior'))
    ))
    -- Departments filter (normalized matching)
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) udept
      WHERE lower(fd.entity_data->>'department') ILIKE '%' || lower(udept) || '%'
         OR (lower(udept) = 'engineering' AND lower(fd.entity_data->>'department') ~* '(engineering|developer|development|software|tech)')
         OR (lower(udept) = 'sales' AND lower(fd.entity_data->>'department') ~* '(sales|account)')
         OR (lower(udept) = 'marketing' AND lower(fd.entity_data->>'department') ~* '(marketing|growth|brand)')
         OR (lower(udept) = 'hr' AND lower(fd.entity_data->>'department') ~* '(hr|human resources|people|talent)')
         OR (lower(udept) = 'finance' AND lower(fd.entity_data->>'department') ~* '(finance|accounting|cfo)')
         OR (lower(udept) = 'operations' AND lower(fd.entity_data->>'department') ~* '(operations|ops|supply)')
         OR (lower(udept) = 'product' AND lower(fd.entity_data->>'department') ~* '(product|pm)')
         OR (lower(udept) = 'design' AND lower(fd.entity_data->>'department') ~* '(design|ux|ui|creative)')
         OR (lower(udept) = 'legal' AND lower(fd.entity_data->>'department') ~* '(legal|compliance|counsel)')
         OR (lower(udept) = 'it' AND lower(fd.entity_data->>'department') ~* '(it|information technology|infra)')
    ))
    -- Company size filter (with proper range parsing)
    AND (v_bypass_size OR p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) ucsr
      WHERE (
        -- Parse the stored companySize value
        CASE
          -- Handle "X to Y" format - extract upper bound
          WHEN fd.entity_data->>'companySize' ~* '^\d+\s*(to|-)\s*\d+$' THEN
            (regexp_match(fd.entity_data->>'companySize', '(\d+)\s*(?:to|-)\s*(\d+)'))[2]::int
          -- Handle "X+" format
          WHEN fd.entity_data->>'companySize' ~* '^\d+\+$' THEN
            regexp_replace(fd.entity_data->>'companySize', '\D', '', 'g')::int
          -- Handle plain numbers
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            (fd.entity_data->>'companySize')::int
          -- Handle employeeCount as fallback
          WHEN fd.entity_data->>'employeeCount' ~ '^\d+$' THEN
            (fd.entity_data->>'employeeCount')::int
          ELSE NULL
        END
      ) BETWEEN
        CASE ucsr
          WHEN '1-10' THEN 1
          WHEN '11-50' THEN 11
          WHEN '51-200' THEN 51
          WHEN '201-500' THEN 201
          WHEN '501-1000' THEN 501
          WHEN '1001-5000' THEN 1001
          WHEN '5001-10000' THEN 5001
          WHEN '10000+' THEN 10001
          WHEN '10001+' THEN 10001
          ELSE 1
        END
        AND
        CASE ucsr
          WHEN '1-10' THEN 10
          WHEN '11-50' THEN 50
          WHEN '51-200' THEN 200
          WHEN '201-500' THEN 500
          WHEN '501-1000' THEN 1000
          WHEN '1001-5000' THEN 5000
          WHEN '5001-10000' THEN 10000
          WHEN '10000+' THEN 999999999
          WHEN '10001+' THEN 999999999
          ELSE 999999999
        END
    ))
    -- Company revenue filter
    AND (v_bypass_revenue OR p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) ucr
      WHERE (
        CASE
          WHEN fd.entity_data->>'companyRevenue' IS NULL THEN NULL
          WHEN fd.entity_data->>'companyRevenue' ~* 'billion|B\+?$' THEN 1000000000
          WHEN fd.entity_data->>'companyRevenue' ~* '(\d+)\s*M' THEN
            (regexp_match(fd.entity_data->>'companyRevenue', '(\d+)'))[1]::bigint * 1000000
          WHEN fd.entity_data->>'companyRevenue' ~ '^\d+$' THEN
            (fd.entity_data->>'companyRevenue')::bigint
          ELSE NULL
        END
      ) BETWEEN
        CASE ucr
          WHEN 'Under $1M' THEN 0
          WHEN '$1M - $10M' THEN 1000000
          WHEN '$10M - $50M' THEN 10000000
          WHEN '$50M - $100M' THEN 50000000
          WHEN '$100M - $500M' THEN 100000000
          WHEN '$500M - $1B' THEN 500000000
          WHEN '$1B+' THEN 1000000000
          ELSE 0
        END
        AND
        CASE ucr
          WHEN 'Under $1M' THEN 999999
          WHEN '$1M - $10M' THEN 9999999
          WHEN '$10M - $50M' THEN 49999999
          WHEN '$50M - $100M' THEN 99999999
          WHEN '$100M - $500M' THEN 499999999
          WHEN '$500M - $1B' THEN 999999999
          WHEN '$1B+' THEN 999999999999
          ELSE 999999999999
        END
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) utech
      WHERE lower(fd.entity_data->>'technologies') ILIKE '%' || lower(utech) || '%'
         OR lower(fd.entity_data->>'techStack') ILIKE '%' || lower(utech) || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) ucity
      WHERE lower(fd.entity_data->>'city') ILIKE '%' || lower(ucity) || '%'
         OR lower(fd.entity_data->>'location') ILIKE '%' || lower(ucity) || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) ucountry
      WHERE lower(fd.entity_data->>'country') ILIKE '%' || lower(ucountry) || '%'
         OR lower(fd.entity_data->>'location') ILIKE '%' || lower(ucountry) || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR
      lower(fd.entity_data->>'gender') = ANY(SELECT lower(unnest(p_gender))))
    -- Income filter (parse "$XX" format, values are in thousands)
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) uinc
      WHERE (
        CASE
          WHEN fd.entity_data->>'incomeRange' IS NULL THEN NULL
          WHEN fd.entity_data->>'incomeRange' ~* 'less than' THEN 20
          WHEN fd.entity_data->>'incomeRange' ~ '\$(\d+)' THEN
            (regexp_match(fd.entity_data->>'incomeRange', '\$(\d+)'))[1]::int
          ELSE NULL
        END
      ) BETWEEN
        CASE uinc
          WHEN 'Under $50K' THEN 0
          WHEN '$50K - $100K' THEN 50
          WHEN '$100K - $200K' THEN 100
          WHEN '$200K - $500K' THEN 200
          WHEN '$500K - $1M' THEN 500
          WHEN '$1M+' THEN 1000
          ELSE 0
        END
        AND
        CASE uinc
          WHEN 'Under $50K' THEN 49
          WHEN '$50K - $100K' THEN 99
          WHEN '$100K - $200K' THEN 199
          WHEN '$200K - $500K' THEN 499
          WHEN '$500K - $1M' THEN 999
          WHEN '$1M+' THEN 999999
          ELSE 999999
        END
    ))
    -- Net worth filter (parse "$XXX" format, values are in thousands)
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) unw
      WHERE (
        CASE
          WHEN fd.entity_data->>'netWorth' IS NULL THEN NULL
          WHEN fd.entity_data->>'netWorth' ~ '^-' THEN NULL  -- Ignore negative values
          WHEN fd.entity_data->>'netWorth' ~ '\$(\d+)' THEN
            (regexp_match(fd.entity_data->>'netWorth', '\$(\d+)'))[1]::int
          ELSE NULL
        END
      ) BETWEEN
        CASE unw
          WHEN 'Under $100K' THEN 0
          WHEN '$100K - $500K' THEN 100
          WHEN '$500K - $1M' THEN 500
          WHEN '$1M - $5M' THEN 1000
          WHEN '$5M - $10M' THEN 5000
          WHEN '$10M - $50M' THEN 10000
          WHEN '$50M+' THEN 50000
          ELSE 0
        END
        AND
        CASE unw
          WHEN 'Under $100K' THEN 99
          WHEN '$100K - $500K' THEN 499
          WHEN '$500K - $1M' THEN 999
          WHEN '$1M - $5M' THEN 4999
          WHEN '$5M - $10M' THEN 9999
          WHEN '$10M - $50M' THEN 49999
          WHEN '$50M+' THEN 999999
          ELSE 999999
        END
    ))
    -- Skills filter (supports both comma-separated strings and JSON arrays)
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) uskill
      WHERE 
        -- Check comma-separated string format
        lower(fd.entity_data->>'skills') ILIKE '%' || lower(uskill) || '%'
        -- Also check if it's a JSON array
        OR (jsonb_typeof(fd.entity_data->'skills') = 'array' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'skills') skill_elem
          WHERE lower(skill_elem) ILIKE '%' || lower(uskill) || '%'
        ))
    ))
    -- Interests filter (supports both comma-separated strings and JSON arrays)
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) uinterest
      WHERE 
        -- Check comma-separated string format
        lower(fd.entity_data->>'interests') ILIKE '%' || lower(uinterest) || '%'
        -- Also check if it's a JSON array
        OR (jsonb_typeof(fd.entity_data->'interests') = 'array' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'interests') interest_elem
          WHERE lower(interest_elem) ILIKE '%' || lower(uinterest) || '%'
        ))
    ))
    -- Prospect data filters
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
      fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> ''
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
      fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> ''
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (
      fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> ''
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (
      fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> ''
    ))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (
      fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (
      fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> ''
      OR fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> ''
    ))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (
      fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (
      fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> ''
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (
      fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> ''
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (
      fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> ''
    ));

  -- Return paginated results with total count
  RETURN QUERY
  SELECT fd.entity_data, fd.entity_external_id, v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ui
      WHERE lower(fd.entity_data->>'industry') ILIKE '%' || lower(ui) || '%'
         OR lower(fd.entity_data->>'companyIndustry') ILIKE '%' || lower(ui) || '%'
    ))
    -- Keywords filter
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) uk
      WHERE lower(fd.entity_data::text) ILIKE '%' || lower(uk) || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) ujt
      WHERE lower(fd.entity_data->>'title') ILIKE '%' || lower(ujt) || '%'
         OR lower(fd.entity_data->>'jobTitle') ILIKE '%' || lower(ujt) || '%'
    ))
    -- Seniority filter (normalized matching)
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) usl
      WHERE lower(fd.entity_data->>'seniority') = lower(usl)
         OR lower(fd.entity_data->>'seniorityLevel') = lower(usl)
         OR (lower(usl) = 'c-suite' AND lower(fd.entity_data->>'seniority') IN ('c-level', 'c-suite', 'csuite', 'c level'))
         OR (lower(usl) = 'vp' AND lower(fd.entity_data->>'seniority') IN ('vp', 'vice president', 'vice-president'))
         OR (lower(usl) = 'director' AND lower(fd.entity_data->>'seniority') ILIKE '%director%')
         OR (lower(usl) = 'manager' AND lower(fd.entity_data->>'seniority') ILIKE '%manager%')
         OR (lower(usl) = 'senior' AND lower(fd.entity_data->>'seniority') ILIKE '%senior%')
         OR (lower(usl) = 'entry' AND lower(fd.entity_data->>'seniority') IN ('entry', 'entry level', 'entry-level', 'junior'))
    ))
    -- Departments filter (normalized matching)
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) udept
      WHERE lower(fd.entity_data->>'department') ILIKE '%' || lower(udept) || '%'
         OR (lower(udept) = 'engineering' AND lower(fd.entity_data->>'department') ~* '(engineering|developer|development|software|tech)')
         OR (lower(udept) = 'sales' AND lower(fd.entity_data->>'department') ~* '(sales|account)')
         OR (lower(udept) = 'marketing' AND lower(fd.entity_data->>'department') ~* '(marketing|growth|brand)')
         OR (lower(udept) = 'hr' AND lower(fd.entity_data->>'department') ~* '(hr|human resources|people|talent)')
         OR (lower(udept) = 'finance' AND lower(fd.entity_data->>'department') ~* '(finance|accounting|cfo)')
         OR (lower(udept) = 'operations' AND lower(fd.entity_data->>'department') ~* '(operations|ops|supply)')
         OR (lower(udept) = 'product' AND lower(fd.entity_data->>'department') ~* '(product|pm)')
         OR (lower(udept) = 'design' AND lower(fd.entity_data->>'department') ~* '(design|ux|ui|creative)')
         OR (lower(udept) = 'legal' AND lower(fd.entity_data->>'department') ~* '(legal|compliance|counsel)')
         OR (lower(udept) = 'it' AND lower(fd.entity_data->>'department') ~* '(it|information technology|infra)')
    ))
    -- Company size filter (with proper range parsing)
    AND (v_bypass_size OR p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) ucsr
      WHERE (
        CASE
          WHEN fd.entity_data->>'companySize' ~* '^\d+\s*(to|-)\s*\d+$' THEN
            (regexp_match(fd.entity_data->>'companySize', '(\d+)\s*(?:to|-)\s*(\d+)'))[2]::int
          WHEN fd.entity_data->>'companySize' ~* '^\d+\+$' THEN
            regexp_replace(fd.entity_data->>'companySize', '\D', '', 'g')::int
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            (fd.entity_data->>'companySize')::int
          WHEN fd.entity_data->>'employeeCount' ~ '^\d+$' THEN
            (fd.entity_data->>'employeeCount')::int
          ELSE NULL
        END
      ) BETWEEN
        CASE ucsr
          WHEN '1-10' THEN 1
          WHEN '11-50' THEN 11
          WHEN '51-200' THEN 51
          WHEN '201-500' THEN 201
          WHEN '501-1000' THEN 501
          WHEN '1001-5000' THEN 1001
          WHEN '5001-10000' THEN 5001
          WHEN '10000+' THEN 10001
          WHEN '10001+' THEN 10001
          ELSE 1
        END
        AND
        CASE ucsr
          WHEN '1-10' THEN 10
          WHEN '11-50' THEN 50
          WHEN '51-200' THEN 200
          WHEN '201-500' THEN 500
          WHEN '501-1000' THEN 1000
          WHEN '1001-5000' THEN 5000
          WHEN '5001-10000' THEN 10000
          WHEN '10000+' THEN 999999999
          WHEN '10001+' THEN 999999999
          ELSE 999999999
        END
    ))
    -- Company revenue filter
    AND (v_bypass_revenue OR p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) ucr
      WHERE (
        CASE
          WHEN fd.entity_data->>'companyRevenue' IS NULL THEN NULL
          WHEN fd.entity_data->>'companyRevenue' ~* 'billion|B\+?$' THEN 1000000000
          WHEN fd.entity_data->>'companyRevenue' ~* '(\d+)\s*M' THEN
            (regexp_match(fd.entity_data->>'companyRevenue', '(\d+)'))[1]::bigint * 1000000
          WHEN fd.entity_data->>'companyRevenue' ~ '^\d+$' THEN
            (fd.entity_data->>'companyRevenue')::bigint
          ELSE NULL
        END
      ) BETWEEN
        CASE ucr
          WHEN 'Under $1M' THEN 0
          WHEN '$1M - $10M' THEN 1000000
          WHEN '$10M - $50M' THEN 10000000
          WHEN '$50M - $100M' THEN 50000000
          WHEN '$100M - $500M' THEN 100000000
          WHEN '$500M - $1B' THEN 500000000
          WHEN '$1B+' THEN 1000000000
          ELSE 0
        END
        AND
        CASE ucr
          WHEN 'Under $1M' THEN 999999
          WHEN '$1M - $10M' THEN 9999999
          WHEN '$10M - $50M' THEN 49999999
          WHEN '$50M - $100M' THEN 99999999
          WHEN '$100M - $500M' THEN 499999999
          WHEN '$500M - $1B' THEN 999999999
          WHEN '$1B+' THEN 999999999999
          ELSE 999999999999
        END
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) utech
      WHERE lower(fd.entity_data->>'technologies') ILIKE '%' || lower(utech) || '%'
         OR lower(fd.entity_data->>'techStack') ILIKE '%' || lower(utech) || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) ucity
      WHERE lower(fd.entity_data->>'city') ILIKE '%' || lower(ucity) || '%'
         OR lower(fd.entity_data->>'location') ILIKE '%' || lower(ucity) || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) ucountry
      WHERE lower(fd.entity_data->>'country') ILIKE '%' || lower(ucountry) || '%'
         OR lower(fd.entity_data->>'location') ILIKE '%' || lower(ucountry) || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR
      lower(fd.entity_data->>'gender') = ANY(SELECT lower(unnest(p_gender))))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) uinc
      WHERE (
        CASE
          WHEN fd.entity_data->>'incomeRange' IS NULL THEN NULL
          WHEN fd.entity_data->>'incomeRange' ~* 'less than' THEN 20
          WHEN fd.entity_data->>'incomeRange' ~ '\$(\d+)' THEN
            (regexp_match(fd.entity_data->>'incomeRange', '\$(\d+)'))[1]::int
          ELSE NULL
        END
      ) BETWEEN
        CASE uinc
          WHEN 'Under $50K' THEN 0
          WHEN '$50K - $100K' THEN 50
          WHEN '$100K - $200K' THEN 100
          WHEN '$200K - $500K' THEN 200
          WHEN '$500K - $1M' THEN 500
          WHEN '$1M+' THEN 1000
          ELSE 0
        END
        AND
        CASE uinc
          WHEN 'Under $50K' THEN 49
          WHEN '$50K - $100K' THEN 99
          WHEN '$100K - $200K' THEN 199
          WHEN '$200K - $500K' THEN 499
          WHEN '$500K - $1M' THEN 999
          WHEN '$1M+' THEN 999999
          ELSE 999999
        END
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) unw
      WHERE (
        CASE
          WHEN fd.entity_data->>'netWorth' IS NULL THEN NULL
          WHEN fd.entity_data->>'netWorth' ~ '^-' THEN NULL
          WHEN fd.entity_data->>'netWorth' ~ '\$(\d+)' THEN
            (regexp_match(fd.entity_data->>'netWorth', '\$(\d+)'))[1]::int
          ELSE NULL
        END
      ) BETWEEN
        CASE unw
          WHEN 'Under $100K' THEN 0
          WHEN '$100K - $500K' THEN 100
          WHEN '$500K - $1M' THEN 500
          WHEN '$1M - $5M' THEN 1000
          WHEN '$5M - $10M' THEN 5000
          WHEN '$10M - $50M' THEN 10000
          WHEN '$50M+' THEN 50000
          ELSE 0
        END
        AND
        CASE unw
          WHEN 'Under $100K' THEN 99
          WHEN '$100K - $500K' THEN 499
          WHEN '$500K - $1M' THEN 999
          WHEN '$1M - $5M' THEN 4999
          WHEN '$5M - $10M' THEN 9999
          WHEN '$10M - $50M' THEN 49999
          WHEN '$50M+' THEN 999999
          ELSE 999999
        END
    ))
    -- Skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) uskill
      WHERE 
        lower(fd.entity_data->>'skills') ILIKE '%' || lower(uskill) || '%'
        OR (jsonb_typeof(fd.entity_data->'skills') = 'array' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'skills') skill_elem
          WHERE lower(skill_elem) ILIKE '%' || lower(uskill) || '%'
        ))
    ))
    -- Interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) uinterest
      WHERE 
        lower(fd.entity_data->>'interests') ILIKE '%' || lower(uinterest) || '%'
        OR (jsonb_typeof(fd.entity_data->'interests') = 'array' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(fd.entity_data->'interests') interest_elem
          WHERE lower(interest_elem) ILIKE '%' || lower(uinterest) || '%'
        ))
    ))
    -- Prospect data filters
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
      fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> ''
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
      fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> ''
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (
      fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> ''
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (
      fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> ''
    ))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (
      fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (
      fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> ''
      OR fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> ''
    ))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (
      fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (
      fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> ''
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (
      fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> ''
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (
      fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> ''
    ))
  LIMIT p_limit
  OFFSET p_offset;
END;
$func$;