-- Hotfix: Add title_matches_seniority overload with signature (text[], text, text)
-- This restores compatibility with search_free_data_builder which calls:
-- title_matches_seniority(ARRAY[sl], entity_data->>'seniority', COALESCE(entity_data->>'jobTitle',''))

CREATE OR REPLACE FUNCTION public.title_matches_seniority(
  p_seniority text[],
  p_seniority_field text,
  p_title text
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Delegate to the existing function by reordering arguments
  RETURN public.title_matches_seniority(p_title, p_seniority, p_seniority_field);
END;
$$;