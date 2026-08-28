begin;

create table if not exists public.recruitment_field_duties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recruiter_profile_id uuid not null references public.profiles(id) on delete cascade,
  duty_date date not null,
  punch_in_at timestamptz,
  punch_in_source text not null default 'biometric',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active'
    check (status in ('active','completed','cancelled')),
  start_latitude numeric(10,7),
  start_longitude numeric(10,7),
  end_latitude numeric(10,7),
  end_longitude numeric(10,7),
  distance_meters integer not null default 0 check (distance_meters >= 0),
  gps_point_count integer not null default 0 check (gps_point_count >= 0),
  gps_coverage_percent numeric(5,2),
  tomorrow_location_ids uuid[] not null default '{}',
  tomorrow_target integer,
  expected_joinees integer,
  challenges text,
  tomorrow_plan text,
  remarks text,
  zero_activity_reason text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, recruiter_profile_id, duty_date)
);

create table if not exists public.recruitment_field_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  duty_id uuid not null references public.recruitment_field_duties(id) on delete cascade,
  location_id uuid references public.recruitment_locations(id) on delete set null,
  location_name text,
  visit_type text not null default 'field_sourcing',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  latitude numeric(10,7),
  longitude numeric(10,7),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.recruitment_field_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  duty_id uuid not null references public.recruitment_field_duties(id) on delete cascade,
  visit_id uuid references public.recruitment_field_visits(id) on delete set null,
  lead_id uuid references public.recruitment_leads(id) on delete set null,
  full_name text not null,
  phone text not null,
  location_id uuid references public.recruitment_locations(id) on delete set null,
  role_id uuid references public.recruitment_roles(id) on delete set null,
  vehicle_type text check (vehicle_type in ('bike','van','none','other')),
  rate_card_offered text,
  outcome text not null
    check (outcome in ('interested','follow_up','not_interested','not_eligible','interview_scheduled')),
  follow_up_at timestamptz,
  notes text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  created_at timestamptz not null default now()
);

create table if not exists public.recruitment_field_location_points (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  duty_id uuid not null references public.recruitment_field_duties(id) on delete cascade,
  recorded_at timestamptz not null,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  accuracy_meters numeric(8,2),
  speed_mps numeric(8,2),
  is_mocked boolean not null default false,
  created_at timestamptz not null default now(),
  unique(duty_id, recorded_at)
);

create index if not exists recruitment_field_duties_company_date_idx
  on public.recruitment_field_duties(company_id, duty_date desc);
create index if not exists recruitment_field_duties_recruiter_idx
  on public.recruitment_field_duties(recruiter_profile_id, duty_date desc);
create index if not exists recruitment_field_contacts_duty_idx
  on public.recruitment_field_contacts(duty_id, created_at);
create index if not exists recruitment_field_points_duty_idx
  on public.recruitment_field_location_points(duty_id, recorded_at);

alter table public.recruitment_field_duties enable row level security;
alter table public.recruitment_field_visits enable row level security;
alter table public.recruitment_field_contacts enable row level security;
alter table public.recruitment_field_location_points enable row level security;

revoke all on public.recruitment_field_duties from anon, authenticated;
revoke all on public.recruitment_field_visits from anon, authenticated;
revoke all on public.recruitment_field_contacts from anon, authenticated;
revoke all on public.recruitment_field_location_points from anon, authenticated;

commit;
