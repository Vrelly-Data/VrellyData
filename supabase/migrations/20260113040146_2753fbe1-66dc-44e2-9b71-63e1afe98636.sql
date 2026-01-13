-- Remove unused legacy search functions
-- Keep only the canonical search_free_data_builder function

-- Legacy v1 function (returns json)
DROP FUNCTION IF EXISTS public.search_free_data_with_filters(
  entity_type, text[], text[], text[], text[], text[], text[], text[], 
  text[], text[], text[], text[], boolean, boolean, boolean, boolean, 
  boolean, boolean, boolean, integer, integer
);

-- Legacy v2 function (entity_type enum parameter)
DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(
  entity_type, text[], text[], text[], text, text[], text[], text[], 
  text[], text[], text[], text[], text[], boolean, boolean, boolean, 
  boolean, boolean, boolean, text[], text[], text[], text[], text[], 
  text[], text[], boolean, boolean, boolean, boolean, integer, integer
);

-- Legacy v2 function (text parameter)
DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(
  text, text[], text[], text[], text, text[], text[], text[], text[], 
  text[], text[], text[], boolean, boolean, boolean, boolean, boolean, 
  integer, integer
);