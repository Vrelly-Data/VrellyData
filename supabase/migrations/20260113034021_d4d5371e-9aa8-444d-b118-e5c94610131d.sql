
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer;
  v_total_count integer;
  v_results jsonb;
  v_where_clauses text[];
  v_where_sql text;
  v_filter_key text;
  v_filter_value jsonb;
  v_operator text;
  v_values jsonb;
  v_value_array text[];
  v_single_value text;
  v_dept_values text[];
  v_dept_mappings jsonb;
  v_mapped_depts text[];
  v_dept text;
  v_mapped text;
  v_rev_values text[];
  v_rev_conditions text[];
  v_rev_range text;
  v_rev_min numeric;
  v_rev_max numeric;
BEGIN
  -- Calculate offset
  v_offset := (p_page - 1) * p_per_page;
  
  -- Initialize where clauses with entity type filter - CAST to enum
  v_where_clauses := ARRAY['fd.entity_type = ''' || p_entity_type || '''::entity_type'];
  
  -- Department equivalence mapping
  v_dept_mappings := '{
    "Executive": ["Executive", "C-Suite"],
    "C-Suite": ["Executive", "C-Suite"],
    "Engineering": ["Engineering", "Engineering & Technical", "Technical"],
    "Engineering & Technical": ["Engineering", "Engineering & Technical", "Technical"],
    "Technical": ["Engineering", "Engineering & Technical", "Technical"],
    "Sales": ["Sales", "Sales & Business Development", "Business Development"],
    "Sales & Business Development": ["Sales", "Sales & Business Development", "Business Development"],
    "Business Development": ["Sales", "Sales & Business Development", "Business Development"],
    "Marketing": ["Marketing", "Marketing & Communications", "Communications"],
    "Marketing & Communications": ["Marketing", "Marketing & Communications", "Communications"],
    "Communications": ["Marketing", "Marketing & Communications", "Communications"],
    "Finance": ["Finance", "Finance & Accounting", "Accounting"],
    "Finance & Accounting": ["Finance", "Finance & Accounting", "Accounting"],
    "Accounting": ["Finance", "Finance & Accounting", "Accounting"],
    "Human Resources": ["Human Resources", "HR", "People Operations"],
    "HR": ["Human Resources", "HR", "People Operations"],
    "People Operations": ["Human Resources", "HR", "People Operations"],
    "Operations": ["Operations", "Operations & Logistics", "Logistics"],
    "Operations & Logistics": ["Operations", "Operations & Logistics", "Logistics"],
    "Logistics": ["Operations", "Operations & Logistics", "Logistics"],
    "Legal": ["Legal", "Legal & Compliance", "Compliance"],
    "Legal & Compliance": ["Legal", "Legal & Compliance", "Compliance"],
    "Compliance": ["Legal", "Legal & Compliance", "Compliance"],
    "IT": ["IT", "Information Technology", "Technology"],
    "Information Technology": ["IT", "Information Technology", "Technology"],
    "Product": ["Product", "Product Management"],
    "Product Management": ["Product", "Product Management"],
    "Design": ["Design", "Creative", "UX", "UI"],
    "Creative": ["Design", "Creative"],
    "Customer Success": ["Customer Success", "Customer Service", "Support"],
    "Customer Service": ["Customer Success", "Customer Service", "Support"],
    "Support": ["Customer Success", "Customer Service", "Support"],
    "Research": ["Research", "R&D", "Research & Development"],
    "R&D": ["Research", "R&D", "Research & Development"],
    "Research & Development": ["Research", "R&D", "Research & Development"]
  }'::jsonb;
  
  -- Process filters
  FOR v_filter_key, v_filter_value IN SELECT * FROM jsonb_each(p_filters)
  LOOP
    v_operator := v_filter_value->>'operator';
    v_values := v_filter_value->'value';
    
    -- Skip empty filters
    IF v_values IS NULL OR v_values = 'null'::jsonb OR 
       (jsonb_typeof(v_values) = 'array' AND jsonb_array_length(v_values) = 0) OR
       (jsonb_typeof(v_values) = 'string' AND v_values::text = '""') THEN
      CONTINUE;
    END IF;
    
    -- Handle different filter keys with SPECIAL HANDLING for department and company_revenue
    CASE v_filter_key
      -- Special handling for department with equivalence mapping
      WHEN 'department' THEN
        IF jsonb_typeof(v_values) = 'array' AND jsonb_array_length(v_values) > 0 THEN
          -- Get all selected departments
          SELECT array_agg(val) INTO v_dept_values 
          FROM jsonb_array_elements_text(v_values) AS val;
          
          -- Build mapped departments array
          v_mapped_depts := ARRAY[]::text[];
          FOREACH v_dept IN ARRAY v_dept_values
          LOOP
            IF v_dept_mappings ? v_dept THEN
              -- Add all equivalent departments
              FOR v_mapped IN SELECT jsonb_array_elements_text(v_dept_mappings->v_dept)
              LOOP
                IF NOT v_mapped = ANY(v_mapped_depts) THEN
                  v_mapped_depts := array_append(v_mapped_depts, v_mapped);
                END IF;
              END LOOP;
            ELSE
              -- No mapping, use as-is
              IF NOT v_dept = ANY(v_mapped_depts) THEN
                v_mapped_depts := array_append(v_mapped_depts, v_dept);
              END IF;
            END IF;
          END LOOP;
          
          IF array_length(v_mapped_depts, 1) > 0 THEN
            IF v_operator = 'not_in' THEN
              v_where_clauses := array_append(v_where_clauses, 
                'NOT (fd.data->>''department'' = ANY(ARRAY[' || 
                (SELECT string_agg('''' || replace(d, '''', '''''') || '''', ', ') FROM unnest(v_mapped_depts) AS d) || 
                ']))');
            ELSE
              v_where_clauses := array_append(v_where_clauses, 
                'fd.data->>''department'' = ANY(ARRAY[' || 
                (SELECT string_agg('''' || replace(d, '''', '''''') || '''', ', ') FROM unnest(v_mapped_depts) AS d) || 
                '])');
            END IF;
          END IF;
        END IF;
      
      -- Special handling for company_revenue with range matching
      WHEN 'company_revenue' THEN
        IF jsonb_typeof(v_values) = 'array' AND jsonb_array_length(v_values) > 0 THEN
          SELECT array_agg(val) INTO v_rev_values 
          FROM jsonb_array_elements_text(v_values) AS val;
          
          v_rev_conditions := ARRAY[]::text[];
          FOREACH v_rev_range IN ARRAY v_rev_values
          LOOP
            -- Parse revenue ranges and create numeric comparisons
            -- Handle formats: "$1M-$10M", "$100M - $500M", "$1B+", "< $1M", etc.
            IF v_rev_range ~ '^\$?(\d+(?:\.\d+)?)\s*([KMB])?\s*[-–]\s*\$?(\d+(?:\.\d+)?)\s*([KMB])?$' THEN
              -- Range format: $1M-$10M or $100M - $500M
              v_rev_min := (
                SELECT 
                  CASE 
                    WHEN upper(m[2]) = 'K' THEN m[1]::numeric * 1000
                    WHEN upper(m[2]) = 'M' THEN m[1]::numeric * 1000000
                    WHEN upper(m[2]) = 'B' THEN m[1]::numeric * 1000000000
                    ELSE m[1]::numeric
                  END
                FROM regexp_matches(v_rev_range, '^\$?(\d+(?:\.\d+)?)\s*([KMB])?', 'i') AS m
              );
              v_rev_max := (
                SELECT 
                  CASE 
                    WHEN upper(m[2]) = 'K' THEN m[1]::numeric * 1000
                    WHEN upper(m[2]) = 'M' THEN m[1]::numeric * 1000000
                    WHEN upper(m[2]) = 'B' THEN m[1]::numeric * 1000000000
                    ELSE m[1]::numeric
                  END
                FROM regexp_matches(v_rev_range, '[-–]\s*\$?(\d+(?:\.\d+)?)\s*([KMB])?$', 'i') AS m
              );
              v_rev_conditions := array_append(v_rev_conditions,
                '((fd.data->>''company_revenue'')::numeric >= ' || v_rev_min || 
                ' AND (fd.data->>''company_revenue'')::numeric <= ' || v_rev_max || ')');
            ELSIF v_rev_range ~ '^\$?(\d+(?:\.\d+)?)\s*([KMB])?\s*\+$' THEN
              -- Greater than format: $1B+
              v_rev_min := (
                SELECT 
                  CASE 
                    WHEN upper(m[2]) = 'K' THEN m[1]::numeric * 1000
                    WHEN upper(m[2]) = 'M' THEN m[1]::numeric * 1000000
                    WHEN upper(m[2]) = 'B' THEN m[1]::numeric * 1000000000
                    ELSE m[1]::numeric
                  END
                FROM regexp_matches(v_rev_range, '^\$?(\d+(?:\.\d+)?)\s*([KMB])?', 'i') AS m
              );
              v_rev_conditions := array_append(v_rev_conditions,
                '(fd.data->>''company_revenue'')::numeric >= ' || v_rev_min);
            ELSIF v_rev_range ~ '^[<>]' THEN
              -- Less than or greater than: < $1M, > $500M
              v_rev_min := (
                SELECT 
                  CASE 
                    WHEN upper(m[2]) = 'K' THEN m[1]::numeric * 1000
                    WHEN upper(m[2]) = 'M' THEN m[1]::numeric * 1000000
                    WHEN upper(m[2]) = 'B' THEN m[1]::numeric * 1000000000
                    ELSE m[1]::numeric
                  END
                FROM regexp_matches(v_rev_range, '\$?(\d+(?:\.\d+)?)\s*([KMB])?', 'i') AS m
              );
              IF v_rev_range ~ '^<' THEN
                v_rev_conditions := array_append(v_rev_conditions,
                  '(fd.data->>''company_revenue'')::numeric < ' || v_rev_min);
              ELSE
                v_rev_conditions := array_append(v_rev_conditions,
                  '(fd.data->>''company_revenue'')::numeric > ' || v_rev_min);
              END IF;
            ELSE
              -- Fallback: exact text match
              v_rev_conditions := array_append(v_rev_conditions,
                'fd.data->>''company_revenue'' = ''' || replace(v_rev_range, '''', '''''') || '''');
            END IF;
          END LOOP;
          
          IF array_length(v_rev_conditions, 1) > 0 THEN
            IF v_operator = 'not_in' THEN
              v_where_clauses := array_append(v_where_clauses, 
                'NOT (' || array_to_string(v_rev_conditions, ' OR ') || ')');
            ELSE
              v_where_clauses := array_append(v_where_clauses, 
                '(' || array_to_string(v_rev_conditions, ' OR ') || ')');
            END IF;
          END IF;
        END IF;
        
      -- Standard text/array filters
      WHEN 'job_title', 'seniority', 'company_name', 'company_industry', 
           'company_type', 'company_country', 'company_state', 'company_city',
           'person_country', 'person_state', 'person_city', 'skills', 'keywords' THEN
        IF jsonb_typeof(v_values) = 'array' AND jsonb_array_length(v_values) > 0 THEN
          SELECT array_agg(val) INTO v_value_array 
          FROM jsonb_array_elements_text(v_values) AS val;
          
          IF v_operator = 'not_in' THEN
            v_where_clauses := array_append(v_where_clauses, 
              'NOT (fd.data->>''' || v_filter_key || ''' = ANY(ARRAY[' || 
              (SELECT string_agg('''' || replace(v, '''', '''''') || '''', ', ') FROM unnest(v_value_array) AS v) || 
              ']))');
          ELSE
            v_where_clauses := array_append(v_where_clauses, 
              'fd.data->>''' || v_filter_key || ''' = ANY(ARRAY[' || 
              (SELECT string_agg('''' || replace(v, '''', '''''') || '''', ', ') FROM unnest(v_value_array) AS v) || 
              '])');
          END IF;
        END IF;
        
      -- Numeric filters
      WHEN 'company_employee_count', 'years_experience' THEN
        IF jsonb_typeof(v_values) = 'object' THEN
          IF v_values->>'min' IS NOT NULL AND v_values->>'min' != '' THEN
            v_where_clauses := array_append(v_where_clauses, 
              '(fd.data->>''' || v_filter_key || ''')::numeric >= ' || (v_values->>'min')::numeric);
          END IF;
          IF v_values->>'max' IS NOT NULL AND v_values->>'max' != '' THEN
            v_where_clauses := array_append(v_where_clauses, 
              '(fd.data->>''' || v_filter_key || ''')::numeric <= ' || (v_values->>'max')::numeric);
          END IF;
        END IF;
        
      -- Boolean filters
      WHEN 'has_email', 'has_phone', 'email_verified', 'is_public' THEN
        IF jsonb_typeof(v_values) = 'boolean' OR 
           (jsonb_typeof(v_values) = 'string' AND v_values::text IN ('"true"', '"false"')) THEN
          v_single_value := CASE 
            WHEN jsonb_typeof(v_values) = 'boolean' THEN v_values::text
            ELSE trim(both '"' from v_values::text)
          END;
          v_where_clauses := array_append(v_where_clauses, 
            '(fd.data->>''' || v_filter_key || ''')::boolean = ' || v_single_value);
        END IF;
        
      ELSE
        -- Generic text contains for unknown filters
        IF jsonb_typeof(v_values) = 'string' THEN
          v_single_value := trim(both '"' from v_values::text);
          IF v_single_value != '' THEN
            v_where_clauses := array_append(v_where_clauses, 
              'fd.data->>''' || v_filter_key || ''' ILIKE ''%' || replace(v_single_value, '''', '''''') || '%''');
          END IF;
        END IF;
    END CASE;
  END LOOP;
  
  -- Build WHERE clause
  v_where_sql := array_to_string(v_where_clauses, ' AND ');
  
  -- Get total count
  EXECUTE 'SELECT COUNT(*) FROM free_data fd WHERE ' || v_where_sql INTO v_total_count;
  
  -- Get paginated results
  EXECUTE '
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        ''id'', fd.id,
        ''entity_type'', fd.entity_type,
        ''data'', fd.data,
        ''created_at'', fd.created_at
      )
    ), ''[]''::jsonb)
    FROM (
      SELECT fd.id, fd.entity_type, fd.data, fd.created_at
      FROM free_data fd
      WHERE ' || v_where_sql || '
      ORDER BY fd.created_at DESC
      LIMIT ' || p_per_page || ' OFFSET ' || v_offset || '
    ) fd'
  INTO v_results;
  
  -- Return results with pagination info
  RETURN jsonb_build_object(
    'items', v_results,
    'total_estimate', v_total_count,
    'page', p_page,
    'per_page', p_per_page,
    'has_more', (v_offset + p_per_page) < v_total_count
  );
END;
$$;
