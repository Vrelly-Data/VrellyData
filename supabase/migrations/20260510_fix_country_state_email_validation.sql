-- =============================================================================
-- Migration: Country filter — 3-layer dirty-data validation
-- Date:      2026-05-10
-- Function:  search_prospects_results
-- =============================================================================
--
-- BACKGROUND
-- ----------
-- AudienceLab (the source of the prospects table, ~1.9M rows) stamps a large
-- fraction of non-US contacts with country='US'. Before this fix, the
-- "filter by country=United States" feature in the Audience Builder returned
-- ~30% non-US contacts (Mumbai/MH, London/ENG, Toronto/ON, Cape Town with
-- null state, Madrid-based people with .es emails, etc.) — all because the
-- raw country='US' value in AudienceLab data is unreliable.
--
-- Diagnostic counts at time of fix (May 10, 2026):
--   Total country='US' rows in DB:               1,836,414
--     - With valid US state code:                1,037,489
--     - With null state but null city:             312,306
--     - With null state but foreign city:          127,743  (the v2 leaker)
--     - With null state, null city, foreign TLD:    85,267  (the v3 leaker)
--     - With non-US state code (MH, ENG, etc.):    358,876  (the overt liars)
--
-- THIS MIGRATION REPLACES the country block in search_prospects_results with
-- a 3-layer guard. Every other filter in the function is byte-for-byte
-- identical to the prior live function body.
--
-- LAYER 1 — STATE VALIDATION
--   Row passes if state is a valid US state or territory code
--   (50 states + DC + 5 territories)
--   Kills: rows where state is "MH" (Maharashtra), "ENG" (England),
--          "ON" (Ontario), "VLG" (Vlaanderen), etc.
--
-- LAYER 2 — NULL-INFO FALLBACK
--   Row passes if state IS NULL/empty AND city IS NULL/empty
--   Rationale: AudienceLab has ~74% state coverage. Rows with no state AND
--   no city have zero contradicting info — give them benefit of doubt.
--
-- LAYER 3 — TLD TIEBREAKER (applies only to the Layer 2 fallback)
--   For the "no info" bucket, additionally require that neither
--   business_email nor personal_email ends in a known foreign country TLD.
--   Kills: rows like Elena Mateo (no state, no city, email = elena@urjc.es)
--
-- Net result: ~1,278,944 rows pass for a country='US' filter
-- (down from 1,836,414 — a 30% reduction of demonstrably-or-likely-non-US rows)
--
-- KNOWN REMAINING LEAKS (NOT FIXED BY THIS MIGRATION)
-- ---------------------------------------------------
-- ~12% of exported rows still appear non-US by signals this function doesn't
-- check, including:
--   - company_city is set to a foreign city while person city/state is null
--   - foreign-TLD website while email TLD is .com
--   - state/city collisions where state happens to match a US state code but
--     the city reveals a foreign administrative region (e.g. TN+Chennai is
--     Tamil Nadu, not Tennessee)
--   - foreign-company legal suffixes (GmbH, Pty Ltd, S.A., etc.)
--   - vanity/non-country TLDs (.io, .me, .energy, .gr, .pt, .eu, etc.)
-- Future work: either tighten this function further (v4+) or fix the data at
-- ingest by re-deriving country from city+state+zip+email+phone signals.
--
-- DEPENDENCIES
-- ------------
-- This function relies on public.normalize_country(text) — a helper that
-- maps "United States", "USA", "U.S.", etc. → "US". The helper must exist
-- BEFORE this migration runs. Create it manually in Studio if it doesn't,
-- using the same CASE statement that's been in place since March 2026.
--
-- KILL SWITCH
-- -----------
-- If this migration causes a regression, the prior function body (with the
-- old country block: `p.country = normalize_country(x) OR p.country ILIKE
-- '%x%'`) can be re-applied. The pre-fix body was captured in the chat session
-- dated 2026-05-10 and saved by the deploying engineer at that time.
--
-- DESIGN NOTES — DO NOT BREAK THESE
-- ---------------------------------
-- 1. The parameter signature (name, type, order) is identical to the prior
--    function. Same-name + different-params = a new overload, not a
--    replacement. Per VRELLY-INFRA.md §12 ("NEVER change parameter signatures"),
--    this is critical.
-- 2. SECURITY DEFINER, statement_timeout=15s, plan_cache_mode=force_custom_plan,
--    work_mem=256MB are preserved from the prior body.
-- 3. The non-US country branch (else clause inside the country block) is
--    byte-for-byte identical to the prior live function. Only the US branch
--    adds new logic.
-- 4. Future patches that read the live function body via pg_get_functiondef
--    and apply string-replace transforms MUST preserve the country block —
--    or run this migration again after the patch to restore it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_prospects_results(
  p_keywords text[] DEFAULT NULL::text[],
  p_job_titles text[] DEFAULT NULL::text[],
  p_seniority_levels text[] DEFAULT NULL::text[],
  p_company_size_ranges text[] DEFAULT NULL::text[],
  p_industries text[] DEFAULT NULL::text[],
  p_countries text[] DEFAULT NULL::text[],
  p_cities text[] DEFAULT NULL::text[],
  p_gender text[] DEFAULT NULL::text[],
  p_net_worth text[] DEFAULT NULL::text[],
  p_income text[] DEFAULT NULL::text[],
  p_departments text[] DEFAULT NULL::text[],
  p_company_revenue text[] DEFAULT NULL::text[],
  p_person_interests text[] DEFAULT NULL::text[],
  p_person_skills text[] DEFAULT NULL::text[],
  p_technologies text[] DEFAULT NULL::text[],
  p_has_personal_email boolean DEFAULT NULL::boolean,
  p_has_business_email boolean DEFAULT NULL::boolean,
  p_has_phone boolean DEFAULT NULL::boolean,
  p_has_linkedin boolean DEFAULT NULL::boolean,
  p_has_facebook boolean DEFAULT NULL::boolean,
  p_has_twitter boolean DEFAULT NULL::boolean,
  p_has_company_phone boolean DEFAULT NULL::boolean,
  p_has_company_linkedin boolean DEFAULT NULL::boolean,
  p_has_company_facebook boolean DEFAULT NULL::boolean,
  p_has_company_twitter boolean DEFAULT NULL::boolean,
  p_exclude_keywords text[] DEFAULT NULL::text[],
  p_exclude_job_titles text[] DEFAULT NULL::text[],
  p_exclude_industries text[] DEFAULT NULL::text[],
  p_exclude_cities text[] DEFAULT NULL::text[],
  p_exclude_countries text[] DEFAULT NULL::text[],
  p_exclude_technologies text[] DEFAULT NULL::text[],
  p_exclude_person_skills text[] DEFAULT NULL::text[],
  p_exclude_person_interests text[] DEFAULT NULL::text[],
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_zip_code text DEFAULT NULL::text,
  p_children text[] DEFAULT NULL::text[],
  p_homeowner boolean DEFAULT NULL::boolean,
  p_married boolean DEFAULT NULL::boolean,
  p_education text[] DEFAULT NULL::text[],
  p_age_min integer DEFAULT NULL::integer,
  p_age_max integer DEFAULT NULL::integer,
  p_company_names text[] DEFAULT NULL::text[],
  p_added_on_days_ago integer DEFAULT NULL::integer
)
RETURNS SETOF prospects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '15s'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_sql text;
  v_where text := 'WHERE 1=1';
