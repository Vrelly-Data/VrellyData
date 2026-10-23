-- Admin → Signals → Source health was empty: signals_admin_source_stats()
-- (20261012120100) is SECURITY INVOKER and counts public.signals, which
-- `authenticated` can no longer read directly since #115 (signals are read
-- through RPCs only). Every call from the app failed with "permission denied
-- for table signals". It already refuses non-admins (signals_is_admin), so it
-- now runs as its owner like the other signals_admin_* functions.

alter function public.signals_admin_source_stats() security definer;
alter function public.signals_admin_source_stats() set statement_timeout = '15s';
