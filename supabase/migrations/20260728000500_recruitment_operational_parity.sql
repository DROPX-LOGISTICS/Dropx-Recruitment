begin;

create table if not exists public.recruitment_location_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid not null references public.recruitment_locations(id) on delete cascade,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  poc_name text,
  poc_mobile text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, location_id)
);

create table if not exists public.recruitment_ad_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id text not null,
  request_type text not null check (request_type in ('new_ad','budget_change','stop_ad')),
  ad_id uuid references public.recruitment_ads(id) on delete set null,
  location_id uuid references public.recruitment_locations(id) on delete set null,
  role_id uuid references public.recruitment_roles(id) on delete set null,
  status text not null default 'requested',
  requested_budget numeric(14,2),
  old_budget numeric(14,2),
  days_required integer,
  payment_offer text,
  location_details text,
  poster_url text,
  notes text,
  reason text,
  requested_by text,
  requested_at timestamptz,
  admin_remarks text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, request_id)
);

alter table public.recruitment_lead_history
  add column if not exists source_event_key text;

alter table public.recruitment_lead_history
  add constraint recruitment_lead_history_source_event_key_key
  unique(company_id, source_event_key);

alter table public.recruitment_location_contacts enable row level security;
alter table public.recruitment_ad_requests enable row level security;
revoke all on public.recruitment_location_contacts from anon, authenticated;
revoke all on public.recruitment_ad_requests from anon, authenticated;

commit;
