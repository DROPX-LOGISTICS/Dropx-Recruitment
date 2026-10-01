-- Private twice-daily DA In-App onboarding digest settings and delivery ledger.
-- Recipients are resolved at send time from the current People/station mappings.
create table if not exists public.recruitment_da_onboarding_mail_settings (
  company_id uuid primary key references public.companies(id),
  enabled boolean not null default false,
  afternoon_time time not null default '15:00',
  evening_time time not null default '19:00',
  time_zone text not null default 'Asia/Kolkata',
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.recruitment_da_onboarding_mail_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  dedupe_key text not null,
  recipient_id uuid not null references public.profiles(id),
  recipient_role text not null,
  slot text not null check (slot in ('afternoon','evening','sample')),
  payload jsonb not null,
  thread_key text not null,
  message_id text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','needs_review','cancelled')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(company_id, dedupe_key)
);

create index if not exists recruitment_da_onboarding_mail_queue_idx
  on public.recruitment_da_onboarding_mail_deliveries(company_id, status, created_at);
create index if not exists recruitment_da_onboarding_mail_thread_idx
  on public.recruitment_da_onboarding_mail_deliveries(company_id, thread_key, sent_at)
  where status = 'sent';
create index if not exists recruitment_da_onboarding_mail_recipient_idx
  on public.recruitment_da_onboarding_mail_deliveries(company_id, recipient_id, created_at desc);

alter table public.recruitment_da_onboarding_mail_settings enable row level security;
alter table public.recruitment_da_onboarding_mail_deliveries enable row level security;
revoke all on public.recruitment_da_onboarding_mail_settings,
  public.recruitment_da_onboarding_mail_deliveries from public, anon, authenticated;
grant all on public.recruitment_da_onboarding_mail_settings,
  public.recruitment_da_onboarding_mail_deliveries to service_role;

create or replace function public.recruitment_da_onboarding_mail_lock(p_company uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with claimed as (
    update public.recruitment_da_onboarding_mail_settings
       set lease_until = now() + interval '6 minutes',
           updated_at = now()
     where company_id = p_company
       and enabled
       and (lease_until is null or lease_until < now())
     returning company_id
  )
  select exists(select 1 from claimed);
$$;

revoke all on function public.recruitment_da_onboarding_mail_lock(uuid) from public, anon, authenticated;
grant execute on function public.recruitment_da_onboarding_mail_lock(uuid) to service_role;

-- The existing Recruit manager-mail switch identifies the currently configured
-- company. Enable this newly requested digest only for that same live company.
insert into public.recruitment_da_onboarding_mail_settings(company_id, enabled)
select company_id, true
from public.recruitment_ad_mail_settings
where enabled
on conflict (company_id) do nothing;
