-- Service-only aggregation. The authenticated API supplies its existing scope.
create or replace function public.recruitment_dashboard_rollups(
  p_company_id uuid, p_stream text,
  p_scope_location_ids uuid[] default null, p_scope_role_ids uuid[] default null,
  p_filter_location_ids uuid[] default null, p_filter_role_ids uuid[] default null,
  p_now timestamptz default now()
) returns jsonb language sql stable security invoker set search_path = public as $$
with scoped as materialized (
  select l.id,l.full_name,l.phone,l.location_id,l.role_id,l.ad_id,l.assigned_profile_id,
    l.lead_created_at,l.updated_at,l.callback_at,l.follow_up_at,
    lower(coalesce(status,'')) s,lower(coalesce(final_status,'')) fs,
    (p_now at time zone 'Asia/Kolkata')::date at time zone 'Asia/Kolkata' day_start
  from public.recruitment_leads l
  where company_id=p_company_id and not archived
    and (p_stream is null or stream::text=p_stream)
    and (p_scope_location_ids is null or location_id=any(p_scope_location_ids))
    and (p_scope_role_ids is null or role_id=any(p_scope_role_ids))
    and (p_filter_location_ids is null or location_id=any(p_filter_location_ids))
    and (p_filter_role_ids is null or role_id=any(p_filter_role_ids))
), grouped as (
 select location_id,role_id,ad_id,s,
   count(*) total,
   count(*) filter(where s in ('','new')) no_status,
   count(*) filter(where s='no_response') no_response,
   count(*) filter(where s='call_back') call_back,
   count(*) filter(where left(s,10)='interview_') interviews,
   count(*) filter(where s='joined' or fs='joined') joined,
   count(*) filter(where s in ('','new','no_response','call_back')) pending,
   count(*) filter(where s in ('','new','no_response','call_back') and lead_created_at<=p_now-interval '24 hours') stale,
   count(*) filter(where s in ('','new') and lead_created_at<=p_now-interval '12 hours') no_status_12h,
   count(*) filter(where s in ('','new') and lead_created_at<=p_now-interval '24 hours') no_status_24h,
   count(*) filter(where s in ('','new') and lead_created_at<=p_now-interval '48 hours') no_status_48h,
   count(*) filter(where s='no_response' and updated_at<=p_now-interval '5 minutes') retry_due,
   count(*) filter(where s='call_back' and callback_at<=p_now) callback_due,
   count(*) filter(where left(s,10)='interview_' and follow_up_at>=day_start and follow_up_at<day_start+interval '1 day') interviews_today,
   count(*) filter(where s in ('','new') and assigned_profile_id is null) unassigned,
   count(*) filter(where updated_at>=day_start and updated_at<day_start+interval '1 day') updated_today,
   coalesce(sum(floor(extract(epoch from (updated_at-lead_created_at))/60+0.5)) filter(where s not in ('','new') and updated_at>=lead_created_at),0) response_minutes,
   count(*) filter(where s not in ('','new') and updated_at>=lead_created_at) response_count
 from scoped group by location_id,role_id,ad_id,s
), groups as (
 select g.*,case when loc.id is null then null else jsonb_build_object('code',loc.code,'name',loc.name,'poc_name',loc.poc_name,'poc_mobile',loc.poc_mobile) end recruitment_locations,
 case when r.id is null then null else jsonb_build_object('code',r.code,'name',r.name,'stream',r.stream) end recruitment_roles
 from grouped g left join public.recruitment_locations loc on loc.id=g.location_id
 left join public.recruitment_roles r on r.id=g.role_id
), attention as (
 select id,coalesce(nullif(full_name,''),'Unnamed') name,phone,
 case when s in ('','new') and lead_created_at<=p_now-interval '48 hours' then 'No status 48h+'
      when s='call_back' and callback_at<=p_now then 'Call Back due'
      else 'No Response retry due' end issue,
 case when s in ('','new') and lead_created_at<=p_now-interval '48 hours' then 100
      when s='call_back' and callback_at<=p_now then 80 else 60 end priority
 from scoped where (s in ('','new') and lead_created_at<=p_now-interval '48 hours')
    or (s='call_back' and callback_at<=p_now)
    or (s='no_response' and updated_at<=p_now-interval '1 hour')
 order by lead_created_at desc,id desc limit 120
)
select jsonb_build_object('groups',coalesce((select jsonb_agg(to_jsonb(g)) from groups g),'[]'::jsonb),
 'attention',coalesce((select jsonb_agg(to_jsonb(a)) from attention a),'[]'::jsonb));
$$;
revoke all on function public.recruitment_dashboard_rollups(uuid,text,uuid[],uuid[],uuid[],uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.recruitment_dashboard_rollups(uuid,text,uuid[],uuid[],uuid[],uuid[],timestamptz) to service_role;
