create table public.recruitment_ad_audience_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  ad_id uuid not null references public.recruitment_ads(id),
  meta_adset_id text not null,
  client_request_id uuid not null,
  status text not null check (status in ('processing','completed','failed')),
  expected_version text not null,
  before_targeting jsonb not null,
  proposed_targeting jsonb not null,
  after_targeting jsonb,
  actor_profile_id uuid,
  actor_email text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (company_id, client_request_id)
);
create unique index recruitment_ad_audience_one_edit on public.recruitment_ad_audience_changes(meta_adset_id) where status = 'processing';
create index recruitment_ad_audience_history on public.recruitment_ad_audience_changes(company_id, ad_id, created_at desc);
create index recruitment_ad_audience_ad_idx on public.recruitment_ad_audience_changes(ad_id);
alter table public.recruitment_ad_audience_changes enable row level security;
revoke all on public.recruitment_ad_audience_changes from public, anon, authenticated;
grant all on public.recruitment_ad_audience_changes to service_role;
comment on table public.recruitment_ad_audience_changes is 'Server-only Meta audience change audit. API enforces Recruit stream, station and edit permissions.';
