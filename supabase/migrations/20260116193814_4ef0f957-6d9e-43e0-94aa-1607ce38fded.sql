-- RESTORE v2.0 stable filter logic with FIXED p_entity_type enum
-- Problem: p_entity_type is text, causes implicit cast issues
-- Solution: Change to public.entity_type enum with default

-- Drop all overloads first
DO $$
DECLARE
  func_rec RECORD;
BEGIN
  FOR func_rec IN (
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'search_free_data_builder'
  ) LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_rec.signature || ' CASCADE';
  END LOOP;
END $$;

-- Recreate with CORRECT p_entity_type enum type (not text!)
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type public.entity_type DEFAULT 'person'::public.entity_type,
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
  p_technologies text[] DEFAULT NULL,
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
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_seniority_normalized text[];
  v_departments_normalized text[];
BEGIN
  -- Normalize seniority input: map common UI values to stored values
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

  -- Normalize department input
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
    -- Entity type filter (enum to enum - no cast needed!)
    fd.entity_type = p_entity_type
    
    -- KEYWORDS: Search across ALL relevant text fields
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
    
    -- Job titles
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE coalesce(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
         OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
    ))
    
    -- SENIORITY with normalization
    AND (p_seniority_levels IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'seniority', ''))) = ANY(v_seniority_normalized))
    
    -- COMPANY SIZE: Parse numeric and match ranges
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) r
      WHERE CASE r
        WHEN '1-10' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 1 AND 10
        WHEN '11-50' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 11 AND 50
        WHEN '51-200' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 51 AND 200
        WHEN '201-500' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 201 AND 500
        WHEN '501-1000' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 501 AND 1000
        WHEN '1001-5000' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 1001 AND 5000
        WHEN '5001-10000' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 5001 AND 10000
        WHEN '10001+' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int > 10000
        ELSE FALSE
      END
    ))
    
    -- Industries
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE coalesce(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
    ))
    
    -- Location filters
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) c
      WHERE coalesce(fd.entity_data->>'country', '') ILIKE '%' || c || '%'
         OR coalesce(fd.entity_data->>'companyCountry', '') ILIKE '%' || c || '%'
    ))
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) c
      WHERE coalesce(fd.entity_data->>'city', '') ILIKE '%' || c || '%'
         OR coalesce(fd.entity_data->>'companyCity', '') ILIKE '%' || c || '%'
    ))
    
    -- Gender
    AND (p_gender IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'gender', ''))) = ANY(
           SELECT lower(trim(g)) FROM unnest(p_gender) g
         ))
    
    -- Departments
    AND (p_departments IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'department', ''))) = ANY(v_departments_normalized))
    
    -- Company revenue ranges
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) r
      WHERE CASE r
        WHEN 'Under $1M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint < 1000000
        WHEN '$1M - $10M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 1000000 AND 10000000
        WHEN '$10M - $50M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 10000000 AND 50000000
        WHEN '$50M - $100M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 50000000 AND 100000000
        WHEN '$100M - $500M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 100000000 AND 500000000
        WHEN '$500M - $1B' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 500000000 AND 1000000000
        WHEN '$1B+' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint >= 1000000000
        ELSE FALSE
      END
    ))
    
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
    
    -- Technologies
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN fd.entity_data->'technologies' IS NOT NULL 
              AND jsonb_typeof(fd.entity_data->'technologies') = 'array'
             THEN fd.entity_data->'technologies' 
             ELSE '[]'::jsonb 
        END
      ) tech
      WHERE tech ILIKE ANY(
        SELECT '%' || t || '%' FROM unnest(p_technologies) t
      )
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
         coalesce(fd.entity_data->>'linkedin', '') <> '' OR
         coalesce(fd.entity_data->>'linkedinUrl', '') <> '')
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         coalesce(fd.entity_data->>'facebookUrl', '') <> '')
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         coalesce(fd.entity_data->>'twitterUrl', '') <> '')
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         coalesce(fd.entity_data->>'companyPhone', '') <> '')
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         coalesce(fd.entity_data->>'companyLinkedin', '') <> '' OR
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
    fd.entity_type = p_entity_type
    
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
    
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) r
      WHERE CASE r
        WHEN '1-10' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 1 AND 10
        WHEN '11-50' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 11 AND 50
        WHEN '51-200' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 51 AND 200
        WHEN '201-500' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 201 AND 500
        WHEN '501-1000' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 501 AND 1000
        WHEN '1001-5000' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 1001 AND 5000
        WHEN '5001-10000' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int BETWEEN 5001 AND 10000
        WHEN '10001+' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', ''), '[^0-9]', '', 'g'), '')::int > 10000
        ELSE FALSE
      END
    ))
    
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE coalesce(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
    ))
    
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) c
      WHERE coalesce(fd.entity_data->>'country', '') ILIKE '%' || c || '%'
         OR coalesce(fd.entity_data->>'companyCountry', '') ILIKE '%' || c || '%'
    ))
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) c
      WHERE coalesce(fd.entity_data->>'city', '') ILIKE '%' || c || '%'
         OR coalesce(fd.entity_data->>'companyCity', '') ILIKE '%' || c || '%'
    ))
    
    AND (p_gender IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'gender', ''))) = ANY(
           SELECT lower(trim(g)) FROM unnest(p_gender) g
         ))
    
    AND (p_departments IS NULL OR 
         lower(trim(coalesce(fd.entity_data->>'department', ''))) = ANY(v_departments_normalized))
    
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) r
      WHERE CASE r
        WHEN 'Under $1M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint < 1000000
        WHEN '$1M - $10M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 1000000 AND 10000000
        WHEN '$10M - $50M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 10000000 AND 50000000
        WHEN '$50M - $100M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 50000000 AND 100000000
        WHEN '$100M - $500M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 100000000 AND 500000000
        WHEN '$500M - $1B' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint BETWEEN 500000000 AND 1000000000
        WHEN '$1B+' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', ''), '[^0-9]', '', 'g'), '')::bigint >= 1000000000
        ELSE FALSE
      END
    ))
    
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
    
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN fd.entity_data->'technologies' IS NOT NULL 
              AND jsonb_typeof(fd.entity_data->'technologies') = 'array'
             THEN fd.entity_data->'technologies' 
             ELSE '[]'::jsonb 
        END
      ) tech
      WHERE tech ILIKE ANY(
        SELECT '%' || t || '%' FROM unnest(p_technologies) t
      )
    ))
    
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
         coalesce(fd.entity_data->>'linkedin', '') <> '' OR
         coalesce(fd.entity_data->>'linkedinUrl', '') <> '')
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         coalesce(fd.entity_data->>'facebookUrl', '') <> '')
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         coalesce(fd.entity_data->>'twitterUrl', '') <> '')
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         coalesce(fd.entity_data->>'companyPhone', '') <> '')
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         coalesce(fd.entity_data->>'companyLinkedin', '') <> '' OR
         coalesce(fd.entity_data->>'companyLinkedinUrl', '') <> '')
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         coalesce(fd.entity_data->>'companyFacebookUrl', '') <> '')
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         coalesce(fd.entity_data->>'companyTwitterUrl', '') <> '')
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;