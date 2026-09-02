-- Inference Moat v1 — fix ON CONFLICT target for inference_events
-- Replace the partial unique index with a true UNIQUE CONSTRAINT so PostgREST
-- can target (source, source_row_id, event_type) in ON CONFLICT.
-- ADDITIVE and idempotent: safe when run on databases where either the index
-- or the constraint (or neither) already exists.

DO $$
BEGIN
  -- Drop the legacy partial unique index if it exists
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_inference_source_row_event_unique'
  ) THEN
    EXECUTE 'DROP INDEX public.idx_inference_source_row_event_unique';
  END IF;

  -- Create a real unique constraint if it does not already exist
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conname = 'inference_events_source_row_event_key'
      AND c.conrelid = 'public.inference_events'::regclass
  ) THEN
    EXECUTE '
      ALTER TABLE public.inference_events
      ADD CONSTRAINT inference_events_source_row_event_key
      UNIQUE (source, source_row_id, event_type)
    ';
  END IF;
END
$$;

