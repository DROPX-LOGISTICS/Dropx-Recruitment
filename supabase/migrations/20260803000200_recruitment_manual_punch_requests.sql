begin;

-- Recruitment reuses the company attendance regularization master so manual
-- field-duty punches remain visible to HR/payroll instead of living in a
-- disconnected mobile-only table.
create table if not exists public.attendance_regularization_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_type text not null check (
    profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker')
  ),
  profile_id uuid not null,
  dropx_id text,
  biometric_id text,
  full_name text,
  attendance_date date not null,
  current_in_time text,
  current_out_time text,
  requested_in_time time not null,
  requested_out_time time not null,
  reason_code text not null check (
    reason_code in ('missed_in', 'missed_out', 'missed_both', 'incorrect_in', 'incorrect_out', 'other')
  ),
  remarks text not null,
  attachment_path text,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'returned', 'rejected')
  ),
  review_remarks text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_regularization_requests_company_date_idx
  on public.attendance_regularization_requests(company_id, attendance_date desc);
create index if not exists attendance_regularization_requests_profile_idx
  on public.attendance_regularization_requests(company_id, profile_type, profile_id, attendance_date desc);
create unique index if not exists attendance_regularization_requests_open_unique
  on public.attendance_regularization_requests(company_id, profile_type, profile_id, attendance_date)
  where status in ('pending', 'returned');

alter table public.attendance_regularization_requests enable row level security;
drop policy if exists "Service role manages attendance regularization requests"
  on public.attendance_regularization_requests;
create policy "Service role manages attendance regularization requests"
  on public.attendance_regularization_requests
  for all to service_role using (true) with check (true);

commit;
