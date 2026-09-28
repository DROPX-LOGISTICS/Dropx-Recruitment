-- Private delivery ledger: browser users cannot read recipients or email tokens.
create table public.recruitment_ad_mail_settings (
 company_id uuid primary key references public.companies(id),
 enabled boolean not null default false,
 baselined_at timestamptz,
 lease_until timestamptz,
 updated_at timestamptz not null default now()
);
create table public.recruitment_ad_mail_snapshots (
 company_id uuid not null references public.companies(id),
 ad_id uuid not null references public.recruitment_ads(id),
 status text not null,
 version integer not null default 1,
 primary key(company_id,ad_id)
);
create table public.recruitment_ad_mail_deliveries (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 dedupe_key text not null,
 kind text not null check(kind in ('daily','event','sample')),
 recipient_id uuid not null references public.profiles(id),
 payload jsonb not null,
 thread_key text not null,
 message_id text not null,
 status text not null default 'queued' check(status in ('queued','sending','sent','failed','needs_review','cancelled')),
 attempts integer not null default 0,
 error text,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(company_id,dedupe_key)
);
create index recruitment_ad_mail_queue on public.recruitment_ad_mail_deliveries(company_id,status,created_at);
create index recruitment_ad_mail_thread on public.recruitment_ad_mail_deliveries(company_id,thread_key,sent_at) where status='sent';
alter table public.recruitment_ad_mail_settings enable row level security;
alter table public.recruitment_ad_mail_snapshots enable row level security;
alter table public.recruitment_ad_mail_deliveries enable row level security;
revoke all on public.recruitment_ad_mail_settings, public.recruitment_ad_mail_snapshots, public.recruitment_ad_mail_deliveries from public,anon,authenticated;
grant all on public.recruitment_ad_mail_settings, public.recruitment_ad_mail_snapshots, public.recruitment_ad_mail_deliveries to service_role;

create function public.recruitment_ad_mail_lock(p_company uuid) returns boolean
language sql security invoker set search_path='' as $$
 with claimed as (
 update public.recruitment_ad_mail_settings set lease_until=now()+interval '6 minutes'
 where company_id=p_company and enabled and (lease_until is null or lease_until<now()) returning company_id
 ) select exists(select 1 from claimed);
$$;
revoke all on function public.recruitment_ad_mail_lock(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_ad_mail_lock(uuid) to service_role;

-- Resolve current People designation, not historical profiles.role enum values.
create function public.recruitment_ad_mail_people(p_company uuid)
returns table(id uuid,name text,email text,mobile text,role text,station_ids uuid[])
language sql stable security invoker set search_path='' as $$
 select distinct p.id,p.full_name::text,p.email::text,
 coalesce(nullif(p.mobile,''),nullif(p.phone,''),e.mobile,c.mobile)::text,
 d.code::text,coalesce(p.location_scope_ids,'{}'::uuid[])
 from public.profiles p
 left join public.employees e on e.company_id=p.company_id and e.employee_code=p.employee_id and e.deleted_at is null and e.is_active
 left join public.contractors c on c.company_id=p.company_id and c.dropx_id=p.employee_id and c.deleted_at is null and c.is_active
 join public.designations d on d.company_id=p.company_id and d.is_active and
 (d.id=e.designation_id or d.id::text=c.designation or d.code=c.designation or d.name=c.designation)
 where p.company_id=p_company and p.is_active and p.email is not null
 and d.code in ('CLM','AOM','HLM','NH','RM','CM','STM','SIC','TL','ATL','SM','SRSM','PGM','WFA','BH');
$$;
revoke all on function public.recruitment_ad_mail_people(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_ad_mail_people(uuid) to service_role;

-- A signed email action is a request only; unique source prevents double submit.
create unique index recruitment_ad_requests_mail_source on public.recruitment_ad_requests
 (company_id,(raw_payload->>'mailSource')) where raw_payload->>'mailSource' is not null;
