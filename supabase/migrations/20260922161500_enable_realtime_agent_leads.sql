-- Enable realtime for the agent_leads table.
-- Idempotent: only adds the table to the supabase_realtime publication
-- when it's not already present, and skips cleanly if the publication
-- itself is missing (older/local environments).
do
$$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'agent_leads'
    ) then
      execute 'alter publication supabase_realtime add table public.agent_leads';
    end if;
  else
    -- Publication not present (non-Supabase Postgres or misconfigured env) — skip.
    perform 1;
  end if;
end
$$;

