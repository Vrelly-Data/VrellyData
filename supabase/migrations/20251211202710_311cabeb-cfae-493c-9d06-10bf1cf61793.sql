-- Create function for keyword search across JSONB fields
CREATE OR REPLACE FUNCTION search_free_data_keywords(
  p_entity_type entity_type,
  p_keywords text[],
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  entity_type entity_type,
  entity_external_id text,
  entity_data jsonb,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (
      array_length(p_keywords, 1) IS NULL 
      OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) AS k
        WHERE 
          (fd.entity_data->>'description') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'company') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'name') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'title') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyDescription') ILIKE '%' || k || '%'
      )
    );

  RETURN QUERY
  SELECT fd.id, fd.entity_type, fd.entity_external_id, fd.entity_data, fd.created_at, v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (
      array_length(p_keywords, 1) IS NULL 
      OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) AS k
        WHERE 
          (fd.entity_data->>'description') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'company') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'name') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'title') ILIKE '%' || k || '%' OR
          (fd.entity_data->>'companyDescription') ILIKE '%' || k || '%'
      )
    )
  ORDER BY fd.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;