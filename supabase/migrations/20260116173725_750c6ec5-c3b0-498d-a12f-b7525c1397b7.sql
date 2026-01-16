-- Merge Owner into Founder seniority filter
-- Remove Owner as separate option, expand Founder to match owner-related values
CREATE OR REPLACE FUNCTION public.title_matches_seniority(
  p_title text, 
  p_seniority text[], 
  p_seniority_field text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  seniority_value text;
  title_lower text;
  seniority_lower text;
BEGIN
  -- Normalize inputs
  title_lower := lower(coalesce(p_title, ''));
  seniority_lower := lower(coalesce(p_seniority_field, ''));
  
  -- If no seniority filters provided, match everything
  IF p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL THEN
    RETURN TRUE;
  END IF;
  
  -- FIRST: Check seniority field if it exists (SOURCE OF TRUTH)
  IF seniority_lower IS NOT NULL AND seniority_lower != '' THEN
    FOREACH seniority_value IN ARRAY p_seniority
    LOOP
      -- Map filter values to seniority field values
      CASE lower(seniority_value)
        WHEN 'c-level' THEN
          IF seniority_lower IN ('c suite', 'cxo', 'c-suite', 'c-level', 'clevel') THEN
            RETURN TRUE;
          END IF;
        WHEN 'vp' THEN
          IF seniority_lower IN ('vp', 'vice president', 'vice-president') THEN
            RETURN TRUE;
          END IF;
        WHEN 'director' THEN
          IF seniority_lower IN ('director', 'dir') THEN
            RETURN TRUE;
          END IF;
        WHEN 'manager' THEN
          IF seniority_lower IN ('manager', 'mgr') THEN
            RETURN TRUE;
          END IF;
        WHEN 'senior' THEN
          IF seniority_lower IN ('senior', 'sr', 'sr.') THEN
            RETURN TRUE;
          END IF;
        WHEN 'entry' THEN
          IF seniority_lower IN ('entry', 'entry level', 'entry-level', 'junior', 'jr', 'jr.') THEN
            RETURN TRUE;
          END IF;
        WHEN 'founder' THEN
          -- MERGED: Founder now includes all owner-related values
          IF seniority_lower IN (
            'founder', 'co-founder', 'cofounder',
            'owner', 'co-owner', 'coowner', 'proprietor', 'partner', 'principal'
          ) THEN
            RETURN TRUE;
          END IF;
        ELSE
          NULL;
      END CASE;
    END LOOP;
    
    -- CRITICAL: Seniority field exists but didn't match any filter
    -- Do NOT fall through to title regex - seniority field is source of truth
    RETURN FALSE;
  END IF;
  
  -- FALLBACK: Only use title regex if seniority field is empty/null
  FOREACH seniority_value IN ARRAY p_seniority
  LOOP
    CASE lower(seniority_value)
      WHEN 'c-level' THEN
        IF title_lower ~ '(^|[^a-z])(ceo|cfo|cto|coo|cmo|cio|cpo|cro|chief)[^a-z]|^(ceo|cfo|cto|coo|cmo|cio|cpo|cro|chief)$' THEN
          RETURN TRUE;
        END IF;
      WHEN 'vp' THEN
        IF title_lower ~ '(^|[^a-z])(vp|vice president|v\.p\.)[^a-z]|^(vp|vice president|v\.p\.)$' THEN
          RETURN TRUE;
        END IF;
      WHEN 'director' THEN
        IF title_lower ~ '(^|[^a-z])director[^a-z]|^director$' THEN
          RETURN TRUE;
        END IF;
      WHEN 'manager' THEN
        IF title_lower ~ '(^|[^a-z])manager[^a-z]|^manager$' THEN
          RETURN TRUE;
        END IF;
      WHEN 'senior' THEN
        IF title_lower ~ '(^|[^a-z])(senior|sr\.?)[^a-z]|^(senior|sr\.?)$' THEN
          RETURN TRUE;
        END IF;
      WHEN 'entry' THEN
        IF title_lower ~ '(^|[^a-z])(junior|jr\.?|entry|intern|trainee|associate)[^a-z]|^(junior|jr\.?|entry|intern|trainee|associate)$' THEN
          RETURN TRUE;
        END IF;
      WHEN 'founder' THEN
        -- MERGED: Founder title regex now includes owner-related terms
        IF title_lower ~ '(^|[^a-z])(founder|co-founder|cofounder|owner|partner|principal|proprietor)[^a-z]|^(founder|co-founder|cofounder|owner|partner|principal|proprietor)$' THEN
          RETURN TRUE;
        END IF;
      ELSE
        NULL;
    END CASE;
  END LOOP;
  
  RETURN FALSE;
END;
$$;