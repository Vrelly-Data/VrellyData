-- Drop and recreate the search function with new location filter parameters
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
    -- Keywords search across multiple text fields
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
    -- Cities filter (legacy - searches location field)
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
    -- Gender filter (M/F format)
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
    -- Company size filter
    AND (
      p_company_size IS NULL OR array_length(p_company_size, 1) IS NULL
      OR (fd.entity_data->>'employeeCount') = ANY(p_company_size)
    )
    -- Net worth filter
    AND (
      p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL
      OR (fd.entity_data->>'netWorth') = ANY(p_net_worth)
    )
    -- Income filter
    AND (
      p_income IS NULL OR array_length(p_income, 1) IS NULL
      OR (fd.entity_data->>'incomeRange') = ANY(p_income)
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
    -- Seniority filter with smart matching (same logic as count query)
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
    AND (
      p_company_size IS NULL OR array_length(p_company_size, 1) IS NULL
      OR (fd.entity_data->>'employeeCount') = ANY(p_company_size)
    )
    AND (
      p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL
      OR (fd.entity_data->>'netWorth') = ANY(p_net_worth)
    )
    AND (
      p_income IS NULL OR array_length(p_income, 1) IS NULL
      OR (fd.entity_data->>'incomeRange') = ANY(p_income)
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