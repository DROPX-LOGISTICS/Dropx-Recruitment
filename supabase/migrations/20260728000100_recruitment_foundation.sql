begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.recruitment_stream as enum ('workforce', 'hr');
exception when duplicate_object then null;
end $$;

create table if not exists public.recruitment_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  stream public.recruitment_stream not null,
  aliases text[] not null default '{}',
  required_fields text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists public.recruitment_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  state text,
  region text,
  cluster text,
  address text,
  latitude numeric,
  longitude numeric,
  poc_name text,
  poc_mobile text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists public.recruitment_user_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  can_access_workforce boolean not null default false,
  can_access_hr boolean not null default false,
  can_access_all_locations boolean not null default false,
  can_manage_masters boolean not null default false,
  can_manage_ads boolean not null default false,
  can_manage_users boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, profile_id)
);

create table if not exists public.recruitment_user_locations (
  user_access_id uuid not null references public.recruitment_user_access(id) on delete cascade,
  location_id uuid not null references public.recruitment_locations(id) on delete cascade,
  primary key(user_access_id, location_id)
);

create table if not exists public.recruitment_user_roles (
  user_access_id uuid not null references public.recruitment_user_access(id) on delete cascade,
  role_id uuid not null references public.recruitment_roles(id) on delete cascade,
  primary key(user_access_id, role_id)
);

create table if not exists public.recruitment_mobile_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mobile_e164 text not null,
  display_name text,
  is_active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, profile_id),
  unique(company_id, mobile_e164)
);

create table if not exists public.recruitment_mobile_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mobile_user_id uuid not null references public.recruitment_mobile_users(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  request_ip_hash text,
  provider_message_id text,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_mobile_otp_active_idx
  on public.recruitment_mobile_otp_challenges(company_id, mobile_user_id, expires_at desc);

create table if not exists public.recruitment_mobile_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mobile_user_id uuid references public.recruitment_mobile_users(id) on delete cascade,
  auth_method text not null check (auth_method in ('whatsapp_otp', 'google')),
  token_hash text not null unique,
  device_name text,
  device_id_hash text,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_mobile_sessions_active_idx
  on public.recruitment_mobile_sessions(company_id, profile_id, expires_at)
  where revoked_at is null;

create table if not exists public.recruitment_meta_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  is_enabled boolean not null default false,
  page_id text,
  ad_account_id text,
  graph_version text not null default 'v25.0',
  verify_token_hash text,
  access_token_secret_id uuid references vault.secrets(id) on delete set null,
  app_secret_secret_id uuid references vault.secrets(id) on delete set null,
  last_webhook_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recruitment_ads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  meta_ad_id text,
  meta_form_id text,
  ad_name text not null,
  adset_name text,
  campaign_name text,
  location_id uuid references public.recruitment_locations(id) on delete set null,
  role_id uuid references public.recruitment_roles(id) on delete set null,
  route_status text not null default 'unmapped',
  status text not null default 'unknown',
  daily_budget numeric(14,2),
  total_spend numeric(16,2) not null default 0,
  poster_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_on timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists recruitment_ads_company_meta_uidx
  on public.recruitment_ads(company_id, meta_ad_id)
  where meta_ad_id is not null;

create table if not exists public.recruitment_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  meta_lead_id text,
  canonical_key text not null,
  normalized_phone text,
  full_name text,
  phone text,
  email text,
  city text,
  post_code text,
  location_id uuid references public.recruitment_locations(id) on delete set null,
  role_id uuid references public.recruitment_roles(id) on delete set null,
  stream public.recruitment_stream,
  ad_id uuid references public.recruitment_ads(id) on delete set null,
  ad_name text,
  source text not null default 'meta',
  status text not null default '',
  remarks text,
  follow_up_at timestamptz,
  callback_at timestamptz,
  final_status text,
  final_remarks text,
  work_email text,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  questionnaire jsonb not null default '{}'::jsonb,
  duplicate_count integer not null default 1,
  total_attempts integer not null default 0,
  no_response_attempts integer not null default 0,
  call_back_attempts integer not null default 0,
  archived boolean not null default false,
  archived_at timestamptz,
  lead_created_at timestamptz,
  last_updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, canonical_key)
);

create unique index if not exists recruitment_leads_company_meta_uidx
  on public.recruitment_leads(company_id, meta_lead_id)
  where meta_lead_id is not null;
create index if not exists recruitment_leads_queue_idx
  on public.recruitment_leads(company_id, stream, archived, status, lead_created_at desc);
create index if not exists recruitment_leads_location_role_idx
  on public.recruitment_leads(company_id, location_id, role_id, status);
create index if not exists recruitment_leads_phone_idx
  on public.recruitment_leads(company_id, normalized_phone);

create table if not exists public.recruitment_lead_source_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid references public.recruitment_leads(id) on delete set null,
  event_key text not null,
  source_system text not null,
  source_sheet text,
  source_row integer,
  meta_lead_id text,
  ad_name text,
  payload jsonb not null,
  payload_hash text,
  status text not null default 'received',
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(company_id, event_key)
);

create table if not exists public.recruitment_lead_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.recruitment_leads(id) on delete cascade,
  event_type text not null,
  field_name text,
  old_value text,
  new_value text,
  remarks text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_lead_history_timeline_idx
  on public.recruitment_lead_history(company_id, lead_id, created_at desc);

create table if not exists public.recruitment_whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid references public.recruitment_leads(id) on delete set null,
  idempotency_key text not null,
  phone text not null,
  template_name text not null,
  template_parameters jsonb not null default '[]'::jsonb,
  status text not null default 'queued',
  provider_message_id text,
  provider_response jsonb,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, idempotency_key)
);
create index if not exists recruitment_whatsapp_outbox_queue_idx
  on public.recruitment_whatsapp_outbox(company_id, status, next_attempt_at);

create table if not exists public.recruitment_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null,
  mode text not null,
  status text not null default 'running',
  cursor jsonb not null default '{}'::jsonb,
  scanned_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  duplicate_count integer not null default 0,
  rejected_count integer not null default 0,
  error_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

alter table public.recruitment_roles enable row level security;
alter table public.recruitment_locations enable row level security;
alter table public.recruitment_user_access enable row level security;
alter table public.recruitment_user_locations enable row level security;
alter table public.recruitment_user_roles enable row level security;
alter table public.recruitment_mobile_users enable row level security;
alter table public.recruitment_mobile_otp_challenges enable row level security;
alter table public.recruitment_mobile_sessions enable row level security;
alter table public.recruitment_meta_settings enable row level security;
alter table public.recruitment_ads enable row level security;
alter table public.recruitment_leads enable row level security;
alter table public.recruitment_lead_source_events enable row level security;
alter table public.recruitment_lead_history enable row level security;
alter table public.recruitment_whatsapp_outbox enable row level security;
alter table public.recruitment_ingestion_runs enable row level security;

revoke all on public.recruitment_meta_settings from anon, authenticated;
revoke all on public.recruitment_mobile_users from anon, authenticated;
revoke all on public.recruitment_mobile_otp_challenges from anon, authenticated;
revoke all on public.recruitment_mobile_sessions from anon, authenticated;
revoke all on public.recruitment_lead_source_events from anon, authenticated;
revoke all on public.recruitment_whatsapp_outbox from anon, authenticated;
revoke all on public.recruitment_ingestion_runs from anon, authenticated;

commit;
