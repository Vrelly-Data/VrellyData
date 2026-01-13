-- Phase 2: Fix keyword search + seniority + department matching
-- This REPLACES the canonical function with tolerant matching

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT NULL,
  p_keywords text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_company_size_ranges text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
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
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(entity_external_id text, entity_data jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_seniority_normalized text[];
  v_departments_normalized text[];
BEGIN
  -- Normalize seniority input: map common UI values to stored values
  -- UI sends "C-Level", data has "C suite"
  IF p_seniority_levels IS NOT NULL THEN
    SELECT array_agg(
      CASE lower(trim(s))
        WHEN 'c-level' THEN 'c suite'
        WHEN 'vp' THEN 'vp'
        WHEN 'director' THEN 'director'
        WHEN 'manager' THEN 'manager'
        WHEN 'senior' THEN 'senior'
        WHEN 'entry' THEN 'entry'
        WHEN 'intern' THEN 'intern'
        ELSE lower(trim(s))
      END
    ) INTO v_seniority_normalized
    FROM unnest(p_seniority_levels) s;
  END IF;

  -- Normalize department input: map common UI values to stored values
  -- UI sends "Executive", data has "C-Suite"
  IF p_departments IS NOT NULL THEN
    SELECT array_agg(
      CASE lower(trim(d))
        WHEN 'executive' THEN 'c-suite'
        WHEN 'c-level' THEN 'c-suite'
        ELSE lower(trim(d))
      END
    ) INTO v_departments_normalized
    FROM unnest(p_departments) d;
  END IF;

  -- Get total count with filters applied
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE
    -- Entity type filter
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- KEYWORDS: Search across ALL relevant text fields (null-safe)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        -- Person name fields
        coalesce(fd.entity_data->>'name', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'firstName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'lastName', '') ILIKE '%' || kw || '%'
        -- Job/title fields
        OR coalesce(fd.entity_data->>'title', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || kw || '%'
        -- Company fields (both naming conventions)
        OR coalesce(fd.entity_data->>'company', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'companyName', '') ILIKE '%' || kw || '%'
        -- Industry
        OR coalesce(fd.entity_data->>'industry', '') ILIKE '%' || kw || '%'
        -- Description fields
        OR coalesce(fd.entity_data->>'companyDescription', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'description', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'bio', '') ILIKE '%' || kw || '%'
        -- Keywords array (if present)
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN fd.entity_data->'keywords' IS NOT NULL 
                  AND jsonb_typeof(fd.entity_data->'keywords') = 'array' 
                 THEN fd.entity_data->'keywords' 
                 ELSE '[]'::jsonb 
            END
          ) arr_kw
          WHERE arr_kw ILIKE '%' || kw || '%'
        )
    ))
    
    -- Job titles (ILIKE for flexibility)
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE coalesce(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
         OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
    ))
    
    -- SENIORITY: Case-insensitive with normalization
    AND (p_seniority_levels IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'seniority', ''))) = ANY(v_seniority_normalized))
    
    -- Company size ranges
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'companySize' = ANY(p_company_size_ranges))
    
    -- Industries (case-insensitive)
    AND (p_industries IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'industry', ''))) = ANY(
           SELECT lower(trim(i)) FROM unnest(p_industries) i
         ))
    
    -- Countries
    AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries) 
         OR fd.entity_data->>'companyCountry' = ANY(p_countries))
    
    -- Cities
    AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities) 
         OR fd.entity_data->>'companyCity' = ANY(p_cities))
    
    -- Gender
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    
    -- Net worth
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    
    -- Income
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    
    -- DEPARTMENTS: Case-insensitive with normalization
    AND (p_departments IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'department', ''))) = ANY(v_departments_normalized))
    
    -- Company revenue
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    
    -- Person interests
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN fd.entity_data->'interests' IS NOT NULL 
              AND jsonb_typeof(fd.entity_data->'interests') = 'array'
             THEN fd.entity_data->'interests' 
             ELSE '[]'::jsonb 
        END
      ) interest
      WHERE interest = ANY(p_person_interests)
    ))
    
    -- Person skills
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN fd.entity_data->'skills' IS NOT NULL 
              AND jsonb_typeof(fd.entity_data->'skills') = 'array'
             THEN fd.entity_data->'skills' 
             ELSE '[]'::jsonb 
        END
      ) skill
      WHERE skill = ANY(p_person_skills)
    ))
    
    -- PROSPECT DATA FILTERS
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      coalesce(fd.entity_data->>'personalEmail', '') <> ''
      OR (fd.entity_data->'personalEmails' IS NOT NULL 
          AND jsonb_typeof(fd.entity_data->'personalEmails') = 'array'
          AND jsonb_array_length(fd.entity_data->'personalEmails') > 0)
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      coalesce(fd.entity_data->>'businessEmail', '') <> ''
      OR (fd.entity_data->'businessEmails' IS NOT NULL 
          AND jsonb_typeof(fd.entity_data->'businessEmails') = 'array'
          AND jsonb_array_length(fd.entity_data->'businessEmails') > 0)
      OR coalesce(fd.entity_data->>'email', '') <> ''
    ))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      coalesce(fd.entity_data->>'phone', '') <> ''
      OR coalesce(fd.entity_data->>'mobilePhone', '') <> ''
      OR (fd.entity_data->'phones' IS NOT NULL 
          AND jsonb_typeof(fd.entity_data->'phones') = 'array'
          AND jsonb_array_length(fd.entity_data->'phones') > 0)
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         coalesce(fd.entity_data->>'linkedinUrl', '') <> '')
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         coalesce(fd.entity_data->>'facebookUrl', '') <> '')
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         coalesce(fd.entity_data->>'twitterUrl', '') <> '')
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         coalesce(fd.entity_data->>'companyPhone', '') <> '')
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         coalesce(fd.entity_data->>'companyLinkedinUrl', '') <> '')
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         coalesce(fd.entity_data->>'companyFacebookUrl', '') <> '')
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         coalesce(fd.entity_data->>'companyTwitterUrl', '') <> '');

  -- Return paginated results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id::text,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- KEYWORDS (same logic as count)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        coalesce(fd.entity_data->>'name', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'firstName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'lastName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'title', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'company', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'companyName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'industry', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'companyDescription', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'description', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'bio', '') ILIKE '%' || kw || '%'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN fd.entity_data->'keywords' IS NOT NULL 
                  AND jsonb_typeof(fd.entity_data->'keywords') = 'array' 
                 THEN fd.entity_data->'keywords' 
                 ELSE '[]'::jsonb 
            END
          ) arr_kw
          WHERE arr_kw ILIKE '%' || kw || '%'
        )
    ))
    
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE coalesce(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
         OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
    ))
    
    AND (p_seniority_levels IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'seniority', ''))) = ANY(v_seniority_normalized))
    
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'companySize' = ANY(p_company_size_ranges))
    
    AND (p_industries IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'industry', ''))) = ANY(
           SELECT lower(trim(i)) FROM unnest(p_industries) i
         ))
    
    AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries) 
         OR fd.entity_data->>'companyCountry' = ANY(p_countries))
    
    AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities) 
         OR fd.entity_data->>'companyCity' = ANY(p_cities))
    
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    
    AND (p_departments IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'department', ''))) = ANY(v_departments_normalized))
    
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN fd.entity_data->'interests' IS NOT NULL 
              AND jsonb_typeof(fd.entity_data->'interests') = 'array'
             THEN fd.entity_data->'interests' 
             ELSE '[]'::jsonb 
        END
      ) interest
      WHERE interest = ANY(p_person_interests)
    ))
    
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN fd.entity_data->'skills' IS NOT NULL 
              AND jsonb_typeof(fd.entity_data->'skills') = 'array'
             THEN fd.entity_data->'skills' 
             ELSE '[]'::jsonb 
        END
      ) skill
      WHERE skill = ANY(p_person_skills)
    ))
    
    -- Prospect data filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      coalesce(fd.entity_data->>'personalEmail', '') <> ''
      OR (fd.entity_data->'personalEmails' IS NOT NULL 
          AND jsonb_typeof(fd.entity_data->'personalEmails') = 'array'
          AND jsonb_array_length(fd.entity_data->'personalEmails') > 0)
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      coalesce(fd.entity_data->>'businessEmail', '') <> ''
      OR (fd.entity_data->'businessEmails' IS NOT NULL 
          AND jsonb_typeof(fd.entity_data->'businessEmails') = 'array'
          AND jsonb_array_length(fd.entity_data->'businessEmails') > 0)
      OR coalesce(fd.entity_data->>'email', '') <> ''
    ))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      coalesce(fd.entity_data->>'phone', '') <> ''
      OR coalesce(fd.entity_data->>'mobilePhone', '') <> ''
      OR (fd.entity_data->'phones' IS NOT NULL 
          AND jsonb_typeof(fd.entity_data->'phones') = 'array'
          AND jsonb_array_length(fd.entity_data->'phones') > 0)
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         coalesce(fd.entity_data->>'linkedinUrl', '') <> '')
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         coalesce(fd.entity_data->>'facebookUrl', '') <> '')
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         coalesce(fd.entity_data->>'twitterUrl', '') <> '')
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         coalesce(fd.entity_data->>'companyPhone', '') <> '')
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         coalesce(fd.entity_data->>'companyLinkedinUrl', '') <> '')
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         coalesce(fd.entity_data->>'companyFacebookUrl', '') <> '')
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         coalesce(fd.entity_data->>'companyTwitterUrl', '') <> '')
  ORDER BY fd.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Verify only 1 function exists
DO $$
DECLARE
  overload_count integer;
BEGIN
  SELECT COUNT(DISTINCT p.oid) INTO overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_builder';
  
  IF overload_count <> 1 THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: Expected 1 function, found %', overload_count;
  END IF;
  RAISE NOTICE 'INVARIANT CHECK PASSED: Exactly 1 search_free_data_builder function exists.';
END $$;