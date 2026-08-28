create table if not exists public.recruitment_ad_creative_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ad_id uuid not null references public.recruitment_ads(id) on delete cascade,
  meta_ad_id text not null,
  client_request_id text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  previous_creative_id text,
  replacement_creative_id text,
  previous_poster_url text,
  replacement_poster_url text,
  replacement_image_hash text not null,
  reason text not null,
  configured_status_before text,
  effective_status_after text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  error_message text,
  meta_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists recruitment_ad_creative_changes_request_uidx
  on public.recruitment_ad_creative_changes(company_id, client_request_id);

create unique index if not exists recruitment_ad_creative_changes_processing_uidx
  on public.recruitment_ad_creative_changes(company_id, ad_id)
  where status = 'processing';

create index if not exists recruitment_ad_creative_changes_ad_created_idx
  on public.recruitment_ad_creative_changes(company_id, ad_id, created_at desc);

create index if not exists recruitment_ad_creative_changes_ad_id_idx
  on public.recruitment_ad_creative_changes(ad_id);

create index if not exists recruitment_ad_creative_changes_actor_idx
  on public.recruitment_ad_creative_changes(actor_profile_id)
  where actor_profile_id is not null;

alter table public.recruitment_ad_creative_changes enable row level security;

revoke all on table public.recruitment_ad_creative_changes from anon, authenticated;
grant select, insert, update on table public.recruitment_ad_creative_changes to service_role;
