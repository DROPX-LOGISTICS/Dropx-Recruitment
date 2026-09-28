-- Include existing station mailboxes, without inventing identities or expanding scope.
create or replace function public.recruitment_ad_mail_people(p_company uuid)
returns table(id uuid,name text,email text,mobile text,role text,station_ids uuid[])
language sql stable security invoker set search_path='' as $$
 with staff as (
 select distinct p.id,p.full_name::text as name,p.email::text as email,
 coalesce(nullif(p.mobile,''),nullif(p.phone,''),e.mobile,c.mobile)::text as mobile,
 d.code::text as role,coalesce(p.location_scope_ids,'{}'::uuid[]) as station_ids
 from public.profiles p
 left join public.employees e on e.company_id=p.company_id and e.employee_code=p.employee_id and e.deleted_at is null and e.is_active
 left join public.contractors c on c.company_id=p.company_id and c.dropx_id=p.employee_id and c.deleted_at is null and c.is_active
 join public.designations d on d.company_id=p.company_id and d.is_active and
 (d.id=e.designation_id or d.id::text=c.designation or d.code=c.designation or d.name=c.designation)
 where p.company_id=p_company and p.is_active and p.email is not null
 and d.code in ('CLM','AOM','HLM','NH','RM','CM','STM','SIC','TL','ATL','SM','SRSM','PGM','WFA','BH')
 ) select * from staff
 union all
 select p.id,p.full_name::text,p.email::text,coalesce(p.mobile,p.phone)::text,'LOCATION'::text,array_agg(distinct s.id)
 from public.profiles p join public.stations s on s.company_id=p.company_id and s.is_active
 and not coalesce(s.hide_from_location_list,false) and s.id=any(p.location_scope_ids)
 and lower(p.email) in (lower(s.station_email),lower(s.station_manager_email))
 where p.company_id=p_company and p.is_active and not exists(select 1 from staff where staff.id=p.id)
 group by p.id,p.full_name,p.email,p.mobile,p.phone;
$$;
revoke all on function public.recruitment_ad_mail_people(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_ad_mail_people(uuid) to service_role;
