begin;

create table if not exists public.field_travel_expense_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  requires_receipt boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

insert into public.field_travel_expense_types(company_id, code, name, sort_order)
select id, seed.code, seed.name, seed.sort_order
from public.companies
cross join (values
  ('fuel', 'Fuel', 10),
  ('bus_ticket', 'Bus ticket', 20),
  ('train_ticket', 'Train ticket', 30)
) as seed(code, name, sort_order)
on conflict(company_id, code) do nothing;

create table if not exists public.field_travel_approval_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  approver_profile_id uuid not null references public.profiles(id) on delete restrict,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, station_id)
);

alter table public.payment_requests add column if not exists source_system text;
alter table public.payment_requests add column if not exists source_record_id text;
create unique index if not exists payment_requests_source_uidx
  on public.payment_requests(company_id, source_system, source_record_id)
  where source_system is not null and source_record_id is not null;

insert into public.payment_heads(
  company_id, code, name, requires_supporting_document,
  request_expense_approval, is_active, sort_order
)
select id, 'FIELD_TRAVEL_REIMBURSEMENT', 'Field recruiter travel reimbursement', true, true, true, 35
from public.companies
on conflict(company_id, code) do update set
  name=excluded.name,
  requires_supporting_document=true,
  request_expense_approval=true,
  is_active=true,
  updated_at=now();

