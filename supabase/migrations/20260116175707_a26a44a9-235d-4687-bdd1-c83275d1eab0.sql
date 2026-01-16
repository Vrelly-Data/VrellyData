-- Fix: Update President regex to exclude "Vice President" titles
-- This uses CREATE OR REPLACE to update the existing function in-place (no duplicates)

CREATE OR REPLACE FUNCTION public.title_matches_seniority(
  p_title TEXT,
  p_seniority TEXT[],
  p_seniority_field TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  seniority_value TEXT;
  seniority_lower TEXT;
  title_lower TEXT;
BEGIN
  -- If no seniority filters provided, return true (no filtering)
  IF p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Normalize inputs
  title_lower := LOWER(COALESCE(p_title, ''));
  seniority_lower := LOWER(COALESCE(p_seniority_field, ''));

  -- Check each seniority value
  FOREACH seniority_value IN ARRAY p_seniority
  LOOP
    -- First priority: Check the seniority field if populated
    IF seniority_lower != '' THEN
      CASE LOWER(seniority_value)
        WHEN 'c-level' THEN
          IF seniority_lower IN ('c-level', 'c-suite', 'clevel', 'csuite', 'c level', 'c suite', 'executive', 'chief') THEN
            RETURN TRUE;
          END IF;
        WHEN 'vice president' THEN
          IF seniority_lower IN ('vice president', 'vp', 'vice-president', 'v.p.', 'v.p', 'evp', 'svp', 'executive vice president', 'senior vice president') THEN
            RETURN TRUE;
          END IF;
        WHEN 'president' THEN
          IF seniority_lower IN ('president', 'ceo', 'chief executive') THEN
            RETURN TRUE;
          END IF;
        WHEN 'director' THEN
          IF seniority_lower IN ('director', 'senior director', 'associate director', 'assistant director', 'executive director', 'managing director', 'group director') THEN
            RETURN TRUE;
          END IF;
        WHEN 'head of' THEN
          IF seniority_lower IN ('head of', 'head', 'department head', 'division head', 'team head', 'global head', 'regional head') THEN
            RETURN TRUE;
          END IF;
        WHEN 'manager' THEN
          IF seniority_lower IN ('manager', 'senior manager', 'associate manager', 'assistant manager', 'general manager', 'project manager', 'product manager', 'program manager', 'account manager', 'sales manager', 'marketing manager', 'operations manager', 'regional manager', 'district manager', 'area manager', 'branch manager', 'team manager', 'department manager', 'group manager', 'division manager', 'unit manager', 'section manager') THEN
            RETURN TRUE;
          END IF;
        WHEN 'senior' THEN
          IF seniority_lower IN ('senior', 'sr', 'sr.', 'lead', 'principal', 'staff', 'senior specialist', 'senior analyst', 'senior consultant', 'senior advisor', 'senior associate', 'senior engineer', 'senior developer', 'senior designer') THEN
            RETURN TRUE;
          END IF;
        WHEN 'individual contributor' THEN
          IF seniority_lower IN ('individual contributor', 'ic', 'i.c.', 'i.c', 'contributor', 'associate', 'analyst', 'specialist', 'coordinator', 'representative', 'assistant', 'administrator', 'executive', 'officer', 'clerk', 'agent', 'technician', 'consultant', 'advisor', 'engineer', 'developer', 'designer', 'writer', 'editor', 'researcher', 'scientist', 'professional') THEN
            RETURN TRUE;
          END IF;
        ELSE
          -- For any other seniority value, do exact match
          IF seniority_lower = LOWER(seniority_value) THEN
            RETURN TRUE;
          END IF;
      END CASE;
    END IF;
    
    -- Second priority: Fall back to title-based matching
    IF title_lower != '' THEN
      CASE LOWER(seniority_value)
        WHEN 'c-level' THEN
          -- Match Chief X Officer patterns, CEO, CFO, CTO, etc.
          IF title_lower ~ '(^|[^a-z])(chief|ceo|cfo|cto|coo|cio|cmo|cpo|cro|chro|cso|cdo|cao|cbo|cco|cgo|cho|cko|clo|cno|cqo|cvo|cwo|cxo|czo)([^a-z]|$)' THEN
            RETURN TRUE;
          END IF;
        WHEN 'vice president' THEN
          -- Match VP, Vice President, EVP, SVP patterns
          IF title_lower ~ '(^|[^a-z])(vp|v\.p\.|vice[- ]?president|evp|svp|avp|executive vice president|senior vice president|assistant vice president|associate vice president|group vice president|regional vice president|divisional vice president)([^a-z]|$)' THEN
            RETURN TRUE;
          END IF;
        WHEN 'president' THEN
          -- FIX: Match President but EXCLUDE Vice President
          IF title_lower ~ '(^|[^a-z])president([^a-z]|$)' AND title_lower !~ '(^|[^a-z])vice[- ]?president' THEN
            RETURN TRUE;
          END IF;
        WHEN 'director' THEN
          -- Match Director patterns
          IF title_lower ~ '(^|[^a-z])director([^a-z]|$)' THEN
            RETURN TRUE;
          END IF;
        WHEN 'head of' THEN
          -- Match "Head of X" patterns
          IF title_lower ~ '(^|[^a-z])head of([^a-z]|$)' OR title_lower ~ '(^|[^a-z])department head([^a-z]|$)' OR title_lower ~ '(^|[^a-z])division head([^a-z]|$)' OR title_lower ~ '(^|[^a-z])team head([^a-z]|$)' OR title_lower ~ '(^|[^a-z])global head([^a-z]|$)' OR title_lower ~ '(^|[^a-z])regional head([^a-z]|$)' THEN
            RETURN TRUE;
          END IF;
        WHEN 'manager' THEN
          -- Match Manager patterns
          IF title_lower ~ '(^|[^a-z])manager([^a-z]|$)' THEN
            RETURN TRUE;
          END IF;
        WHEN 'senior' THEN
          -- Match Senior, Lead, Principal, Staff patterns
          IF title_lower ~ '(^|[^a-z])(senior|sr\.?|lead|principal|staff)([^a-z]|$)' THEN
            RETURN TRUE;
          END IF;
        WHEN 'individual contributor' THEN
          -- For IC, match common non-management titles or if nothing else matched
          IF title_lower ~ '(^|[^a-z])(analyst|specialist|coordinator|representative|associate|assistant|engineer|developer|designer|consultant|advisor|administrator|technician|officer|clerk|agent|writer|editor|researcher|scientist)([^a-z]|$)' THEN
            RETURN TRUE;
          END IF;
        ELSE
          NULL;
      END CASE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;