BEGIN
  EXECUTE 'SET LOCAL work_mem = ''256MB''';

  IF p_job_titles IS NOT NULL AND array_length(p_job_titles, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_job_titles, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.job_title ILIKE ' || quote_literal('%' || p_job_titles[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_seniority_levels IS NOT NULL AND array_length(p_seniority_levels, 1) > 0 THEN v_where := v_where || ' AND lower(p.seniority) = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(lower(x)) FROM unnest(p_seniority_levels) x), ',') || '])'; END IF;
  IF p_industries IS NOT NULL AND array_length(p_industries, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_industries, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.company_industry ILIKE ' || quote_literal('%' || p_industries[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_cities IS NOT NULL AND array_length(p_cities, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_cities, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || '(p.city ILIKE ' || quote_literal('%' || p_cities[i] || '%') || ' OR p.company_city ILIKE ' || quote_literal('%' || p_cities[i] || '%') || ')'; END LOOP; v_where := v_where || ')'; END IF;

  -- ===========================================================================
  -- COUNTRY BLOCK — v3 (May 10, 2026)
  -- Layer 1: valid US state code
  -- Layer 2: null state AND null city
  -- Layer 3: TLD tiebreaker for Layer 2 rows
  -- ===========================================================================
  IF p_countries IS NOT NULL AND array_length(p_countries, 1) > 0 THEN
    v_where := v_where || ' AND (';
    FOR i IN 1..array_length(p_countries, 1) LOOP
      IF i > 1 THEN v_where := v_where || ' OR '; END IF;
      IF public.normalize_country(p_countries[i]) = 'US' THEN
        v_where := v_where ||
          '(p.country = ''US'' AND (' ||
            'p.state = ANY(ARRAY[' ||
              '''AL'',''AK'',''AZ'',''AR'',''CA'',''CO'',''CT'',''DE'',''FL'',''GA'',' ||
              '''HI'',''ID'',''IL'',''IN'',''IA'',''KS'',''KY'',''LA'',''ME'',''MD'',' ||
              '''MA'',''MI'',''MN'',''MS'',''MO'',''MT'',''NE'',''NV'',''NH'',''NJ'',' ||
              '''NM'',''NY'',''NC'',''ND'',''OH'',''OK'',''OR'',''PA'',''RI'',''SC'',' ||
              '''SD'',''TN'',''TX'',''UT'',''VT'',''VA'',''WA'',''WV'',''WI'',''WY'',' ||
              '''DC'',''PR'',''VI'',''GU'',''AS'',''MP''])' ||
            ' OR (' ||
              '(p.state IS NULL OR p.state = '''')' ||
              ' AND (p.city IS NULL OR p.city = '''')' ||
              ' AND (p.business_email IS NULL OR p.business_email !~* ''\.(uk|in|au|de|fr|it|es|nl|br|mx|za|nz|ie|se|no|dk|ch|at|be|pl|ru|cn|jp|kr|sg|hk|ph|id|ar|cl|pe|il|ae|sa)$'')' ||
              ' AND (p.personal_email IS NULL OR p.personal_email !~* ''\.(uk|in|au|de|fr|it|es|nl|br|mx|za|nz|ie|se|no|dk|ch|at|be|pl|ru|cn|jp|kr|sg|hk|ph|id|ar|cl|pe|il|ae|sa)$'')' ||
            ')' ||
          '))';
      ELSE
        v_where := v_where ||
          '(p.country = ' || quote_literal(public.normalize_country(p_countries[i])) ||
          ' OR p.country ILIKE ' || quote_literal('%' || p_countries[i] || '%') || ')';
      END IF;
    END LOOP;
    v_where := v_where || ')';
  END IF;
  -- ===========================================================================
  -- END COUNTRY BLOCK
  -- ===========================================================================

  IF p_gender IS NOT NULL AND array_length(p_gender, 1) > 0 THEN v_where := v_where || ' AND LOWER(p.gender) = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(LOWER(x)) FROM unnest(p_gender) x), ',') || '])'; END IF;
  IF p_departments IS NOT NULL AND array_length(p_departments, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_departments, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.department ILIKE ' || quote_literal('%' || p_departments[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_keywords IS NOT NULL AND array_length(p_keywords, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_keywords, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'to_tsvector(''english'', coalesce(p.job_title,'''') || '' '' || coalesce(p.company_name,'''') || '' '' || coalesce(p.company_industry,'''') || '' '' || coalesce(p.company_description,'''')) @@ plainto_tsquery(''english'', ' || quote_literal(p_keywords[i]) || ')'; END LOOP; v_where := v_where || ')'; END IF;
  IF p_person_skills IS NOT NULL AND array_length(p_person_skills, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_person_skills, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.skills ILIKE ' || quote_literal('%' || p_person_skills[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_person_interests IS NOT NULL AND array_length(p_person_interests, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_person_interests, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.interests ILIKE ' || quote_literal('%' || p_person_interests[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_technologies IS NOT NULL AND array_length(p_technologies, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_technologies, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.technologies ILIKE ' || quote_literal('%' || p_technologies[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_net_worth IS NOT NULL AND array_length(p_net_worth, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_net_worth, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.net_worth ILIKE ' || quote_literal('%' || p_net_worth[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_income IS NOT NULL AND array_length(p_income, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_income, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.income_range ILIKE ' || quote_literal('%' || p_income[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_company_names IS NOT NULL AND array_length(p_company_names, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_company_names, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.company_name ILIKE ' || quote_literal('%' || p_company_names[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_education IS NOT NULL AND array_length(p_education, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_education, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.education_history ILIKE ' || quote_literal('%' || p_education[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_has_personal_email IS NOT NULL AND p_has_personal_email THEN v_where := v_where || ' AND p.personal_email IS NOT NULL AND p.personal_email != '''''; END IF;
  IF p_has_business_email IS NOT NULL AND p_has_business_email THEN v_where := v_where || ' AND p.business_email IS NOT NULL AND p.business_email != '''''; END IF;
  IF p_has_phone IS NOT NULL AND p_has_phone THEN v_where := v_where || ' AND p.phone IS NOT NULL AND p.phone != '''''; END IF;
  IF p_has_linkedin IS NOT NULL AND p_has_linkedin THEN v_where := v_where || ' AND p.linkedin_url IS NOT NULL AND p.linkedin_url != '''''; END IF;
  IF p_has_facebook IS NOT NULL AND p_has_facebook THEN v_where := v_where || ' AND p.facebook_url IS NOT NULL AND p.facebook_url != '''''; END IF;
  IF p_has_twitter IS NOT NULL AND p_has_twitter THEN v_where := v_where || ' AND p.twitter_url IS NOT NULL AND p.twitter_url != '''''; END IF;
  IF p_has_company_phone IS NOT NULL AND p_has_company_phone THEN v_where := v_where || ' AND p.company_phone IS NOT NULL AND p.company_phone != '''''; END IF;
  IF p_has_company_linkedin IS NOT NULL AND p_has_company_linkedin THEN v_where := v_where || ' AND p.company_linkedin IS NOT NULL AND p.company_linkedin != '''''; END IF;
  IF p_has_company_facebook IS NOT NULL AND p_has_company_facebook THEN v_where := v_where || ' AND p.company_facebook_url IS NOT NULL AND p.company_facebook_url != '''''; END IF;
  IF p_has_company_twitter IS NOT NULL AND p_has_company_twitter THEN v_where := v_where || ' AND p.company_twitter_url IS NOT NULL AND p.company_twitter_url != '''''; END IF;
  IF p_zip_code IS NOT NULL THEN v_where := v_where || ' AND p.zip_code ILIKE ' || quote_literal(p_zip_code || '%'); END IF;
  IF p_children IS NOT NULL AND array_length(p_children, 1) > 0 THEN v_where := v_where || ' AND LOWER(p.children) = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(LOWER(x)) FROM unnest(p_children) x), ',') || '])'; END IF;
  IF p_homeowner IS NOT NULL THEN v_where := v_where || ' AND LOWER(p.homeowner) = ' || quote_literal(CASE WHEN p_homeowner THEN 'yes' ELSE 'no' END); END IF;
  IF p_married IS NOT NULL THEN v_where := v_where || ' AND LOWER(p.married) = ' || quote_literal(CASE WHEN p_married THEN 'yes' ELSE 'no' END); END IF;
  IF p_added_on_days_ago IS NOT NULL THEN v_where := v_where || ' AND p.created_at >= NOW() - INTERVAL ''' || p_added_on_days_ago || ' days'''; END IF;
  IF p_exclude_job_titles IS NOT NULL AND array_length(p_exclude_job_titles, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_job_titles, 1) LOOP v_where := v_where || ' AND p.job_title NOT ILIKE ' || quote_literal('%' || p_exclude_job_titles[i] || '%'); END LOOP; END IF;
  IF p_exclude_industries IS NOT NULL AND array_length(p_exclude_industries, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_industries, 1) LOOP v_where := v_where || ' AND p.company_industry NOT ILIKE ' || quote_literal('%' || p_exclude_industries[i] || '%'); END LOOP; END IF;
  IF p_exclude_cities IS NOT NULL AND array_length(p_exclude_cities, 1) > 0 THEN v_where := v_where || ' AND LOWER(p.city) != ALL(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(LOWER(x)) FROM unnest(p_exclude_cities) x), ',') || '])'; END IF;
  IF p_exclude_countries IS NOT NULL AND array_length(p_exclude_countries, 1) > 0 THEN v_where := v_where || ' AND p.country != ALL(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(public.normalize_country(x)) FROM unnest(p_exclude_countries) x), ',') || '])'; END IF;
  IF p_exclude_keywords IS NOT NULL AND array_length(p_exclude_keywords, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_keywords, 1) LOOP v_where := v_where || ' AND p.job_title NOT ILIKE ' || quote_literal('%' || p_exclude_keywords[i] || '%') || ' AND p.company_name NOT ILIKE ' || quote_literal('%' || p_exclude_keywords[i] || '%') || ' AND p.company_description NOT ILIKE ' || quote_literal('%' || p_exclude_keywords[i] || '%'); END LOOP; END IF;
  IF p_exclude_technologies IS NOT NULL AND array_length(p_exclude_technologies, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_technologies, 1) LOOP v_where := v_where || ' AND p.technologies NOT ILIKE ' || quote_literal('%' || p_exclude_technologies[i] || '%'); END LOOP; END IF;
  IF p_exclude_person_skills IS NOT NULL AND array_length(p_exclude_person_skills, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_person_skills, 1) LOOP v_where := v_where || ' AND p.skills NOT ILIKE ' || quote_literal('%' || p_exclude_person_skills[i] || '%'); END LOOP; END IF;
  IF p_exclude_person_interests IS NOT NULL AND array_length(p_exclude_person_interests, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_person_interests, 1) LOOP v_where := v_where || ' AND p.interests NOT ILIKE ' || quote_literal('%' || p_exclude_person_interests[i] || '%'); END LOOP; END IF;
  IF p_company_size_ranges IS NOT NULL AND array_length(p_company_size_ranges, 1) > 0 THEN v_where := v_where || ' AND p.company_size = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(v) FROM unnest(p_company_size_ranges) r CROSS JOIN LATERAL (SELECT unnest(CASE r WHEN '1-10' THEN ARRAY['1 to 10'] WHEN '11-50' THEN ARRAY['26 to 50'] WHEN '51-200' THEN ARRAY['51 to 100', '101 to 250'] WHEN '201-500' THEN ARRAY['251 to 500'] WHEN '501-1000' THEN ARRAY['501 to 1000'] WHEN '1001-5000' THEN ARRAY['1001 to 5000'] WHEN '5001-10000' THEN ARRAY['5001 to 10000'] WHEN '10000+' THEN ARRAY['10000+'] ELSE ARRAY[r] END) AS v) vals), ',') || '])'; END IF;
  IF p_company_revenue IS NOT NULL AND array_length(p_company_revenue, 1) > 0 THEN v_where := v_where || ' AND p.company_revenue = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(val) FROM (SELECT unnest(CASE LOWER(x) WHEN 'under $1m' THEN ARRAY['Under 1 Million'] WHEN '$1m - $10m' THEN ARRAY['1 Million To 5 Million', '5 Million To 10 Million'] WHEN '$10m - $50m' THEN ARRAY['10 Million To 25 Million', '25 Million To 50 Million'] WHEN '$50m - $100m' THEN ARRAY['50 Million To 100 Million'] WHEN '$100m - $500m' THEN ARRAY['100 Million To 250 Million', '250 Million To 500 Million'] WHEN '$500m - $1b' THEN ARRAY['500 Million To 1 Billion'] WHEN '$1b+' THEN ARRAY['1 Billion And Over'] ELSE ARRAY[]::text[] END) AS val FROM unnest(p_company_revenue) x) sub), ',') || '])'; END IF;

  v_sql := 'SELECT * FROM public.prospects p ' || v_where || ' ORDER BY p.id LIMIT ' || p_limit || ' OFFSET ' || p_offset;
  RETURN QUERY EXECUTE v_sql;
END;
$function$;
