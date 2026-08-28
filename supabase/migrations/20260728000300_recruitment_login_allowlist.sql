begin;

create table if not exists public.recruitment_login_allowlist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text,
  mobile_e164 text,
  display_name text,
  access_template text not null default 'viewer'
    check (access_template in ('owner','admin','hr','workforce','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or mobile_e164 is not null)
);
create unique index if not exists recruitment_login_allowlist_email_uidx
  on public.recruitment_login_allowlist(company_id, lower(email))
  where email is not null;
create unique index if not exists recruitment_login_allowlist_mobile_uidx
  on public.recruitment_login_allowlist(company_id, mobile_e164)
  where mobile_e164 is not null;

alter table public.recruitment_login_allowlist enable row level security;
revoke all on public.recruitment_login_allowlist from anon, authenticated;

with company as (
  select id from public.companies where code='DROPX_LOGISTICS'
), allowed(email, display_name, access_template) as (
  values
    ('jamsheer@dropxlogistics.com','MUHAMMED JAMSHEER','owner'),
    ('jamsheerpp33@gmail.com','MUHAMMED JAMSHEER','admin'),
    ('nisar@dropxlogistics.com','NISAR AHAMMED','owner'),
    ('suja@dropxlogistics.com','SUJA SOORYA CHANDRAN','admin'),
    ('shifa.dropx@gmail.com','SHIFA','admin'),
    ('shaheen.dropx@gmail.com','SHAHEEN','admin')
)
insert into public.recruitment_login_allowlist(company_id,email,display_name,access_template)
select company.id, allowed.email, allowed.display_name, allowed.access_template
from company cross join allowed
on conflict(company_id, lower(email)) where email is not null do update set
  display_name=excluded.display_name,
  access_template=excluded.access_template,
  is_active=true,
  updated_at=now();

insert into public.recruitment_mobile_users(company_id,profile_id,mobile_e164,display_name)
select profile.company_id, profile.id, '91' || regexp_replace(coalesce(nullif(profile.mobile,''),profile.phone), '\D', '', 'g'), profile.full_name
from public.profiles profile
join public.companies company on company.id=profile.company_id and company.code='DROPX_LOGISTICS'
where lower(profile.email) in ('jamsheer@dropxlogistics.com','nisar@dropxlogistics.com','suja@dropxlogistics.com')
  and length(regexp_replace(coalesce(nullif(profile.mobile,''),profile.phone), '\D', '', 'g'))=10
on conflict(company_id,mobile_e164) do update set
  profile_id=excluded.profile_id,
  display_name=excluded.display_name,
  is_active=true,
  updated_at=now();

commit;
