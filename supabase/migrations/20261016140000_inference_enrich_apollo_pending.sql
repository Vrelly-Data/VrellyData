-- enrich-inference-events: rows waiting for Apollo stay in the queue at any age.
--
-- When the daily Apollo cap (or Apollo's credits) runs out, the function no
-- longer finishes the rows that still need Apollo: it marks them
-- metadata.apollo_pending = true with enrichment_next_at = the next UTC
-- midnight. The queue (20261014200000) only took un-enriched rows from the last
-- p_days, so a waiting row could age out, and a re-queued row that already has
-- enriched_at would never be picked. It now also takes apollo_pending rows,
-- whatever their age or enriched_at. Order is unchanged: interested, other, not
-- interested; replies before classifications; newest first.

create or replace function public.inference_enrich_queue(p_limit integer default 200, p_days integer default 30, p_ids uuid[] default null)
returns table (
  id uuid, team_id uuid, source text, event_type text, channel text, person_key text, email text, linkedin_url text,
  full_name text, company_name text, job_title text, seniority text, department text, industry text, city text,
  state text, country text, company_size text, campaign_external_id text, campaign_name text, subject text,
  copy_fingerprint text, occurred_at timestamptz, metadata jsonb, intent text, priority integer
)
language sql stable security definer set search_path = public
set statement_timeout = '30s'
as $$
  select e.id, e.team_id, e.source, e.event_type, e.channel, e.person_key, e.email, e.linkedin_url, e.full_name,
         e.company_name, e.job_title, e.seniority, e.department, e.industry, e.city, e.state, e.country, e.company_size,
         e.campaign_external_id, e.campaign_name, e.subject, e.copy_fingerprint, e.occurred_at, e.metadata,
         coalesce(e.intent, ci.intent) as intent,
         case coalesce(e.intent, ci.intent) when 'interested' then 0 when 'not_interested' then 2 else 1 end as priority
    from public.inference_events e
    left join lateral (
      select c.intent from public.inference_events c
       where e.event_type = 'replied' and c.event_type = 'classified' and c.person_key = e.person_key
         and c.team_id is not distinct from e.team_id and c.intent is not null
       order by c.occurred_at desc limit 1
    ) ci on true
   where e.event_type in ('replied', 'classified')
     and e.source not like '%_backfill'
     and coalesce(e.metadata ->> 'backfill', '') <> 'true'
     and (
       (p_ids is not null and e.id = any(p_ids))
       or (p_ids is null
           and (((e.metadata ->> 'enriched_at') is null
                 and e.occurred_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1)))
                or (e.metadata ->> 'apollo_pending') = 'true')
           and coalesce(e.metadata ->> 'enrichment_status', '') <> 'failed'
           and coalesce((e.metadata ->> 'enrichment_next_at')::timestamptz, '-infinity') <= now())
     )
   order by priority, (e.event_type = 'replied') desc, e.occurred_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

revoke all on function public.inference_enrich_queue(integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.inference_enrich_queue(integer, integer, uuid[]) to service_role;
