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
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
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
AS $$
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
    -- Cities filter
    AND (
      p_cities IS NULL OR array_length(p_cities, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_cities) AS c
        WHERE (fd.entity_data->>'city') ILIKE '%' || c || '%'
           OR (fd.entity_data->>'location') ILIKE '%' || c || '%'
           OR (fd.entity_data->>'companyCity') ILIKE '%' || c || '%'
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
    -- Seniority filter
    AND (
      p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL
      OR (fd.entity_data->>'seniority') = ANY(p_seniority)
    )
    -- Department filter
    AND (
      p_department IS NULL OR array_length(p_department, 1) IS NULL
      OR (fd.entity_data->>'department') = ANY(p_department)
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
           OR (fd.entity_data->>'companyCity') ILIKE '%' || c || '%'
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
      OR (fd.entity_data->>'seniority') = ANY(p_seniority)
    )
    AND (
      p_department IS NULL OR array_length(p_department, 1) IS NULL
      OR (fd.entity_data->>'department') = ANY(p_department)
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
$$;