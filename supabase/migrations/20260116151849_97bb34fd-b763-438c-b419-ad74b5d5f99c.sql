-- Drop and recreate title_matches_seniority with seniority field support
DROP FUNCTION IF EXISTS public.title_matches_seniority(text, text[]);
DROP FUNCTION IF EXISTS public.title_matches_seniority(text, text[], text);

CREATE OR REPLACE FUNCTION public.title_matches_seniority(
  p_title TEXT,
  p_seniority TEXT[],
  p_seniority_field TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  seniority_item TEXT;
  seniority_lower TEXT;
BEGIN
  -- If no seniority filter provided, match everything
  IF p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Normalize the seniority field value
  seniority_lower := LOWER(COALESCE(p_seniority_field, ''));

  -- FIRST: Check the seniority field from entity_data (most accurate)
  FOREACH seniority_item IN ARRAY p_seniority
  LOOP
    CASE LOWER(seniority_item)
      WHEN 'founder' THEN
        IF seniority_lower = 'founder' THEN RETURN TRUE; END IF;
      WHEN 'owner' THEN
        IF seniority_lower IN ('owner', 'business owner') THEN RETURN TRUE; END IF;
      WHEN 'c-level' THEN
        IF seniority_lower IN ('c suite', 'cxo', 'c-suite') THEN RETURN TRUE; END IF;
      WHEN 'president' THEN
        IF seniority_lower = 'president' THEN RETURN TRUE; END IF;
      WHEN 'vice president' THEN
        IF seniority_lower IN ('vp', 'vice president') THEN RETURN TRUE; END IF;
      WHEN 'director' THEN
        IF seniority_lower IN ('director', 'senior director', 'dr') THEN RETURN TRUE; END IF;
      WHEN 'head of' THEN
        IF seniority_lower = 'head of' OR seniority_lower LIKE 'head%' THEN RETURN TRUE; END IF;
      WHEN 'manager' THEN
        IF seniority_lower = 'manager' THEN RETURN TRUE; END IF;
      WHEN 'individual contributor' THEN
        IF seniority_lower = 'individual contributor' OR seniority_lower = 'entry' OR seniority_lower = 'training' THEN RETURN TRUE; END IF;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  -- FALLBACK: Check title using regex patterns
  IF p_title IS NULL OR p_title = '' THEN
    RETURN FALSE;
  END IF;

  FOREACH seniority_item IN ARRAY p_seniority
  LOOP
    CASE LOWER(seniority_item)
      WHEN 'founder' THEN
        IF p_title ~* '\m(founder|co-founder|cofounder)\M' THEN RETURN TRUE; END IF;
      WHEN 'owner' THEN
        IF p_title ~* '\m(owner|business\s*owner)\M' THEN RETURN TRUE; END IF;
      WHEN 'c-level' THEN
        IF p_title ~* '\m(chief|ceo|cto|cfo|coo|cmo|cio|cpo|cro|c-level|c-suite)\M' THEN RETURN TRUE; END IF;
      WHEN 'president' THEN
        IF p_title ~* '\m(president)\M' AND p_title !~* '\mvice\s*president\M' THEN RETURN TRUE; END IF;
      WHEN 'vice president', 'vp' THEN
        IF p_title ~* '\m(vice\s*president|vp|svp|evp|avp)\M' THEN RETURN TRUE; END IF;
      WHEN 'director' THEN
        IF p_title ~* '\m(director|senior\s*director)\M' THEN RETURN TRUE; END IF;
      WHEN 'head of' THEN
        IF p_title ~* '\mhead\s*(of)?\M' THEN RETURN TRUE; END IF;
      WHEN 'manager' THEN
        IF p_title ~* '\m(manager|management)\M' THEN RETURN TRUE; END IF;
      WHEN 'individual contributor' THEN
        -- Match common IC titles
        IF p_title ~* '\m(account\s*executive|account\s*manager|customer\s*support|analyst|engineer|developer|designer|specialist|coordinator|associate|representative|consultant|advisor)\M' THEN 
          RETURN TRUE; 
        END IF;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  RETURN FALSE;
END;
$$;

-- Update search_free_data_builder to pass seniority field
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type TEXT DEFAULT 'person',
  p_industries TEXT[] DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_countries TEXT[] DEFAULT NULL,
  p_job_titles TEXT[] DEFAULT NULL,
  p_seniority_levels TEXT[] DEFAULT NULL,
  p_departments TEXT[] DEFAULT NULL,
  p_company_size_ranges TEXT[] DEFAULT NULL,
  p_company_revenue TEXT[] DEFAULT NULL,
  p_technologies TEXT[] DEFAULT NULL,
  p_keywords TEXT[] DEFAULT NULL,
  p_gender TEXT[] DEFAULT NULL,
  p_net_worth TEXT[] DEFAULT NULL,
  p_income TEXT[] DEFAULT NULL,
  p_person_interests TEXT[] DEFAULT NULL,
  p_person_skills TEXT[] DEFAULT NULL,
  p_has_email BOOLEAN DEFAULT NULL,
  p_has_phone BOOLEAN DEFAULT NULL,
  p_has_linkedin BOOLEAN DEFAULT NULL,
  p_has_facebook BOOLEAN DEFAULT NULL,
  p_has_twitter BOOLEAN DEFAULT NULL,
  p_has_personal_email BOOLEAN DEFAULT NULL,
  p_has_business_email BOOLEAN DEFAULT NULL,
  p_has_company_phone BOOLEAN DEFAULT NULL,
  p_has_company_linkedin BOOLEAN DEFAULT NULL,
  p_has_company_facebook BOOLEAN DEFAULT NULL,
  p_has_company_twitter BOOLEAN DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  entity_data JSONB,
  entity_external_id TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  total BIGINT;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Industry filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL 
         OR LOWER(fd.entity_data->>'industry') = ANY(SELECT LOWER(unnest(p_industries))))
    -- City filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL 
         OR LOWER(fd.entity_data->>'location') = ANY(SELECT LOWER(unnest(p_cities)))
         OR LOWER(fd.entity_data->>'city') = ANY(SELECT LOWER(unnest(p_cities))))
    -- Country filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL 
         OR LOWER(fd.entity_data->>'country') = ANY(SELECT LOWER(unnest(p_countries))))
    -- Job title filter (partial match)
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM unnest(p_job_titles) jt 
           WHERE LOWER(fd.entity_data->>'title') LIKE '%' || LOWER(jt) || '%'
         ))
    -- Seniority filter - now passing seniority field
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL 
         OR title_matches_seniority(fd.entity_data->>'title', p_seniority_levels, fd.entity_data->>'seniority'))
    -- Department filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL 
         OR LOWER(fd.entity_data->>'department') = ANY(SELECT LOWER(unnest(p_departments))))
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL 
         OR fd.entity_data->>'company_size' = ANY(p_company_size_ranges)
         OR fd.entity_data->>'employeeCount' = ANY(p_company_size_ranges))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL 
         OR fd.entity_data->>'revenue' = ANY(p_company_revenue))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(fd.entity_data->'technologies') = 'array' 
                  THEN fd.entity_data->'technologies' 
                  ELSE '[]'::jsonb END
           ) tech WHERE LOWER(tech) = ANY(SELECT LOWER(unnest(p_technologies)))
         ))
    -- Keywords filter (search in name, title, company, description)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM unnest(p_keywords) kw 
           WHERE LOWER(fd.entity_data->>'name') LIKE '%' || LOWER(kw) || '%'
              OR LOWER(fd.entity_data->>'title') LIKE '%' || LOWER(kw) || '%'
              OR LOWER(fd.entity_data->>'company') LIKE '%' || LOWER(kw) || '%'
              OR LOWER(fd.entity_data->>'description') LIKE '%' || LOWER(kw) || '%'
         ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL 
         OR LOWER(fd.entity_data->>'gender') = ANY(SELECT LOWER(unnest(p_gender))))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL 
         OR fd.entity_data->>'net_worth' = ANY(p_net_worth))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL 
         OR fd.entity_data->>'income' = ANY(p_income))
    -- Person interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(fd.entity_data->'interests') = 'array' 
                  THEN fd.entity_data->'interests' 
                  ELSE '[]'::jsonb END
           ) interest WHERE LOWER(interest) = ANY(SELECT LOWER(unnest(p_person_interests)))
         ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(fd.entity_data->'skills') = 'array' 
                  THEN fd.entity_data->'skills' 
                  ELSE '[]'::jsonb END
           ) skill WHERE LOWER(skill) = ANY(SELECT LOWER(unnest(p_person_skills)))
         ))
    -- Contact info filters
    AND (p_has_email IS NULL OR p_has_email = FALSE 
         OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE 
         OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE 
         OR (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE 
         OR (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE 
         OR (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' != ''))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE 
         OR (fd.entity_data->>'personal_email' IS NOT NULL AND fd.entity_data->>'personal_email' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE 
         OR (fd.entity_data->>'business_email' IS NOT NULL AND fd.entity_data->>'business_email' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE 
         OR (fd.entity_data->>'company_phone' IS NOT NULL AND fd.entity_data->>'company_phone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE 
         OR (fd.entity_data->>'company_linkedin' IS NOT NULL AND fd.entity_data->>'company_linkedin' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE 
         OR (fd.entity_data->>'company_facebook' IS NOT NULL AND fd.entity_data->>'company_facebook' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE 
         OR (fd.entity_data->>'company_twitter' IS NOT NULL AND fd.entity_data->>'company_twitter' != ''));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.entity_data,
    fd.entity_external_id,
    total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Industry filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL 
         OR LOWER(fd.entity_data->>'industry') = ANY(SELECT LOWER(unnest(p_industries))))
    -- City filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL 
         OR LOWER(fd.entity_data->>'location') = ANY(SELECT LOWER(unnest(p_cities)))
         OR LOWER(fd.entity_data->>'city') = ANY(SELECT LOWER(unnest(p_cities))))
    -- Country filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL 
         OR LOWER(fd.entity_data->>'country') = ANY(SELECT LOWER(unnest(p_countries))))
    -- Job title filter (partial match)
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM unnest(p_job_titles) jt 
           WHERE LOWER(fd.entity_data->>'title') LIKE '%' || LOWER(jt) || '%'
         ))
    -- Seniority filter - now passing seniority field
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL 
         OR title_matches_seniority(fd.entity_data->>'title', p_seniority_levels, fd.entity_data->>'seniority'))
    -- Department filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL 
         OR LOWER(fd.entity_data->>'department') = ANY(SELECT LOWER(unnest(p_departments))))
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL 
         OR fd.entity_data->>'company_size' = ANY(p_company_size_ranges)
         OR fd.entity_data->>'employeeCount' = ANY(p_company_size_ranges))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL 
         OR fd.entity_data->>'revenue' = ANY(p_company_revenue))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(fd.entity_data->'technologies') = 'array' 
                  THEN fd.entity_data->'technologies' 
                  ELSE '[]'::jsonb END
           ) tech WHERE LOWER(tech) = ANY(SELECT LOWER(unnest(p_technologies)))
         ))
    -- Keywords filter (search in name, title, company, description)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM unnest(p_keywords) kw 
           WHERE LOWER(fd.entity_data->>'name') LIKE '%' || LOWER(kw) || '%'
              OR LOWER(fd.entity_data->>'title') LIKE '%' || LOWER(kw) || '%'
              OR LOWER(fd.entity_data->>'company') LIKE '%' || LOWER(kw) || '%'
              OR LOWER(fd.entity_data->>'description') LIKE '%' || LOWER(kw) || '%'
         ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL 
         OR LOWER(fd.entity_data->>'gender') = ANY(SELECT LOWER(unnest(p_gender))))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL 
         OR fd.entity_data->>'net_worth' = ANY(p_net_worth))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL 
         OR fd.entity_data->>'income' = ANY(p_income))
    -- Person interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(fd.entity_data->'interests') = 'array' 
                  THEN fd.entity_data->'interests' 
                  ELSE '[]'::jsonb END
           ) interest WHERE LOWER(interest) = ANY(SELECT LOWER(unnest(p_person_interests)))
         ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL 
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(fd.entity_data->'skills') = 'array' 
                  THEN fd.entity_data->'skills' 
                  ELSE '[]'::jsonb END
           ) skill WHERE LOWER(skill) = ANY(SELECT LOWER(unnest(p_person_skills)))
         ))
    -- Contact info filters
    AND (p_has_email IS NULL OR p_has_email = FALSE 
         OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE 
         OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE 
         OR (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE 
         OR (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE 
         OR (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' != ''))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE 
         OR (fd.entity_data->>'personal_email' IS NOT NULL AND fd.entity_data->>'personal_email' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE 
         OR (fd.entity_data->>'business_email' IS NOT NULL AND fd.entity_data->>'business_email' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE 
         OR (fd.entity_data->>'company_phone' IS NOT NULL AND fd.entity_data->>'company_phone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE 
         OR (fd.entity_data->>'company_linkedin' IS NOT NULL AND fd.entity_data->>'company_linkedin' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE 
         OR (fd.entity_data->>'company_facebook' IS NOT NULL AND fd.entity_data->>'company_facebook' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE 
         OR (fd.entity_data->>'company_twitter' IS NOT NULL AND fd.entity_data->>'company_twitter' != ''))
  ORDER BY fd.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;