-- Create helper function to extract upper bound from employee count ranges
CREATE OR REPLACE FUNCTION public.parse_employee_count_upper(size_str text)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF size_str IS NULL OR size_str = '' THEN
    RETURN NULL;
  END IF;
  
  -- Handle "26 to 50" format → extract upper bound (50)
  IF size_str ~* '\d+\s+to\s+\d+' THEN
    RETURN CAST(REGEXP_REPLACE(size_str, '^.*\s+to\s+', '', 'i') AS INTEGER);
  END IF;
  
  -- Handle "51-200" format → extract upper bound (200)  
  IF size_str ~ '\d+-\d+' THEN
    RETURN CAST(SPLIT_PART(size_str, '-', 2) AS INTEGER);
  END IF;
  
  -- Handle "1000+" or "10000+" format → return the number
  IF size_str ~ '\d+\+' THEN
    RETURN CAST(REGEXP_REPLACE(size_str, '\+', '', 'g') AS INTEGER);
  END IF;
  
  -- Single number fallback
  IF size_str ~ '^\d+$' THEN
    RETURN CAST(size_str AS INTEGER);
  END IF;
  
  -- Extract first number as last resort (handles "500 employees" etc)
  IF size_str ~ '\d+' THEN
    RETURN CAST((REGEXP_MATCHES(size_str, '\d+'))[1] AS INTEGER);
  END IF;
  
  RETURN NULL;
END;
$$;

