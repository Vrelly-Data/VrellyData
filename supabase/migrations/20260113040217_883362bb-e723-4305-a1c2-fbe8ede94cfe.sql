-- Drop remaining legacy v2 function (19-parameter version with text first parameter)
DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(
  text, text[], text[], text[], text, text[], text[], text[], text[], 
  text[], text[], text[], text[], boolean, boolean, boolean, boolean, 
  boolean, integer, integer
);