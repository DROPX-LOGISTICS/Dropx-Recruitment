begin;

alter table public.recruitment_field_location_points
  add column if not exists sequence integer,
  add column if not exists monotonic_ms bigint,
  add column if not exists altitude_meters numeric(9,2),
  add column if not exists speed_accuracy_mps numeric(8,2),
  add column if not exists heading_degrees numeric(7,2),
  add column if not exists heading_accuracy_degrees numeric(7,2),
  add column if not exists provider text,
  add column if not exists activity_type text,
  add column if not exists activity_confidence numeric(5,2),
  add column if not exists battery_percent numeric(5,2),
  add column if not exists is_charging boolean,
  add column if not exists app_version text,
  add column if not exists platform text,
  add column if not exists previous_hash text,
  add column if not exists point_hash text,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists quality_class text,
  add column if not exists decision text,
  add column if not exists motion_state text,
  add column if not exists rejection_codes text[] not null default '{}',
  add column if not exists accepted_distance_meters numeric(12,2) not null default 0,
  add column if not exists algorithm_version text;

create unique index if not exists recruitment_field_points_duty_sequence_uidx
  on public.recruitment_field_location_points(duty_id, sequence)
  where sequence is not null;
create index if not exists recruitment_field_points_decision_idx
  on public.recruitment_field_location_points(duty_id, decision, recorded_at);

alter table public.recruitment_field_duties
  add column if not exists raw_distance_meters integer not null default 0,
  add column if not exists accepted_distance_meters integer not null default 0,
  add column if not exists approved_distance_meters integer,
  add column if not exists gps_confidence_percent numeric(5,2),
  add column if not exists gps_stationary_point_count integer not null default 0,
  add column if not exists tracking_algorithm_version text,
  add column if not exists tracking_review_status text not null default 'auto_approved',
  add column if not exists integrity_risk_score numeric(5,2) not null default 0;

create table if not exists public.recruitment_tracking_integrity_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  duty_id uuid not null references public.recruitment_field_duties(id) on delete cascade,
  point_id bigint references public.recruitment_field_location_points(id) on delete set null,
  event_code text not null,
  severity text not null check (severity in ('info','warning','high','critical')),
  evidence jsonb not null default '{}'::jsonb,
  algorithm_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists recruitment_tracking_integrity_events_duty_idx
  on public.recruitment_tracking_integrity_events(duty_id, created_at);

alter table public.recruitment_tracking_integrity_events enable row level security;
revoke all on public.recruitment_tracking_integrity_events from anon, authenticated;

comment on column public.recruitment_field_duties.distance_meters is
  'Official server-validated distance. Never populated from a client-calculated total.';
comment on column public.recruitment_field_duties.raw_distance_meters is
  'Audit-only raw plausible polyline before stationary and drift rejection.';
comment on table public.recruitment_tracking_integrity_events is
  'Append-only server evidence for mock locations, impossible movement and route integrity review.';

commit;
