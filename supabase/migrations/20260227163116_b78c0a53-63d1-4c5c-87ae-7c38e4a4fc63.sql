
CREATE OR REPLACE FUNCTION public.search_free_data_count(
  p_entity_type entity_type DEFAULT 'person'::entity_type,
  p_keywords text[] DEFAULT NULL::text[],
  p_industries text[] DEFAULT NULL::text[],
  p_cities text[] DEFAULT NULL::text[],
  p_countries text[] DEFAULT NULL::text[],
  p_job_titles text[] DEFAULT NULL::text[],
  p_seniority_levels text[] DEFAULT NULL::text[],
  p_departments text[] DEFAULT NULL::text[],
  p_company_size_ranges text[] DEFAULT NULL::text[],
  p_company_revenue text[] DEFAULT NULL::text[],
  p_technologies text[] DEFAULT NULL::text[],
  p_gender text[] DEFAULT NULL::text[],
  p_income text[] DEFAULT NULL::text[],
  p_net_worth text[] DEFAULT NULL::text[],
  p_person_skills text[] DEFAULT NULL::text[],
  p_person_interests text[] DEFAULT NULL::text[],
  p_has_email boolean DEFAULT NULL::boolean,
  p_has_phone boolean DEFAULT NULL::boolean,
  p_has_linkedin boolean DEFAULT NULL::boolean,
  p_has_facebook boolean DEFAULT NULL::boolean,
  p_has_twitter boolean DEFAULT NULL::boolean,
  p_has_personal_email boolean DEFAULT NULL::boolean,
  p_has_business_email boolean DEFAULT NULL::boolean,
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
  p_exclude_person_interests text[] DEFAULT NULL::text[]
)
RETURNS TABLE(total_count bigint, is_estimate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  where_clause text;
  count_sql text;
  has_filters boolean := false;
  v_total_count bigint;
  v_is_estimate boolean := false;
BEGIN
  where_clause := 'WHERE fd.entity_type = $1';

  -- Build WHERE clause (same filter logic as search_free_data_results)
  IF p_keywords IS NOT NULL AND array_length(p_keywords, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || '
    AND EXISTS (SELECT 1 FROM unnest($2) kw WHERE fd.entity_data->>''firstName'' ILIKE ''%'' || kw || ''%'' OR fd.entity_data->>''lastName'' ILIKE ''%'' || kw || ''%'' OR fd.entity_data->>''title'' ILIKE ''%'' || kw || ''%'' OR fd.entity_data->>''company'' ILIKE ''%'' || kw || ''%'' OR fd.entity_data->>''companyName'' ILIKE ''%'' || kw || ''%'' OR fd.entity_data->>''industry'' ILIKE ''%'' || kw || ''%'')';
  END IF;

  IF p_industries IS NOT NULL AND array_length(p_industries, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND LOWER(fd.entity_data->>''industry'') = ANY(SELECT LOWER(unnest($3)))';
  END IF;

  IF p_cities IS NOT NULL AND array_length(p_cities, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND LOWER(COALESCE(fd.entity_data->>''city'', fd.entity_data->>''personCity'', fd.entity_data->>''companyCity'', '''')) = ANY(SELECT LOWER(unnest($4)))';
  END IF;

  IF p_countries IS NOT NULL AND array_length(p_countries, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND LOWER(COALESCE(fd.entity_data->>''country'', fd.entity_data->>''personCountry'', fd.entity_data->>''companyCountry'', '''')) = ANY(SELECT LOWER(unnest($5)))';
  END IF;

  IF p_job_titles IS NOT NULL AND array_length(p_job_titles, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND EXISTS (SELECT 1 FROM unnest($6) jt WHERE LOWER(fd.entity_data->>''title'') ILIKE ''%'' || LOWER(jt) || ''%'')';
  END IF;

  IF p_seniority_levels IS NOT NULL AND array_length(p_seniority_levels, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || '
    AND EXISTS (SELECT 1 FROM unnest($7) sl WHERE CASE LOWER(sl)
      WHEN ''c-level'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''(c-level|c-suite|csuite|c level|c suite|cxo|chief|founder)'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''^(ceo|cfo|cto|coo|cmo|cio|cpo|chief)''
      WHEN ''president'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''president'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''president''
      WHEN ''vp'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''(vp|vice president|v\.p\.)'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''(^vp|vice president)''
      WHEN ''head of'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''head'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''^head of''
      WHEN ''director'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''director'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''director''
      WHEN ''manager'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''manager'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''manager''
      WHEN ''senior'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''senior'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''(^sr\.|^senior)''
      WHEN ''individual contributor'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''(staff|individual|contributor|ic)'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''(^staff |individual contributor)''
      WHEN ''entry'' THEN LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ~* ''(entry|junior|associate|intern)'' OR LOWER(COALESCE(fd.entity_data->>''title'','''')) ~* ''(^junior|^associate|^intern|^entry)''
      ELSE LOWER(COALESCE(fd.entity_data->>''seniority'','''')) ILIKE ''%'' || sl || ''%''
    END)';
  END IF;

  IF p_departments IS NOT NULL AND array_length(p_departments, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || '
    AND EXISTS (SELECT 1 FROM unnest($8) dept WHERE CASE LOWER(dept)
      WHEN ''c-suite / leadership'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''(c-suite|executive|leadership|founder|owner)''
      WHEN ''engineering'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''(engineering|technical|development|software|it)''
      WHEN ''sales'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''sales''
      WHEN ''marketing'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''marketing''
      WHEN ''finance'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''(finance|accounting)''
      WHEN ''hr'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''(human resources|hr|people|talent)''
      WHEN ''operations'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''operations''
      WHEN ''legal'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''legal''
      WHEN ''it'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''(it|information technology)''
      WHEN ''community and social services'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''(community|social services|nonprofit|ngo)''
      WHEN ''customer success'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''(customer success|customer service|support|client)''
      WHEN ''product'' THEN LOWER(COALESCE(fd.entity_data->>''department'','''')) ~* ''(product|product management|pm)''
      ELSE LOWER(COALESCE(fd.entity_data->>''department'','''')) ILIKE ''%'' || dept || ''%''
    END)';
  END IF;

  IF p_company_size_ranges IS NOT NULL AND array_length(p_company_size_ranges, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || '
    AND EXISTS (SELECT 1 FROM unnest($9) csr WHERE CASE csr
      WHEN ''1-10'' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>''companySize''),0) BETWEEN 1 AND 10
      WHEN ''11-50'' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>''companySize''),0) BETWEEN 11 AND 50
      WHEN ''51-200'' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>''companySize''),0) BETWEEN 51 AND 200
      WHEN ''201-500'' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>''companySize''),0) BETWEEN 201 AND 500
      WHEN ''501-1000'' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>''companySize''),0) BETWEEN 501 AND 1000
      WHEN ''1001-5000'' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>''companySize''),0) BETWEEN 1001 AND 5000
      WHEN ''5001-10000'' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>''companySize''),0) BETWEEN 5001 AND 10000
      WHEN ''10000+'' THEN COALESCE(public.parse_employee_count_upper(fd.entity_data->>''companySize''),0) > 10000
      ELSE false
    END)';
  END IF;

  IF p_company_revenue IS NOT NULL AND array_length(p_company_revenue, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || '
    AND EXISTS (SELECT 1 FROM unnest($10) cr WHERE CASE LOWER(cr)
      WHEN ''under $1m'' THEN COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) > 0 AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) < 1000000
      WHEN ''$1m - $10m'' THEN COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) >= 1000000 AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) < 10000000
      WHEN ''$10m - $50m'' THEN COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) >= 10000000 AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) < 50000000
      WHEN ''$50m - $100m'' THEN COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) >= 50000000 AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) < 100000000
      WHEN ''$100m - $500m'' THEN COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) >= 100000000 AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) < 500000000
      WHEN ''$500m - $1b'' THEN COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) >= 500000000 AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) < 1000000000
      WHEN ''$1b+'' THEN COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>''companyRevenue'',fd.entity_data->>''revenue'',fd.entity_data->>''annualRevenue'')),0) >= 1000000000
      ELSE false
    END)';
  END IF;

  IF p_technologies IS NOT NULL AND array_length(p_technologies, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND EXISTS (SELECT 1 FROM unnest($11) tech WHERE fd.entity_data->>''technologies'' ILIKE ''%'' || tech || ''%'')';
  END IF;

  IF p_gender IS NOT NULL AND array_length(p_gender, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND LOWER(fd.entity_data->>''gender'') = ANY(SELECT LOWER(unnest($12)))';
  END IF;

  IF p_income IS NOT NULL AND array_length(p_income, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND fd.entity_data->>''incomeRange'' IS NOT NULL AND fd.entity_data->>''incomeRange'' != '''''
    || ' AND EXISTS (SELECT 1 FROM unnest($13) inc WHERE CASE LOWER(inc)
      WHEN ''under $50k'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''incomeRange'',''[^0-9]'','''',''g''),'''')::int,0) < 50
      WHEN ''$50k - $100k'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''incomeRange'',''[^0-9]'','''',''g''),'''')::int,0) BETWEEN 50 AND 100
      WHEN ''$100k - $200k'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''incomeRange'',''[^0-9]'','''',''g''),'''')::int,0) BETWEEN 101 AND 200
      WHEN ''$200k - $500k'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''incomeRange'',''[^0-9]'','''',''g''),'''')::int,0) BETWEEN 201 AND 500
      WHEN ''$500k - $1m'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''incomeRange'',''[^0-9]'','''',''g''),'''')::int,0) BETWEEN 501 AND 1000
      WHEN ''$1m+'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''incomeRange'',''[^0-9]'','''',''g''),'''')::int,0) > 1000
      ELSE false END)';
  END IF;

  IF p_net_worth IS NOT NULL AND array_length(p_net_worth, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND fd.entity_data->>''netWorth'' IS NOT NULL AND fd.entity_data->>''netWorth'' != '''''
    || ' AND EXISTS (SELECT 1 FROM unnest($14) nw WHERE CASE LOWER(nw)
      WHEN ''under $100k'' THEN COALESCE(CASE WHEN fd.entity_data->>''netWorth'' LIKE ''-%'' THEN -1*NULLIF(REGEXP_REPLACE(fd.entity_data->>''netWorth'',''[^0-9]'','''',''g''),'''')::int ELSE NULLIF(REGEXP_REPLACE(fd.entity_data->>''netWorth'',''[^0-9]'','''',''g''),'''')::int END,0) < 100
      WHEN ''$100k - $500k'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''netWorth'',''[^0-9]'','''',''g''),'''')::int,0) BETWEEN 100 AND 500
      WHEN ''$500k - $1m'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''netWorth'',''[^0-9]'','''',''g''),'''')::int,0) BETWEEN 501 AND 1000
      WHEN ''$1m - $5m'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''netWorth'',''[^0-9]'','''',''g''),'''')::int,0) BETWEEN 1001 AND 5000
      WHEN ''$5m - $10m'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''netWorth'',''[^0-9]'','''',''g''),'''')::int,0) BETWEEN 5001 AND 10000
      WHEN ''$10m+'' THEN COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>''netWorth'',''[^0-9]'','''',''g''),'''')::int,0) > 10000
      ELSE false END)';
  END IF;

  IF p_person_skills IS NOT NULL AND array_length(p_person_skills, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND EXISTS (SELECT 1 FROM unnest($15) sk WHERE fd.entity_data->>''skills'' ILIKE ''%'' || sk || ''%'')';
  END IF;

  IF p_person_interests IS NOT NULL AND array_length(p_person_interests, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND EXISTS (SELECT 1 FROM unnest($16) interest WHERE fd.entity_data->>''interests'' ILIKE ''%'' || interest || ''%'')';
  END IF;

  IF p_has_email IS NOT NULL AND p_has_email THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''email'' IS NOT NULL AND fd.entity_data->>''email'' != '''''; END IF;
  IF p_has_phone IS NOT NULL AND p_has_phone THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''phone'' IS NOT NULL AND fd.entity_data->>''phone'' != '''''; END IF;
  IF p_has_linkedin IS NOT NULL AND p_has_linkedin THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''linkedin'' IS NOT NULL AND fd.entity_data->>''linkedin'' != '''''; END IF;
  IF p_has_facebook IS NOT NULL AND p_has_facebook THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''facebookUrl'' IS NOT NULL AND fd.entity_data->>''facebookUrl'' != '''''; END IF;
  IF p_has_twitter IS NOT NULL AND p_has_twitter THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''twitterUrl'' IS NOT NULL AND fd.entity_data->>''twitterUrl'' != '''''; END IF;
  IF p_has_personal_email IS NOT NULL AND p_has_personal_email THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''personalEmail'' IS NOT NULL AND fd.entity_data->>''personalEmail'' != '''''; END IF;
  IF p_has_business_email IS NOT NULL AND p_has_business_email THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''businessEmail'' IS NOT NULL AND fd.entity_data->>''businessEmail'' != '''''; END IF;
  IF p_has_company_phone IS NOT NULL AND p_has_company_phone THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''companyPhone'' IS NOT NULL AND fd.entity_data->>''companyPhone'' != '''''; END IF;
  IF p_has_company_linkedin IS NOT NULL AND p_has_company_linkedin THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''companyLinkedin'' IS NOT NULL AND fd.entity_data->>''companyLinkedin'' != '''''; END IF;
  IF p_has_company_facebook IS NOT NULL AND p_has_company_facebook THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''companyFacebookUrl'' IS NOT NULL AND fd.entity_data->>''companyFacebookUrl'' != '''''; END IF;
  IF p_has_company_twitter IS NOT NULL AND p_has_company_twitter THEN has_filters := true; where_clause := where_clause || ' AND fd.entity_data->>''companyTwitterUrl'' IS NOT NULL AND fd.entity_data->>''companyTwitterUrl'' != '''''; END IF;

  -- Exclusion filters
  IF p_exclude_keywords IS NOT NULL AND array_length(p_exclude_keywords, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND NOT EXISTS (SELECT 1 FROM unnest($28) kw WHERE fd.entity_data->>''firstName'' ILIKE ''%''||kw||''%'' OR fd.entity_data->>''lastName'' ILIKE ''%''||kw||''%'' OR fd.entity_data->>''title'' ILIKE ''%''||kw||''%'' OR fd.entity_data->>''company'' ILIKE ''%''||kw||''%'' OR fd.entity_data->>''companyName'' ILIKE ''%''||kw||''%'' OR fd.entity_data->>''industry'' ILIKE ''%''||kw||''%'')';
  END IF;
  IF p_exclude_job_titles IS NOT NULL AND array_length(p_exclude_job_titles, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND NOT EXISTS (SELECT 1 FROM unnest($29) jt WHERE LOWER(fd.entity_data->>''title'') ILIKE ''%''||LOWER(jt)||''%'')';
  END IF;
  IF p_exclude_industries IS NOT NULL AND array_length(p_exclude_industries, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND LOWER(fd.entity_data->>''industry'') != ALL(SELECT LOWER(unnest($30)))';
  END IF;
  IF p_exclude_cities IS NOT NULL AND array_length(p_exclude_cities, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND LOWER(COALESCE(fd.entity_data->>''city'',fd.entity_data->>''personCity'',fd.entity_data->>''companyCity'','''')) != ALL(SELECT LOWER(unnest($31)))';
  END IF;
  IF p_exclude_countries IS NOT NULL AND array_length(p_exclude_countries, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND LOWER(COALESCE(fd.entity_data->>''country'',fd.entity_data->>''personCountry'',fd.entity_data->>''companyCountry'','''')) != ALL(SELECT LOWER(unnest($32)))';
  END IF;
  IF p_exclude_technologies IS NOT NULL AND array_length(p_exclude_technologies, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND NOT EXISTS (SELECT 1 FROM unnest($33) tech WHERE fd.entity_data->>''technologies'' ILIKE ''%''||tech||''%'')';
  END IF;
  IF p_exclude_person_skills IS NOT NULL AND array_length(p_exclude_person_skills, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND NOT EXISTS (SELECT 1 FROM unnest($34) sk WHERE fd.entity_data->>''skills'' ILIKE ''%''||sk||''%'')';
  END IF;
  IF p_exclude_person_interests IS NOT NULL AND array_length(p_exclude_person_interests, 1) IS NOT NULL THEN
    has_filters := true;
    where_clause := where_clause || ' AND NOT EXISTS (SELECT 1 FROM unnest($35) interest WHERE fd.entity_data->>''interests'' ILIKE ''%''||interest||''%'')';
  END IF;

  -- Unified counting strategy: exact bounded count for ALL filtered queries
  IF has_filters THEN
    BEGIN
      count_sql := 'SELECT count(*) FROM (SELECT 1 FROM public.free_data fd ' || where_clause || ' LIMIT 100001) _sub';
      EXECUTE count_sql INTO v_total_count
      USING p_entity_type,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35;
      v_is_estimate := false;
      IF v_total_count > 100000 THEN v_total_count := 100000; END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Timeout or other error: return safe fallback
      v_total_count := 0;
      v_is_estimate := true;
    END;
  ELSE
    -- No filters: use pg_class estimate (instant)
    SELECT GREATEST(c.reltuples::bigint, 0) INTO v_total_count
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'free_data' AND n.nspname = 'public';
    v_is_estimate := true;
    IF v_total_count > 100000 THEN v_total_count := 100000; END IF;
  END IF;

  RETURN QUERY SELECT v_total_count, v_is_estimate;
END;
$function$;
