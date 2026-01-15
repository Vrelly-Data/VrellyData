CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type TEXT DEFAULT 'person',
  p_countries TEXT[] DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_industries TEXT[] DEFAULT NULL,
  p_company_size_ranges TEXT[] DEFAULT NULL,
  p_company_revenue TEXT[] DEFAULT NULL,
  p_job_titles TEXT[] DEFAULT NULL,
  p_seniority_levels TEXT[] DEFAULT NULL,
  p_departments TEXT[] DEFAULT NULL,
  p_keywords TEXT[] DEFAULT NULL,
  p_gender TEXT[] DEFAULT NULL,
  p_income TEXT[] DEFAULT NULL,
  p_net_worth TEXT[] DEFAULT NULL,
  p_person_interests TEXT[] DEFAULT NULL,
  p_person_skills TEXT[] DEFAULT NULL,
  p_has_personal_email BOOLEAN DEFAULT NULL,
  p_has_business_email BOOLEAN DEFAULT NULL,
  p_has_phone BOOLEAN DEFAULT NULL,
  p_has_linkedin BOOLEAN DEFAULT NULL,
  p_has_facebook BOOLEAN DEFAULT NULL,
  p_has_twitter BOOLEAN DEFAULT NULL,
  p_has_company_phone BOOLEAN DEFAULT NULL,
  p_has_company_linkedin BOOLEAN DEFAULT NULL,
  p_has_company_facebook BOOLEAN DEFAULT NULL,
  p_has_company_twitter BOOLEAN DEFAULT NULL,
  p_technologies TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  entity_data JSONB,
  entity_external_id TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  -- First, get the total count
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Location filters
    AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries))
    AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities))
    -- Company filters
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'employeeCountRange' = ANY(p_company_size_ranges))
    AND (p_company_revenue IS NULL OR fd.entity_data->>'revenueRange' = ANY(p_company_revenue))
    -- Technologies filter
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE 
          WHEN jsonb_typeof(fd.entity_data->'technologies') = 'array' THEN fd.entity_data->'technologies'
          ELSE '[]'::jsonb
        END
      ) tech WHERE tech = ANY(p_technologies)
    ))
    -- Job filters
    AND (p_job_titles IS NULL OR 
      fd.entity_data->>'jobTitle' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%') OR
      fd.entity_data->>'title' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%')
    )
    AND (p_seniority_levels IS NULL OR title_matches_seniority(COALESCE(fd.entity_data->>'jobTitle', fd.entity_data->>'title', ''), p_seniority_levels))
    AND (p_departments IS NULL OR fd.entity_data->>'department' = ANY(p_departments))
    -- Keywords filter (search in multiple fields)
    AND (p_keywords IS NULL OR (
      fd.entity_data->>'jobTitle' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%') OR
      fd.entity_data->>'title' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%') OR
      fd.entity_data->>'companyName' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%') OR
      fd.entity_data->>'name' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%') OR
      fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%')
    ))
    -- Demographics filters
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    AND (p_income IS NULL OR fd.entity_data->>'incomeRange' = ANY(p_income))
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorthRange' = ANY(p_net_worth))
    -- Interests and skills
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE 
          WHEN jsonb_typeof(fd.entity_data->'interests') = 'array' THEN fd.entity_data->'interests'
          ELSE '[]'::jsonb
        END
      ) interest WHERE interest = ANY(p_person_interests)
    ))
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE 
          WHEN jsonb_typeof(fd.entity_data->'skills') = 'array' THEN fd.entity_data->'skills'
          ELSE '[]'::jsonb
        END
      ) skill WHERE skill = ANY(p_person_skills)
    ))
    -- Contact availability filters
    AND (p_has_personal_email IS NULL OR 
      (p_has_personal_email = true AND fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') OR
      (p_has_personal_email = false AND (fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = ''))
    )
    AND (p_has_business_email IS NULL OR 
      (p_has_business_email = true AND fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '') OR
      (p_has_business_email = false AND (fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = ''))
    )
    AND (p_has_phone IS NULL OR 
      (p_has_phone = true AND fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
      (p_has_phone = false AND (fd.entity_data->>'phone' IS NULL OR fd.entity_data->>'phone' = ''))
    )
    AND (p_has_linkedin IS NULL OR 
      (p_has_linkedin = true AND fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != '') OR
      (p_has_linkedin = false AND (fd.entity_data->>'linkedinUrl' IS NULL OR fd.entity_data->>'linkedinUrl' = ''))
    )
    AND (p_has_facebook IS NULL OR 
      (p_has_facebook = true AND fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '') OR
      (p_has_facebook = false AND (fd.entity_data->>'facebookUrl' IS NULL OR fd.entity_data->>'facebookUrl' = ''))
    )
    AND (p_has_twitter IS NULL OR 
      (p_has_twitter = true AND fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '') OR
      (p_has_twitter = false AND (fd.entity_data->>'twitterUrl' IS NULL OR fd.entity_data->>'twitterUrl' = ''))
    )
    AND (p_has_company_phone IS NULL OR 
      (p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != '') OR
      (p_has_company_phone = false AND (fd.entity_data->>'companyPhone' IS NULL OR fd.entity_data->>'companyPhone' = ''))
    )
    AND (p_has_company_linkedin IS NULL OR 
      (p_has_company_linkedin = true AND fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != '') OR
      (p_has_company_linkedin = false AND (fd.entity_data->>'companyLinkedinUrl' IS NULL OR fd.entity_data->>'companyLinkedinUrl' = ''))
    )
    AND (p_has_company_facebook IS NULL OR 
      (p_has_company_facebook = true AND fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != '') OR
      (p_has_company_facebook = false AND (fd.entity_data->>'companyFacebookUrl' IS NULL OR fd.entity_data->>'companyFacebookUrl' = ''))
    )
    AND (p_has_company_twitter IS NULL OR 
      (p_has_company_twitter = true AND fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != '') OR
      (p_has_company_twitter = false AND (fd.entity_data->>'companyTwitterUrl' IS NULL OR fd.entity_data->>'companyTwitterUrl' = ''))
    );

  -- Return the paginated results with the total count
  RETURN QUERY
  SELECT 
    fd.entity_data,
    fd.entity_external_id,
    v_total as total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Location filters
    AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries))
    AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities))
    -- Company filters
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'employeeCountRange' = ANY(p_company_size_ranges))
    AND (p_company_revenue IS NULL OR fd.entity_data->>'revenueRange' = ANY(p_company_revenue))
    -- Technologies filter
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE 
          WHEN jsonb_typeof(fd.entity_data->'technologies') = 'array' THEN fd.entity_data->'technologies'
          ELSE '[]'::jsonb
        END
      ) tech WHERE tech = ANY(p_technologies)
    ))
    -- Job filters
    AND (p_job_titles IS NULL OR 
      fd.entity_data->>'jobTitle' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%') OR
      fd.entity_data->>'title' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%')
    )
    AND (p_seniority_levels IS NULL OR title_matches_seniority(COALESCE(fd.entity_data->>'jobTitle', fd.entity_data->>'title', ''), p_seniority_levels))
    AND (p_departments IS NULL OR fd.entity_data->>'department' = ANY(p_departments))
    -- Keywords filter (search in multiple fields)
    AND (p_keywords IS NULL OR (
      fd.entity_data->>'jobTitle' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%') OR
      fd.entity_data->>'title' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%') OR
      fd.entity_data->>'companyName' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%') OR
      fd.entity_data->>'name' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%') OR
      fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%')
    ))
    -- Demographics filters
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    AND (p_income IS NULL OR fd.entity_data->>'incomeRange' = ANY(p_income))
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorthRange' = ANY(p_net_worth))
    -- Interests and skills
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE 
          WHEN jsonb_typeof(fd.entity_data->'interests') = 'array' THEN fd.entity_data->'interests'
          ELSE '[]'::jsonb
        END
      ) interest WHERE interest = ANY(p_person_interests)
    ))
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE 
          WHEN jsonb_typeof(fd.entity_data->'skills') = 'array' THEN fd.entity_data->'skills'
          ELSE '[]'::jsonb
        END
      ) skill WHERE skill = ANY(p_person_skills)
    ))
    -- Contact availability filters
    AND (p_has_personal_email IS NULL OR 
      (p_has_personal_email = true AND fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') OR
      (p_has_personal_email = false AND (fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = ''))
    )
    AND (p_has_business_email IS NULL OR 
      (p_has_business_email = true AND fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '') OR
      (p_has_business_email = false AND (fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = ''))
    )
    AND (p_has_phone IS NULL OR 
      (p_has_phone = true AND fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
      (p_has_phone = false AND (fd.entity_data->>'phone' IS NULL OR fd.entity_data->>'phone' = ''))
    )
    AND (p_has_linkedin IS NULL OR 
      (p_has_linkedin = true AND fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != '') OR
      (p_has_linkedin = false AND (fd.entity_data->>'linkedinUrl' IS NULL OR fd.entity_data->>'linkedinUrl' = ''))
    )
    AND (p_has_facebook IS NULL OR 
      (p_has_facebook = true AND fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '') OR
      (p_has_facebook = false AND (fd.entity_data->>'facebookUrl' IS NULL OR fd.entity_data->>'facebookUrl' = ''))
    )
    AND (p_has_twitter IS NULL OR 
      (p_has_twitter = true AND fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '') OR
      (p_has_twitter = false AND (fd.entity_data->>'twitterUrl' IS NULL OR fd.entity_data->>'twitterUrl' = ''))
    )
    AND (p_has_company_phone IS NULL OR 
      (p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != '') OR
      (p_has_company_phone = false AND (fd.entity_data->>'companyPhone' IS NULL OR fd.entity_data->>'companyPhone' = ''))
    )
    AND (p_has_company_linkedin IS NULL OR 
      (p_has_company_linkedin = true AND fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != '') OR
      (p_has_company_linkedin = false AND (fd.entity_data->>'companyLinkedinUrl' IS NULL OR fd.entity_data->>'companyLinkedinUrl' = ''))
    )
    AND (p_has_company_facebook IS NULL OR 
      (p_has_company_facebook = true AND fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != '') OR
      (p_has_company_facebook = false AND (fd.entity_data->>'companyFacebookUrl' IS NULL OR fd.entity_data->>'companyFacebookUrl' = ''))
    )
    AND (p_has_company_twitter IS NULL OR 
      (p_has_company_twitter = true AND fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != '') OR
      (p_has_company_twitter = false AND (fd.entity_data->>'companyTwitterUrl' IS NULL OR fd.entity_data->>'companyTwitterUrl' = ''))
    )
  ORDER BY fd.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;