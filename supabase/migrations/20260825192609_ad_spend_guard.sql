create table if not exists public.recruitment_ad_guard_policies (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  stream public.recruitment_stream, location_id uuid references public.recruitment_locations(id) on delete cascade,
  role_id uuid references public.recruitment_roles(id) on delete cascade, enabled boolean not null default true,
  review_interval_minutes integer not null default 60 check (review_interval_minutes between 15 and 1440),
  response_sla_minutes integer not null default 120 check (response_sla_minutes between 15 and 10080),
  spend_without_lead numeric(12,2) not null default 750, target_cpl numeric(12,2) not null default 150,
  cpl_warning_multiplier numeric(6,2) not null default 1.5, cpl_critical_multiplier numeric(6,2) not null default 2.5,
  unattended_warning_percent numeric(5,2) not null default 25, unattended_critical_percent numeric(5,2) not null default 50,
  stale_ad_days integer not null default 14, ai_enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create unique index if not exists recruitment_ad_guard_policy_scope_uidx on public.recruitment_ad_guard_policies
  (company_id, stream, location_id, role_id) nulls not distinct;
create table if not exists public.recruitment_ad_guard_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  ad_id uuid not null references public.recruitment_ads(id) on delete cascade, severity text not null check (severity in ('critical','warning','opportunity','healthy')),
  recommendation_code text not null, evidence jsonb not null default '{}'::jsonb, explanation text,
  state text not null default 'open' check (state in ('open','acknowledged','dismissed','actioned')),
  action_taken text, actor_profile_id uuid references public.profiles(id) on delete set null, reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_ad_guard_events_scope_idx on public.recruitment_ad_guard_events(company_id,state,severity,created_at desc);
alter table public.recruitment_ad_guard_policies enable row level security;
alter table public.recruitment_ad_guard_events enable row level security;
revoke all on public.recruitment_ad_guard_policies, public.recruitment_ad_guard_events from public, anon, authenticated;
grant all on public.recruitment_ad_guard_policies, public.recruitment_ad_guard_events to service_role;
insert into public.recruitment_ad_guard_policies(company_id)
select distinct company_id from public.recruitment_ads
on conflict do nothing;
