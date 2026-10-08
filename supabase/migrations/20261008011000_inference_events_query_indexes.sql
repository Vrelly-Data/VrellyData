-- Indexes added directly on prod to fix an Admin → Inference statement timeout
-- (the tab filters inference_events by event_type, and by source + event_type,
-- paging by id). Recorded here so the repo matches prod; a no-op where they
-- already exist.
--
-- Guarded: inference_events only exists on prod (dev skips this, as
-- 20261006143000 does for Realtime).
do $$
begin
  if to_regclass('public.inference_events') is not null then
    create index if not exists idx_inference_event_type_id
      on public.inference_events using btree (event_type, id);
    create index if not exists idx_inference_source_event_type_id
      on public.inference_events using btree (source, event_type, id);
  end if;
end
$$;
