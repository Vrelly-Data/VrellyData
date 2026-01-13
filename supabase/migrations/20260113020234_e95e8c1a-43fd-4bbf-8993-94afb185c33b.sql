-- Drop existing function(s) completely
DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(entity_type, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer);

-- Create function with parameters matching the frontend
CREATE OR REPLACE FUNCTION public.search_free_data_with_filters_v2(
  p_entity_type text,
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
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  entity_external_id text,
  entity_data jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH filtered_data AS (
    SELECT 
      fd.entity_external_id,
      fd.entity_data
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type::entity_type
      -- Keywords search (search in name, title, company, description)
      AND (p_keywords IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'firstName', '') || ' ' || COALESCE(fd.entity_data->>'lastName', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'companyName', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'jobTitle', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'description', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'name', '') ILIKE '%' || kw || '%'
        ) FROM unnest(p_keywords) kw
      ))
      -- Industries filter
      AND (p_industries IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
        ) FROM unnest(p_industries) ind
      ))
      -- Cities filter (legacy, searches both person and company cities)
      AND (p_cities IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'city', '') ILIKE '%' || c || '%'
          OR COALESCE(fd.entity_data->>'companyCity', '') ILIKE '%' || c || '%'
        ) FROM unnest(p_cities) c
      ))
      -- Gender filter
      AND (p_gender IS NULL OR UPPER(fd.entity_data->>'gender') = UPPER(p_gender))
      -- Job titles filter
      AND (p_job_titles IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
        ) FROM unnest(p_job_titles) jt
      ))
      -- Seniority filter
      AND (p_seniority IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'seniority', '') ILIKE '%' || s || '%'
        ) FROM unnest(p_seniority) s
      ))
      -- Department filter
      AND (p_department IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'department', '') ILIKE '%' || d || '%'
        ) FROM unnest(p_department) d
      ))
      -- Company size filter with range matching
      AND (p_company_size IS NULL OR (
        SELECT bool_or(
          CASE cs
            WHEN '1-10' THEN (
              CASE 
                WHEN fd.entity_data->>'companySize' ~ '^\d+$' 
                THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
                ELSE false
              END
            )
            WHEN '11-50' THEN (
              CASE 
                WHEN fd.entity_data->>'companySize' ~ '^\d+$' 
                THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
                ELSE false
              END
            )
            WHEN '51-200' THEN (
              CASE 
                WHEN fd.entity_data->>'companySize' ~ '^\d+$' 
                THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
                ELSE false
              END
            )
            WHEN '201-500' THEN (
              CASE 
                WHEN fd.entity_data->>'companySize' ~ '^\d+$' 
                THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
                ELSE false
              END
            )
            WHEN '501-1000' THEN (
              CASE 
                WHEN fd.entity_data->>'companySize' ~ '^\d+$' 
                THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
                ELSE false
              END
            )
            WHEN '1001-5000' THEN (
              CASE 
                WHEN fd.entity_data->>'companySize' ~ '^\d+$' 
                THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
                ELSE false
              END
            )
            WHEN '5001-10000' THEN (
              CASE 
                WHEN fd.entity_data->>'companySize' ~ '^\d+$' 
                THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
                ELSE false
              END
            )
            WHEN '10000+' THEN (
              CASE 
                WHEN fd.entity_data->>'companySize' ~ '^\d+$' 
                THEN (fd.entity_data->>'companySize')::int >= 10001
                ELSE false
              END
            )
            ELSE COALESCE(fd.entity_data->>'companySize', '') ILIKE '%' || cs || '%'
          END
        ) FROM unnest(p_company_size) cs
      ))
      -- Net worth filter
      AND (p_net_worth IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'netWorth', '') ILIKE '%' || nw || '%'
        ) FROM unnest(p_net_worth) nw
      ))
      -- Income filter
      AND (p_income IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'income', '') ILIKE '%' || inc || '%'
        ) FROM unnest(p_income) inc
      ))
      -- Person city filter
      AND (p_person_city IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'city', '') ILIKE '%' || pc || '%'
        ) FROM unnest(p_person_city) pc
      ))
      -- Person country filter
      AND (p_person_country IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'country', '') ILIKE '%' || pco || '%'
        ) FROM unnest(p_person_country) pco
      ))
      -- Company city filter
      AND (p_company_city IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'companyCity', '') ILIKE '%' || cc || '%'
        ) FROM unnest(p_company_city) cc
      ))
      -- Company country filter
      AND (p_company_country IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'companyCountry', '') ILIKE '%' || cco || '%'
        ) FROM unnest(p_company_country) cco
      ))
      -- Person interests filter
      AND (p_person_interests IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'interests', '') ILIKE '%' || pi || '%'
        ) FROM unnest(p_person_interests) pi
      ))
      -- Person skills filter
      AND (p_person_skills IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'skills', '') ILIKE '%' || ps || '%'
        ) FROM unnest(p_person_skills) ps
      ))
      -- Company revenue filter
      AND (p_company_revenue IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'revenue', '') ILIKE '%' || cr || '%'
        ) FROM unnest(p_company_revenue) cr
      ))
      -- Prospect data availability filters
      AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
      AND (p_has_business_email IS NULL OR p_has_business_email = false OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
      AND (p_has_phone IS NULL OR p_has_phone = false OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
      AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
      AND (p_has_facebook IS NULL OR p_has_facebook = false OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
      AND (p_has_twitter IS NULL OR p_has_twitter = false OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
      AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
      AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
      AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
      AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
  ),
  counted AS (
    SELECT COUNT(*) as cnt FROM filtered_data
  )
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    c.cnt as total_count
  FROM filtered_data fd
  CROSS JOIN counted c
  ORDER BY fd.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;