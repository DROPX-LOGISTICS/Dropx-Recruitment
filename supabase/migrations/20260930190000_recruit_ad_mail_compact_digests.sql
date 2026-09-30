-- Replace per-change mail with a compact morning status and one evening activity digest.
-- Existing sent mail remains auditable; queued legacy event messages must not be delivered.
alter table public.recruitment_ad_mail_snapshots
  add column if not exists budget_amount numeric,
  add column if not exists budget_kind text;

create table if not exists public.recruitment_ad_mail_activity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  ad_id uuid not null references public.recruitment_ads(id),
  station_id uuid not null references public.stations(id),
  station text not null,
  ad_name text not null,
  role text not null,
  occurred_at timestamptz not null default now(),
  previous_status text,
  current_status text not null,
  previous_budget numeric,
  current_budget numeric,
  budget_kind text,
  version integer not null,
  unique(company_id, ad_id, version)
);

create index if not exists recruitment_ad_mail_activity_company_time_idx
  on public.recruitment_ad_mail_activity(company_id, occurred_at desc);

alter table public.recruitment_ad_mail_activity enable row level security;
revoke all on public.recruitment_ad_mail_activity from public, anon, authenticated;
grant all on public.recruitment_ad_mail_activity to service_role;

-- Each mapped person is a direct recipient. Workforce contacts and Business Heads
-- therefore receive one complete station-scoped digest of their own, never a CC copy.
create or replace function public.recruitment_ad_mail_people(p_company uuid)
returns table(id uuid,name text,email text,mobile text,role text,station_ids uuid[])
language sql stable security invoker set search_path='' as $$
  with staff as (
    select distinct p.id,p.full_name::text as name,p.email::text as email,
      coalesce(nullif(p.mobile,''),nullif(p.phone,''),e.mobile,c.mobile)::text as mobile,
      d.code::text as role,coalesce(p.location_scope_ids,'{}'::uuid[]) as station_ids,
      2 as priority
    from public.profiles p
    left join public.employees e on e.company_id=p.company_id and e.employee_code=p.employee_id and e.deleted_at is null and e.is_active
    left join public.contractors c on c.company_id=p.company_id and c.dropx_id=p.employee_id and c.deleted_at is null and c.is_active
    join public.designations d on d.company_id=p.company_id and d.is_active and
      (d.id=e.designation_id or d.id::text=c.designation or d.code=c.designation or d.name=c.designation)
    where p.company_id=p_company and p.is_active and p.email is not null
      and d.code in ('CLM','AOM','HLM','NH','RM','CM','STM','SIC','TL','ATL','SM','SRSM','PGM','WFA','BH')
  ), station_mailboxes as (
    select p.id,p.full_name::text as name,p.email::text as email,coalesce(p.mobile,p.phone)::text as mobile,
      'LOCATION'::text as role,array_agg(distinct s.id) as station_ids,1 as priority
    from public.profiles p
    join public.stations s on s.company_id=p.company_id and s.is_active
      and not coalesce(s.hide_from_location_list,false) and s.id=any(p.location_scope_ids)
      and lower(p.email) in (lower(s.station_email),lower(s.station_manager_email))
    where p.company_id=p_company and p.is_active and p.email is not null
    group by p.id,p.full_name,p.email,p.mobile,p.phone
  ), owners as (
    select p.id,p.full_name::text as name,p.email::text as email,coalesce(p.mobile,p.phone)::text as mobile,
      'OWNER'::text as role,coalesce(array_agg(distinct s.id) filter (where s.id is not null),'{}'::uuid[]) as station_ids,3 as priority
    from public.profiles p
    left join public.stations s on s.company_id=p.company_id and s.is_active
    where p.company_id=p_company and p.is_active and p.is_master_owner and p.email is not null
    group by p.id,p.full_name,p.email,p.mobile,p.phone
  ), audience as (
    select * from staff
    union all select * from station_mailboxes
    union all select * from owners
  ), preferred as (
    select distinct on (id) id,name,email,mobile,role,priority
    from audience
    order by id,priority desc
  ), merged_scopes as (
    select a.id,array_agg(distinct scope.station_id) as station_ids
    from audience a
    cross join lateral unnest(a.station_ids) as scope(station_id)
    group by a.id
  )
  select p.id,p.name,p.email,p.mobile,p.role,coalesce(m.station_ids,'{}'::uuid[]) as station_ids
  from preferred p
  left join merged_scopes m on m.id=p.id;
$$;

revoke all on function public.recruitment_ad_mail_people(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_ad_mail_people(uuid) to service_role;

update public.recruitment_ad_mail_deliveries
set status='cancelled',
    error='Superseded by the scheduled 20:00 IST compact activity digest.'
where kind='event' and status='queued';
