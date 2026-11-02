create table public.recruitment_promotion_ads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  stream text not null check (stream in ('workforce','hr')),
  location_id uuid not null references public.recruitment_locations(id),
  client_request_id uuid not null,
  purpose text not null check (purpose in ('service_offer','customer_offer','brand')),
  ad_name text not null,
  draft jsonb not null,
  progress jsonb not null default '{}',
  snapshot jsonb not null default '{}',
  meta_ad_id text,
  status text not null default 'publishing',
  error_message text,
  actor_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,client_request_id),
  unique(company_id,meta_ad_id)
);
create index recruitment_promotion_scope on public.recruitment_promotion_ads(company_id,stream,location_id);
create index recruitment_promotion_location on public.recruitment_promotion_ads(location_id);
create table public.recruitment_promotion_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  ad_id uuid not null references public.recruitment_promotion_ads(id),
  client_request_id uuid not null,
  action text not null check (action in ('audience','ACTIVE','PAUSED')),
  status text not null check (status in ('processing','completed','failed')),
  before_snapshot jsonb not null,
  requested_change jsonb not null,
  after_snapshot jsonb,
  actor_email text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(company_id,client_request_id)
);
create unique index recruitment_promotion_one_edit on public.recruitment_promotion_events(ad_id) where status='processing';
create index recruitment_promotion_events_company on public.recruitment_promotion_events(company_id,ad_id,created_at desc);
alter table public.recruitment_promotion_ads enable row level security;
alter table public.recruitment_promotion_events enable row level security;
revoke all on public.recruitment_promotion_ads, public.recruitment_promotion_events from public, anon, authenticated;
grant all on public.recruitment_promotion_ads, public.recruitment_promotion_events to service_role;
comment on table public.recruitment_promotion_ads is 'Server-only service/customer website promotions. No recruitment role/form mapping or conversion of hiring ads. API enforces company, workspace, station and full ad permissions.';
