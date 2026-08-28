begin;

create table if not exists public.recruitment_field_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  duty_id uuid not null references public.recruitment_field_duties(id) on delete cascade,
  recruiter_profile_id uuid not null references public.profiles(id) on delete cascade,
  client_expense_id text not null,
  expense_type text not null check (expense_type in ('fuel_bill','bus_ticket')),
  amount numeric(12,2) not null check (amount > 0 and amount <= 100000),
  receipt_path text not null,
  receipt_file_name text not null,
  receipt_mime_type text not null,
  status text not null default 'pending_manager'
    check (status in ('pending_manager','pending_zonal','approved','rejected')),
  manager_approved_by uuid references public.profiles(id) on delete set null,
  manager_approved_at timestamptz,
  manager_remarks text,
  zonal_approved_by uuid references public.profiles(id) on delete set null,
  zonal_approved_at timestamptz,
  zonal_remarks text,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, recruiter_profile_id, client_expense_id)
);

create index if not exists recruitment_field_expenses_queue_idx
  on public.recruitment_field_expenses(company_id, status, created_at desc);
create index if not exists recruitment_field_expenses_duty_idx
  on public.recruitment_field_expenses(duty_id, created_at);

alter table public.recruitment_field_expenses enable row level security;
revoke all on public.recruitment_field_expenses from anon, authenticated;

commit;
