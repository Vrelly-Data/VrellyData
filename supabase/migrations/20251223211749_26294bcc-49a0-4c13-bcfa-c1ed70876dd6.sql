-- Fix the parse_employee_count_upper function to handle:
-- 1. Commas in numbers (e.g., "26,000" -> 26000)
-- 2. Spaces around dashes (e.g., "500 - 1000" -> 1000)
-- 3. "to" ranges with commas (e.g., "1,001 to 5,000" -> 5000)

CREATE OR REPLACE FUNCTION public.parse_employee_count_upper(size_str text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  clean_str text;
  upper_part text;
BEGIN
  IF size_str IS NULL OR size_str = '' THEN
    RETURN NULL;
  END IF;
  
  -- Remove commas from numbers first (e.g., "26,000" -> "26000")
  clean_str := REGEXP_REPLACE(size_str, ',', '', 'g');
  
  -- Trim whitespace
  clean_str := TRIM(clean_str);
  
  -- Handle "26 to 50" or "1001 to 5000" format → extract upper bound
  IF clean_str ~* '(\d+)\s+to\s+(\d+)' THEN
    upper_part := (REGEXP_MATCHES(clean_str, '(\d+)\s+to\s+(\d+)', 'i'))[2];
    RETURN CAST(upper_part AS INTEGER);
  END IF;
  
  -- Handle "51-200" or "500 - 1000" format (with optional spaces around dash) → extract upper bound
  IF clean_str ~ '(\d+)\s*-\s*(\d+)' THEN
    upper_part := (REGEXP_MATCHES(clean_str, '(\d+)\s*-\s*(\d+)'))[2];
    RETURN CAST(upper_part AS INTEGER);
  END IF;
  
  -- Handle "1000+" or "10000+" format → return the number
  IF clean_str ~ '(\d+)\+' THEN
    upper_part := (REGEXP_MATCHES(clean_str, '(\d+)\+'))[1];
    RETURN CAST(upper_part AS INTEGER);
  END IF;
  
  -- Single number fallback
  IF clean_str ~ '^(\d+)$' THEN
    RETURN CAST(clean_str AS INTEGER);
  END IF;
  
  -- Extract first number as last resort (handles "500 employees" etc)
  IF clean_str ~ '(\d+)' THEN
    RETURN CAST((REGEXP_MATCHES(clean_str, '(\d+)'))[1] AS INTEGER);
  END IF;
  
  RETURN NULL;
END;
$function$;