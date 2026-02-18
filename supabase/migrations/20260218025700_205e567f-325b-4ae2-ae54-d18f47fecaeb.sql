
-- Fix audiences.created_by (NO ACTION → CASCADE)
ALTER TABLE public.audiences
  DROP CONSTRAINT IF EXISTS audiences_created_by_fkey;

ALTER TABLE public.audiences
  ADD CONSTRAINT audiences_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Fix unlock_events.user_id (NO ACTION → CASCADE)
ALTER TABLE public.unlock_events
  DROP CONSTRAINT IF EXISTS unlock_events_user_id_fkey;

ALTER TABLE public.unlock_events
  ADD CONSTRAINT unlock_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
