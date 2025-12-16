-- Update search_free_data_with_filters to fix company size filter with range-based matching
-- This searches both companySize and employeeCount fields and uses numeric range matching

CREATE OR REPLACE FUNCTION public.search_free_data_with_filters(
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
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  entity_type entity_type,
  entity_external_id text,
  entity_data jsonb,
  created_at timestamp with time zone,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords search
    AND (
      p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) AS k
        WHERE 
          (fd.entity_data->>'description') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'company') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'name') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'title') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyDescription') ILIKE '%' || k || '%'
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
    -- Seniority filter with smart matching
    AND (
      p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL
      OR (
        LOWER(fd.entity_data->>'seniority') = ANY(SELECT LOWER(unnest(p_seniority)))
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) IN ('cxo', 'c-level', 'c level'))
          AND (
            (fd.entity_data->>'title') ILIKE '%CEO%' OR
            (fd.entity_data->>'title') ILIKE '%CTO%' OR
            (fd.entity_data->>'title') ILIKE '%CFO%' OR
            (fd.entity_data->>'title') ILIKE '%CMO%' OR
            (fd.entity_data->>'title') ILIKE '%CISO%' OR
            (fd.entity_data->>'title') ILIKE '%CIO%' OR
            (fd.entity_data->>'title') ILIKE '%CSO%' OR
            (fd.entity_data->>'title') ILIKE '%COO%' OR
            (fd.entity_data->>'title') ILIKE '%CHRO%' OR
            (fd.entity_data->>'title') ILIKE '%CRO%' OR
            (fd.entity_data->>'title') ILIKE '%Chief %'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'president')
          AND (
            ((fd.entity_data->>'title') ILIKE '%President%' AND (fd.entity_data->>'title') NOT ILIKE '%Vice President%')
            OR LOWER(fd.entity_data->>'seniority') = 'president'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) IN ('vp', 'vice president'))
          AND (
            (fd.entity_data->>'title') ILIKE '%Vice President%' 
            OR (fd.entity_data->>'title') ILIKE '% VP %'
            OR (fd.entity_data->>'title') ILIKE 'VP %'
            OR (fd.entity_data->>'title') ILIKE '% VP'
            OR LOWER(fd.entity_data->>'seniority') = 'vp'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'director')
          AND (
            (fd.entity_data->>'title') ILIKE '%Director%'
            OR LOWER(fd.entity_data->>'seniority') = 'director'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'head of')
          AND (
            (fd.entity_data->>'title') ILIKE '%Head of%'
            OR (fd.entity_data->>'title') ILIKE '%Principal%'
            OR (fd.entity_data->>'title') ILIKE '%Managing Director%'
            OR LOWER(fd.entity_data->>'seniority') = 'head of'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'manager')
          AND (
            (fd.entity_data->>'title') ILIKE '%Manager%'
            OR LOWER(fd.entity_data->>'seniority') = 'manager'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'individual contributor')
          AND (
            (fd.entity_data->>'title') NOT ILIKE '%CEO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CTO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CFO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CMO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CISO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CIO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CSO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%COO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CHRO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CRO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Chief %'
            AND NOT ((fd.entity_data->>'title') ILIKE '%President%' AND (fd.entity_data->>'title') NOT ILIKE '%Vice President%')
            AND (fd.entity_data->>'title') NOT ILIKE '%Vice President%'
            AND (fd.entity_data->>'title') NOT ILIKE '% VP %'
            AND (fd.entity_data->>'title') NOT ILIKE 'VP %'
            AND (fd.entity_data->>'title') NOT ILIKE '% VP'
            AND (fd.entity_data->>'title') NOT ILIKE '%Director%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Head of%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Principal%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Managing Director%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Manager%'
          )
        )
      )
    )
    -- Department filter
    AND (
      p_department IS NULL OR array_length(p_department, 1) IS NULL
      OR LOWER(fd.entity_data->>'department') = ANY(SELECT LOWER(unnest(p_department)))
    )
    -- Company size filter with RANGE-BASED matching across both companySize and employeeCount fields
    AND (
      p_company_size IS NULL OR array_length(p_company_size, 1) IS NULL
      OR (
        -- Extract first numeric value from either companySize or employeeCount
        COALESCE(
          NULLIF(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9].*', '', 'g'), ''),
          NULL
        ) IS NOT NULL
        AND (
          -- 1-10: matches 1 to 10 employees
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '1-10')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 1 AND 10)
          OR
          -- 11-50: matches 11 to 50 employees
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '11-50')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 11 AND 50)
          OR
          -- 51-200: matches 51 to 200 employees
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '51-200')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 51 AND 200)
          OR
          -- 201-500: matches 201 to 500 employees
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '201-500')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 201 AND 500)
          OR
          -- 501-1000: matches 501 to 1000 employees
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '501-1000')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 501 AND 1000)
          OR
          -- 1001-5000: matches 1001 to 5000 employees
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '1001-5000')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 1001 AND 5000)
          OR
          -- 5001-10000: matches 5001 to 10000 employees
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '5001-10000')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 5001 AND 10000)
          OR
          -- 10000+: matches over 10000 employees
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '10000+')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) >= 10001)
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
    AND (
      p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) AS k
        WHERE 
          (fd.entity_data->>'description') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'company') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'name') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'title') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyDescription') ILIKE '%' || k || '%'
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
    AND (
      p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL
      OR (
        LOWER(fd.entity_data->>'seniority') = ANY(SELECT LOWER(unnest(p_seniority)))
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) IN ('cxo', 'c-level', 'c level'))
          AND (
            (fd.entity_data->>'title') ILIKE '%CEO%' OR
            (fd.entity_data->>'title') ILIKE '%CTO%' OR
            (fd.entity_data->>'title') ILIKE '%CFO%' OR
            (fd.entity_data->>'title') ILIKE '%CMO%' OR
            (fd.entity_data->>'title') ILIKE '%CISO%' OR
            (fd.entity_data->>'title') ILIKE '%CIO%' OR
            (fd.entity_data->>'title') ILIKE '%CSO%' OR
            (fd.entity_data->>'title') ILIKE '%COO%' OR
            (fd.entity_data->>'title') ILIKE '%CHRO%' OR
            (fd.entity_data->>'title') ILIKE '%CRO%' OR
            (fd.entity_data->>'title') ILIKE '%Chief %'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'president')
          AND (
            ((fd.entity_data->>'title') ILIKE '%President%' AND (fd.entity_data->>'title') NOT ILIKE '%Vice President%')
            OR LOWER(fd.entity_data->>'seniority') = 'president'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) IN ('vp', 'vice president'))
          AND (
            (fd.entity_data->>'title') ILIKE '%Vice President%' 
            OR (fd.entity_data->>'title') ILIKE '% VP %'
            OR (fd.entity_data->>'title') ILIKE 'VP %'
            OR (fd.entity_data->>'title') ILIKE '% VP'
            OR LOWER(fd.entity_data->>'seniority') = 'vp'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'director')
          AND (
            (fd.entity_data->>'title') ILIKE '%Director%'
            OR LOWER(fd.entity_data->>'seniority') = 'director'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'head of')
          AND (
            (fd.entity_data->>'title') ILIKE '%Head of%'
            OR (fd.entity_data->>'title') ILIKE '%Principal%'
            OR (fd.entity_data->>'title') ILIKE '%Managing Director%'
            OR LOWER(fd.entity_data->>'seniority') = 'head of'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'manager')
          AND (
            (fd.entity_data->>'title') ILIKE '%Manager%'
            OR LOWER(fd.entity_data->>'seniority') = 'manager'
          )
        )
        OR (
          EXISTS (SELECT 1 FROM unnest(p_seniority) s WHERE LOWER(s) = 'individual contributor')
          AND (
            (fd.entity_data->>'title') NOT ILIKE '%CEO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CTO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CFO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CMO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CISO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CIO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CSO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%COO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CHRO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%CRO%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Chief %'
            AND NOT ((fd.entity_data->>'title') ILIKE '%President%' AND (fd.entity_data->>'title') NOT ILIKE '%Vice President%')
            AND (fd.entity_data->>'title') NOT ILIKE '%Vice President%'
            AND (fd.entity_data->>'title') NOT ILIKE '% VP %'
            AND (fd.entity_data->>'title') NOT ILIKE 'VP %'
            AND (fd.entity_data->>'title') NOT ILIKE '% VP'
            AND (fd.entity_data->>'title') NOT ILIKE '%Director%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Head of%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Principal%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Managing Director%'
            AND (fd.entity_data->>'title') NOT ILIKE '%Manager%'
          )
        )
      )
    )
    AND (
      p_department IS NULL OR array_length(p_department, 1) IS NULL
      OR LOWER(fd.entity_data->>'department') = ANY(SELECT LOWER(unnest(p_department)))
    )
    -- Company size filter with RANGE-BASED matching
    AND (
      p_company_size IS NULL OR array_length(p_company_size, 1) IS NULL
      OR (
        COALESCE(
          NULLIF(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9].*', '', 'g'), ''),
          NULL
        ) IS NOT NULL
        AND (
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '1-10')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 1 AND 10)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '11-50')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 11 AND 50)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '51-200')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 51 AND 200)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '201-500')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 201 AND 500)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '501-1000')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 501 AND 1000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '1001-5000')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 1001 AND 5000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '5001-10000')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) BETWEEN 5001 AND 10000)
          OR
          (EXISTS (SELECT 1 FROM unnest(p_company_size) cs WHERE cs = '10000+')
           AND CAST(REGEXP_REPLACE(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0'), '[^0-9].*', '', 'g') AS INTEGER) >= 10001)
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