create table if not exists public.field_travel_reimbursements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_request_id uuid not null references public.payment_requests(id) on delete restrict,
  duty_id uuid not null references public.recruitment_field_duties(id) on delete restrict,
  recruiter_profile_id uuid not null references public.profiles(id) on delete restrict,
  expense_type_id uuid not null references public.field_travel_expense_types(id) on delete restrict,
  station_id uuid not null references public.stations(id) on delete restrict,
  recruitment_location_id uuid references public.recruitment_locations(id) on delete set null,
  client_expense_id text not null,
  distance_meters numeric(14,2) not null default 0,
  gps_coverage_percent numeric(6,2) not null default 0,
  people_contacted integer not null default 0,
  qualified_contacts integer not null default 0,
  route_summary jsonb not null default '{}'::jsonb,
  receipt_path text not null,
  receipt_file_name text not null,
  receipt_mime_type text not null,
  bank_source_profile_type text not null,
  bank_source_profile_id uuid not null,
  bank_verified_snapshot boolean not null default false,
  location_approver_user_id uuid not null references public.profiles(id) on delete restrict,
  reporting_approver_user_id uuid not null references public.profiles(id) on delete restrict,
  approval_stage text not null default 'location_validation'
    check (approval_stage in ('location_validation','reporting_approval','approved','rejected','returned','processing','paid','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, recruiter_profile_id, client_expense_id),
  unique(payment_request_id)
);

create index if not exists field_travel_reimbursements_recruiter_idx
  on public.field_travel_reimbursements(company_id, recruiter_profile_id, created_at desc);
create index if not exists field_travel_reimbursements_approval_idx
  on public.field_travel_reimbursements(company_id, approval_stage, updated_at desc);

create table if not exists public.recruitment_manual_punch_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  punch_type text not null default 'both' check (punch_type in ('in','out','both')),
  requires_evidence boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

insert into public.recruitment_manual_punch_reasons(company_id, code, name, punch_type, sort_order)
select id, seed.code, seed.name, seed.punch_type, seed.sort_order
from public.companies
cross join (values
  ('no_biometric', 'No biometric device at location', 'both', 10),
  ('device_offline', 'Biometric device unavailable', 'both', 20),
  ('new_location', 'New or unlisted duty location', 'both', 30),
  ('missed_punch', 'Punch missed accidentally', 'both', 40)
) as seed(code, name, punch_type, sort_order)
on conflict(company_id, code) do nothing;

alter table public.attendance_regularization_requests
  add column if not exists request_kind text,
  add column if not exists duty_id uuid references public.recruitment_field_duties(id) on delete set null,
  add column if not exists reason_master_id uuid references public.recruitment_manual_punch_reasons(id) on delete set null,
  add column if not exists duty_location_id uuid references public.recruitment_locations(id) on delete set null,
  add column if not exists requested_latitude numeric(10,7),
  add column if not exists requested_longitude numeric(10,7),
  add column if not exists requested_accuracy_meters numeric(10,2),
  add column if not exists evidence_path text,
  add column if not exists client_request_id text;

-- Preserve requests created by the original IN-only mobile flow. These rows
-- used missed_in plus the recruitment remarks prefix before request_kind was
-- introduced. Bridging them keeps pending requests (including Anees's) visible
-- and reviewable after this release without rewriting their requested time.
update public.attendance_regularization_requests
set request_kind = case
  when reason_code = 'missed_out' then 'field_duty_out'
  else 'field_duty_in'
end
where request_kind is null
  and profile_type = 'field_executive'
  and remarks ilike 'Recruitment field duty:%';

create unique index if not exists attendance_regularization_recruitment_client_uidx
  on public.attendance_regularization_requests(company_id, profile_id, client_request_id)
  where client_request_id is not null;
create index if not exists attendance_regularization_recruitment_queue_idx
  on public.attendance_regularization_requests(company_id, request_kind, status, attendance_date desc)
  where request_kind in ('field_duty_in','field_duty_out');

create table if not exists public.recruitment_manual_punch_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null references public.attendance_regularization_requests(id) on delete restrict,
  action text not null check (action in ('approved','rejected','returned')),
  decided_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  comments text,
  decided_at timestamptz not null default now()
);
create index if not exists recruitment_manual_punch_decisions_request_idx
  on public.recruitment_manual_punch_decisions(company_id, request_id, decided_at);

alter table public.recruitment_field_duties
  add column if not exists punch_out_at timestamptz,
  add column if not exists punch_out_source text,
  add column if not exists punch_out_request_id uuid references public.attendance_regularization_requests(id) on delete set null,
  add column if not exists worked_minutes integer,
  add column if not exists primary_location_id uuid references public.recruitment_locations(id) on delete set null;

-- The People/Attendance read model keeps manual provenance separately from
-- raw biometric punches. Approved times are never inserted into
-- attendance_punches and therefore cannot masquerade as device data.
alter table public.attendance_daily
  add column if not exists in_source text,
  add column if not exists out_source text,
  add column if not exists manual_in_request_id uuid references public.attendance_regularization_requests(id) on delete set null,
  add column if not exists manual_out_request_id uuid references public.attendance_regularization_requests(id) on delete set null,
  add column if not exists manual_in_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists manual_out_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists manual_in_approver_name text,
  add column if not exists manual_out_approver_name text,
  add column if not exists manual_in_approved_at timestamptz,
  add column if not exists manual_out_approved_at timestamptz;

alter table public.field_travel_expense_types enable row level security;
alter table public.field_travel_approval_assignments enable row level security;
alter table public.field_travel_reimbursements enable row level security;
alter table public.recruitment_manual_punch_reasons enable row level security;
alter table public.recruitment_manual_punch_decisions enable row level security;

revoke all on public.field_travel_expense_types from anon, authenticated;
revoke all on public.field_travel_approval_assignments from anon, authenticated;
revoke all on public.field_travel_reimbursements from anon, authenticated;
revoke all on public.recruitment_manual_punch_reasons from anon, authenticated;
revoke all on public.recruitment_manual_punch_decisions from anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='field_travel_expense_types' and policyname='service_role_field_travel_expense_types_all') then
    create policy service_role_field_travel_expense_types_all on public.field_travel_expense_types for all using (auth.role()='service_role') with check (auth.role()='service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='field_travel_approval_assignments' and policyname='service_role_field_travel_approval_assignments_all') then
    create policy service_role_field_travel_approval_assignments_all on public.field_travel_approval_assignments for all using (auth.role()='service_role') with check (auth.role()='service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='field_travel_reimbursements' and policyname='service_role_field_travel_reimbursements_all') then
    create policy service_role_field_travel_reimbursements_all on public.field_travel_reimbursements for all using (auth.role()='service_role') with check (auth.role()='service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='recruitment_manual_punch_reasons' and policyname='service_role_recruitment_manual_punch_reasons_all') then
    create policy service_role_recruitment_manual_punch_reasons_all on public.recruitment_manual_punch_reasons for all using (auth.role()='service_role') with check (auth.role()='service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='recruitment_manual_punch_decisions' and policyname='service_role_recruitment_manual_punch_decisions_all') then
    create policy service_role_recruitment_manual_punch_decisions_all on public.recruitment_manual_punch_decisions for all using (auth.role()='service_role') with check (auth.role()='service_role');
  end if;
end $$;

commit;

