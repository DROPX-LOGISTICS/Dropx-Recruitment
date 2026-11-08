-- Compact, scoped counts for dependent queue filters. No candidate data leaves
-- Postgres, and a single JSON value avoids PostgREST's row limit on groups.
create or replace function public.recruitment_lead_facet_summary(
  p_company_id uuid,
  p_stream public.recruitment_stream,
  p_location_ids uuid[] default null,
  p_role_ids uuid[] default null,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with grouped as (
    select l.location_id, l.role_id,
      coalesce(nullif(l.status, ''), 'new') as status,
      l.final_status,
      (case when l.updated_at is null then 1 else 0 end
       + case when l.updated_at >= now() - interval '30 minutes' then 2 else 0 end
       + case when l.updated_at <= now() - interval '60 minutes' then 4 else 0 end
       + case when l.updated_at <= now() - interval '120 minutes' then 8 else 0 end
       + case when l.updated_at <= now() - interval '24 hours' then 16 else 0 end
       + case when l.updated_at <= now() - interval '48 hours' then 32 else 0 end) as age,
      count(*) as count
    from public.recruitment_leads l
    where l.company_id = p_company_id and l.stream = p_stream
      -- NULL means unrestricted; an empty scope deliberately matches nothing.
      and (p_location_ids is null or l.location_id = any(p_location_ids))
      and (p_role_ids is null or l.role_id = any(p_role_ids))
      and (p_filters->>'archive' = 'all' or l.archived = (coalesce(p_filters->>'archive', 'active') = 'archived'))
      and (not (p_filters ? 'adIds') or l.ad_id = any(string_to_array(p_filters->>'adIds', ',')::uuid[]))
      and (not (p_filters ? 'leadFrom') or l.lead_created_at >= (p_filters->>'leadFrom')::timestamptz)
      and (not (p_filters ? 'leadTo') or l.lead_created_at <= (p_filters->>'leadTo')::timestamptz)
      and (not (p_filters ? 'interviewFrom') or l.follow_up_at >= (p_filters->>'interviewFrom')::timestamptz)
      and (not (p_filters ? 'interviewTo') or l.follow_up_at <= (p_filters->>'interviewTo')::timestamptz)
      and (coalesce(p_filters->>'stale24', 'false') <> 'true' or
        (l.status in ('', 'new', 'no_response', 'call_back') and l.lead_created_at < now() - interval '24 hours'))
      and (coalesce(p_filters->>'unmapped', 'false') <> 'true' or l.location_id is null or l.role_id is null)
      and (p_stream <> 'hr' or coalesce(p_filters->>'menu', '') <> 'Interviews' or exists (
        select 1 from public.recruitment_hr_interviews i
        where i.company_id = p_company_id and i.lead_id = l.id and i.status <> 'cancelled'
      ))
      and (not (p_filters ? 'search') or
        l.full_name ilike '%' || (p_filters->>'search') || '%' or
        l.phone ilike '%' || (p_filters->>'search') || '%' or
        l.email ilike '%' || (p_filters->>'search') || '%' or
        l.city ilike '%' || (p_filters->>'search') || '%' or
        l.post_code ilike '%' || (p_filters->>'search') || '%' or
        l.ad_name ilike '%' || (p_filters->>'search') || '%')
    group by l.location_id, l.role_id, coalesce(nullif(l.status, ''), 'new'), l.final_status, age
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'locationCode', loc.code, 'roleCode', role.code, 'status', g.status,
    'finalStatus', g.final_status, 'age', g.age, 'count', g.count
  )), '[]'::jsonb)
  from grouped g
  left join public.recruitment_locations loc on loc.id = g.location_id and loc.company_id = p_company_id
  left join public.recruitment_roles role on role.id = g.role_id and role.company_id = p_company_id;
$$;
-- The server authorizes menu/workspace access and supplies the effective scope.
revoke all on function public.recruitment_lead_facet_summary(uuid, public.recruitment_stream, uuid[], uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.recruitment_lead_facet_summary(uuid, public.recruitment_stream, uuid[], uuid[], jsonb) to service_role;
