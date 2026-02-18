ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS cancel_at timestamp with time zone;