-- Update search_free_data_with_filters to use the new helper function
CREATE OR REPLACE FUNCTION public.search_free_data_with_filters(p_entity_type entity_type, p_keywords text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_cities text[] DEFAULT NULL::text[], p_gender text DEFAULT NULL::text, p_job_titles text[] DEFAULT NULL::text[], p_seniority text[] DEFAULT NULL::text[], p_department text[] DEFAULT NULL::text[], p_company_size text[] DEFAULT NULL::text[], p_net_worth text[] DEFAULT NULL::text[], p_income text[] DEFAULT NULL::text[], p_has_personal_email boolean DEFAULT NULL::boolean, p_has_business_email boolean DEFAULT NULL::boolean, p_has_phone boolean DEFAULT NULL::boolean, p_has_linkedin boolean DEFAULT NULL::boolean, p_has_facebook boolean DEFAULT NULL::boolean, p_has_twitter boolean DEFAULT NULL::boolean, p_person_city text[] DEFAULT NULL::text[], p_person_country text[] DEFAULT NULL::text[], p_company_city text[] DEFAULT NULL::text[], p_company_country text[] DEFAULT NULL::text[], p_person_interests text[] DEFAULT NULL::text[], p_person_skills text[] DEFAULT NULL::text[], p_company_revenue text[] DEFAULT NULL::text[], p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, entity_type entity_type, entity_external_id text, entity_data jsonb, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_employee_count integer;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords search - EXPANDED to search all relevant text fields
    AND (
      p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) AS k
        WHERE 
          (fd.entity_data->>'description') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'company') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'name') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'title') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyDescription') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'industry') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyIndustry') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'firstName') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'lastName') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'skills') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'interests') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'department') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'city') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'state') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'country') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyCity') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyState') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyCountry') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'educationHistory') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'jobTitle') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'location') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'address') ILIKE '%' || k || '%'
      )
    )
    -- Industries filter
    AND (
      p_industries IS NULL OR array_length(p_industries, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_industries) AS ind
        WHERE (fd.entity_data->>'industry') ILIKE '%' || ind || '%'
           OR (fd.entity_data->>'companyIndustry') ILIKE '%' || ind || '%'
      )
    )
    -- Cities filter (legacy)
    AND (
      p_cities IS NULL OR array_length(p_cities, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_cities) AS c
        WHERE (fd.entity_data->>'city') ILIKE '%' || c || '%'
           OR (fd.entity_data->>'location') ILIKE '%' || c || '%'
           OR (fd.entity_data->>'address') ILIKE '%' || c || '%'
           OR (fd.entity_data->>'companyCity') ILIKE '%' || c || '%'
      )
    )
    -- Person City filter
    AND (
      p_person_city IS NULL OR array_length(p_person_city, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_city) AS pc
        WHERE (fd.entity_data->>'city') ILIKE '%' || pc || '%'
      )
    )
    -- Person Country filter
    AND (
      p_person_country IS NULL OR array_length(p_person_country, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_country) AS pco
        WHERE (fd.entity_data->>'country') ILIKE '%' || pco || '%'
      )
    )
    -- Company City filter
    AND (
      p_company_city IS NULL OR array_length(p_company_city, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_city) AS cc
        WHERE (fd.entity_data->>'companyCity') ILIKE '%' || cc || '%'
      )
    )
    -- Company Country filter
    AND (
      p_company_country IS NULL OR array_length(p_company_country, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_country) AS cco
        WHERE (fd.entity_data->>'companyCountry') ILIKE '%' || cco || '%'
      )
    )
    -- Person Interests filter
    AND (
      p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_interests) AS pi
        WHERE (fd.entity_data->>'interests') ILIKE '%' || pi || '%'
      )
    )
    -- Person Skills filter
    AND (
      p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_skills) AS ps
        WHERE (fd.entity_data->>'skills') ILIKE '%' || ps || '%'
      )
    )
    -- Gender filter
    AND (
      p_gender IS NULL OR p_gender = ''
      OR (fd.entity_data->>'gender') = p_gender
    )
    -- Job titles filter
    AND (
      p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_job_titles) AS jt
        WHERE (fd.entity_data->>'title') ILIKE '%' || jt || '%'
      )
    )
    -- Seniority filter (TITLE-ONLY; strict word boundaries)
    AND public.title_matches_seniority(fd.entity_data->>'title', p_seniority)
    -- Department filter
    AND (
      p_department IS NULL OR array_length(p_department, 1) IS NULL
      OR LOWER(fd.entity_data->>'department') = ANY(SELECT LOWER(unnest(p_department)))
    )
    -- Company size filter using the new helper function
    AND (
      p_company_size IS NULL OR array_length(p_company_size, 1) IS NULL
      OR (
        public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) IS NOT NULL
        AND (
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '1-10')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 1 AND 10)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '11-50')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 11 AND 50)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '51-200')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 51 AND 200)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '201-500')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 201 AND 500)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '501-1000')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 501 AND 1000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '1001-5000')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 1001 AND 5000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '5001-10000')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 5001 AND 10000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '10000+')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) >= 10001)
        )
      )
    )
    -- Net worth filter with RANGE-BASED matching
    AND (
      p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL
      OR (
        CASE 
          WHEN fd.entity_data->>'netWorth' IS NOT NULL 
               AND fd.entity_data->>'netWorth' ~ '^\$?[0-9,]+$'
          THEN 
            CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric)
          ELSE NULL
        END IS NOT NULL
        AND (
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = 'Under $100K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 100)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$100K - $500K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 100
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 500)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$500K - $1M')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 500
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 1000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$1M - $5M')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 1000
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 5000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$5M - $10M')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 5000
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 10000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$10M - $50M')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 10000
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 50000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$50M+')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 50000)
        )
      )
    )
    -- Income filter with RANGE-BASED matching
    AND (
      p_income IS NULL OR array_length(p_income, 1) IS NULL
      OR (
        CASE 
          WHEN fd.entity_data->>'incomeRange' IS NOT NULL 
               AND fd.entity_data->>'incomeRange' ~ '^\$?[0-9,]+$'
          THEN 
            CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric)
          ELSE NULL
        END IS NOT NULL
        AND (
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = 'Under $50K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) < 50)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = '$50K - $100K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) >= 50
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) < 100)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = '$100K - $200K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) >= 100
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) < 200)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = '$200K - $500K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) >= 200
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) < 500)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = '$500K+')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) >= 500)
        )
      )
    )
    -- Company Revenue filter
    AND (
      p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL
      OR (fd.entity_data->>'companyRevenue') = ANY(p_company_revenue)
    )
    -- Has personal email
    AND (
      p_has_personal_email IS NULL OR p_has_personal_email = false
      OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> '')
    )
    -- Has business email
    AND (
      p_has_business_email IS NULL OR p_has_business_email = false
      OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> '')
    )
    -- Has phone
    AND (
      p_has_phone IS NULL OR p_has_phone = false
      OR (fd.entity_data->>'phoneNumber' IS NOT NULL AND fd.entity_data->>'phoneNumber' <> '')
    )
    -- Has LinkedIn
    AND (
      p_has_linkedin IS NULL OR p_has_linkedin = false
      OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> '')
    )
    -- Has Facebook
    AND (
      p_has_facebook IS NULL OR p_has_facebook = false
      OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> '')
    )
    -- Has Twitter
    AND (
      p_has_twitter IS NULL OR p_has_twitter = false
      OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> '')
    );

  -- Return query with same filters
  RETURN QUERY
  SELECT fd.id, fd.entity_type, fd.entity_external_id, fd.entity_data, fd.created_at, v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords search - EXPANDED
    AND (
      p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) AS k
        WHERE 
          (fd.entity_data->>'description') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'company') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'name') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'title') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyDescription') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'industry') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyIndustry') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'firstName') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'lastName') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'skills') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'interests') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'department') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'city') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'state') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'country') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyCity') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyState') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyCountry') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'educationHistory') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'jobTitle') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'location') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'address') ILIKE '%' || k || '%'
      )
    )
    AND (
      p_industries IS NULL OR array_length(p_industries, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_industries) AS ind
        WHERE (fd.entity_data->>'industry') ILIKE '%' || ind || '%'
           OR (fd.entity_data->>'companyIndustry') ILIKE '%' || ind || '%'
      )
    )
    AND (
      p_cities IS NULL OR array_length(p_cities, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_cities) AS c
        WHERE (fd.entity_data->>'city') ILIKE '%' || c || '%'
           OR (fd.entity_data->>'location') ILIKE '%' || c || '%'
           OR (fd.entity_data->>'address') ILIKE '%' || c || '%'
           OR (fd.entity_data->>'companyCity') ILIKE '%' || c || '%'
      )
    )
    AND (
      p_person_city IS NULL OR array_length(p_person_city, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_city) AS pc
        WHERE (fd.entity_data->>'city') ILIKE '%' || pc || '%'
      )
    )
    AND (
      p_person_country IS NULL OR array_length(p_person_country, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_country) AS pco
        WHERE (fd.entity_data->>'country') ILIKE '%' || pco || '%'
      )
    )
    AND (
      p_company_city IS NULL OR array_length(p_company_city, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_city) AS cc
        WHERE (fd.entity_data->>'companyCity') ILIKE '%' || cc || '%'
      )
    )
    AND (
      p_company_country IS NULL OR array_length(p_company_country, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_country) AS cco
        WHERE (fd.entity_data->>'companyCountry') ILIKE '%' || cco || '%'
      )
    )
    AND (
      p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_interests) AS pi
        WHERE (fd.entity_data->>'interests') ILIKE '%' || pi || '%'
      )
    )
    AND (
      p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_skills) AS ps
        WHERE (fd.entity_data->>'skills') ILIKE '%' || ps || '%'
      )
    )
    AND (
      p_gender IS NULL OR p_gender = ''
      OR (fd.entity_data->>'gender') = p_gender
    )
    AND (
      p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_job_titles) AS jt
        WHERE (fd.entity_data->>'title') ILIKE '%' || jt || '%'
      )
    )
    AND public.title_matches_seniority(fd.entity_data->>'title', p_seniority)
    AND (
      p_department IS NULL OR array_length(p_department, 1) IS NULL
      OR LOWER(fd.entity_data->>'department') = ANY(SELECT LOWER(unnest(p_department)))
    )
    -- Company size filter using the new helper function
    AND (
      p_company_size IS NULL OR array_length(p_company_size, 1) IS NULL
      OR (
        public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) IS NOT NULL
        AND (
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '1-10')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 1 AND 10)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '11-50')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 11 AND 50)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '51-200')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 51 AND 200)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '201-500')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 201 AND 500)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '501-1000')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 501 AND 1000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '1001-5000')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 1001 AND 5000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '5001-10000')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) BETWEEN 5001 AND 10000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '10000+')
           AND public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '')) >= 10001)
        )
      )
    )
    AND (
      p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL
      OR (
        CASE 
          WHEN fd.entity_data->>'netWorth' IS NOT NULL 
               AND fd.entity_data->>'netWorth' ~ '^\$?[0-9,]+$'
          THEN 
            CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric)
          ELSE NULL
        END IS NOT NULL
        AND (
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = 'Under $100K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 100)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$100K - $500K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 100
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 500)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$500K - $1M')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 500
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 1000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$1M - $5M')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 1000
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 5000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$5M - $10M')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 5000
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 10000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$10M - $50M')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 10000
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) < 50000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_net_worth) nw WHERE nw = '$50M+')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[$,]', '', 'g') AS numeric) >= 50000)
        )
      )
    )
    AND (
      p_income IS NULL OR array_length(p_income, 1) IS NULL
      OR (
        CASE 
          WHEN fd.entity_data->>'incomeRange' IS NOT NULL 
               AND fd.entity_data->>'incomeRange' ~ '^\$?[0-9,]+$'
          THEN 
            CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric)
          ELSE NULL
        END IS NOT NULL
        AND (
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = 'Under $50K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) < 50)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = '$50K - $100K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) >= 50
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) < 100)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = '$100K - $200K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) >= 100
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) < 200)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = '$200K - $500K')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) >= 200
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) < 500)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_income) inc WHERE inc = '$500K+')
           AND CAST(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[$,]', '', 'g') AS numeric) >= 500)
        )
      )
    )
    AND (
      p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL
      OR (fd.entity_data->>'companyRevenue') = ANY(p_company_revenue)
    )
    AND (
      p_has_personal_email IS NULL OR p_has_personal_email = false
      OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> '')
    )
    AND (
      p_has_business_email IS NULL OR p_has_business_email = false
      OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> '')
    )
    AND (
      p_has_phone IS NULL OR p_has_phone = false
      OR (fd.entity_data->>'phoneNumber' IS NOT NULL AND fd.entity_data->>'phoneNumber' <> '')
    )
    AND (
      p_has_linkedin IS NULL OR p_has_linkedin = false
      OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> '')
    )
    AND (
      p_has_facebook IS NULL OR p_has_facebook = false
      OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> '')
    )
    AND (
      p_has_twitter IS NULL OR p_has_twitter = false
      OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> '')
    )
  ORDER BY fd.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;