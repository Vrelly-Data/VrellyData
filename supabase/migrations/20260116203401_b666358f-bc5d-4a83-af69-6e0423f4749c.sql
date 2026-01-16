-- Drop ONLY the broken duplicate function (text parameter type, wrong order)
-- This keeps the original stable function with entity_type parameter
DROP FUNCTION IF EXISTS public.search_free_data_builder(
  text, text[], text[], text[], text[], text[],
  text[], text[], text[], text[], text[], text[],
  text[], text[], text[], text[],
  boolean, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean,
  integer, integer
);