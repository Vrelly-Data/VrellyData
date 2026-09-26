-- Expand inference_events.event_type to include LinkedIn connection accepts.
-- Safe on re-run: drops any existing event_type CHECK constraint (by probing pg_constraint)
-- and recreates it with the expanded allowed set.

DO $mig$
DECLARE
  conname text;
BEGIN
  SELECT pc.conname
    INTO conname
  FROM pg_constraint pc
  JOIN pg_class     cls ON cls.oid = pc.conrelid
  JOIN pg_namespace nsp ON nsp.oid = pc.connamespace
  WHERE nsp.nspname = 'public'
    AND cls.relname = 'inference_events'
    AND pc.contype = 'c'
    AND pc.conname ILIKE '%event_type%';

  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.inference_events DROP CONSTRAINT %I', conname);
  END IF;

  ALTER TABLE public.inference_events
    ADD CONSTRAINT inference_events_event_type_check
    CHECK (event_type IN (
      'sent','opened','replied','bounced','opted_out','meeting_booked',
      'closed_won','closed_lost','classified',
      'connection_accepted'
    ));
END
$mig$;

COMMENT ON CONSTRAINT inference_events_event_type_check ON public.inference_events IS
  'Allowed event types incl. connection_accepted (LinkedIn connects accepted).';

