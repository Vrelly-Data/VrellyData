-- Link saved_audiences to filter_presets for dual-write
ALTER TABLE public.saved_audiences
  ADD COLUMN preset_id UUID REFERENCES public.filter_presets(id) ON DELETE SET NULL;
