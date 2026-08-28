begin;

create table if not exists public.recruitment_hr_lifecycle_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  label text not null,
  stage_group text not null default 'pipeline',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_terminal boolean not null default false,
  requires_remarks boolean not null default true,
  requires_schedule boolean not null default false,
  recruiter_can_set boolean not null default true,
  interviewer_can_set boolean not null default false,
  first_call_available boolean not null default false,
  allowed_next_codes text[] not null default '{}',
  notification_trigger text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists public.recruitment_hr_workflow_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  max_interview_rounds integer not null default 2 check (max_interview_rounds between 1 and 10),
  default_interview_minutes integer not null default 45 check (default_interview_minutes between 15 and 240),
  require_offer_approval boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id)
);

create table if not exists public.recruitment_hr_interviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.recruitment_leads(id) on delete cascade,
  round_no integer not null check (round_no between 1 and 10),
  interviewer_profile_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled','rescheduled','completed','no_show','cancelled')),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 240),
  channels text[] not null default '{}',
  recruiter_note text,
  meet_link text,
  calendar_event_id text,
  invitation_delivery jsonb not null default '{}'::jsonb,
  decision text check (decision is null or decision in ('advance','selected','hold','rejected','no_show')),
  feedback text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists recruitment_hr_interviews_active_round_uidx
  on public.recruitment_hr_interviews(company_id, lead_id, round_no)
  where status <> 'cancelled';
create index if not exists recruitment_hr_interviews_assignee_idx
  on public.recruitment_hr_interviews(company_id, interviewer_profile_id, status, scheduled_at desc);
create index if not exists recruitment_hr_interviews_lead_idx
  on public.recruitment_hr_interviews(company_id, lead_id, round_no desc);

create table if not exists public.recruitment_hr_offer_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.recruitment_leads(id) on delete cascade,
  version_no integer not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','issued','accepted','rejected','withdrawn')),
  variant text not null default 'non_statutory' check (variant in ('statutory','non_statutory')),
  job_title text not null,
  work_location text,
  compensation jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  joining_date date,
  probation text,
  additional_terms text,
  storage_bucket text,
  storage_path text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_by_profile_id uuid references public.profiles(id) on delete set null,
  issued_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, lead_id, version_no)
);
create index if not exists recruitment_hr_offer_versions_lead_idx
  on public.recruitment_hr_offer_versions(company_id, lead_id, version_no desc);

insert into public.recruitment_hr_lifecycle_rules
  (company_id, code, label, stage_group, sort_order, is_terminal, requires_remarks, requires_schedule, recruiter_can_set, interviewer_can_set, first_call_available, allowed_next_codes, notification_trigger)
select company.id, stage.code, stage.label, stage.stage_group, stage.sort_order, stage.is_terminal,
  stage.requires_remarks, stage.requires_schedule, stage.recruiter_can_set, stage.interviewer_can_set, stage.first_call_available,
  stage.allowed_next_codes, stage.notification_trigger
from public.companies company
cross join (values
  ('new','New profile','intake',10,false,false,false,true,false,false,array['contacting','screening','no_response','call_back','not_fit','interview_scheduled','selected']::text[],null),
  ('contacting','Contacting','screening',20,false,true,false,true,false,false,array['screening','no_response','call_back','not_fit','interview_scheduled','selected']::text[],null),
  ('screening','Screening','screening',30,false,true,false,true,false,true,array['documents_pending','interview_scheduled','selected','hold','rejected']::text[],null),
  ('documents_pending','Documents pending','screening',40,false,true,false,true,false,false,array['screening','interview_scheduled','rejected']::text[],null),
  ('interview_scheduled','Interview scheduled','interview',50,false,true,true,true,true,true,array['interview_rescheduled','interview_completed','interview_no_show','hold','rejected']::text[],'interview'),
  ('interview_rescheduled','Interview rescheduled','interview',55,false,true,true,true,true,false,array['interview_rescheduled','interview_completed','interview_no_show','hold','rejected']::text[],'interview'),
  ('interview_completed','Interview completed','interview',60,false,true,false,false,true,false,array['round_2_pending','selected','hold','rejected']::text[],null),
  ('round_2_pending','Round 2 pending','interview',65,false,true,false,true,false,false,array['interview_scheduled','rejected']::text[],null),
  ('interview_no_show','Candidate did not attend','interview',70,false,true,false,false,true,false,array['interview_rescheduled','rejected']::text[],null),
  ('selected','Selected','selection',80,false,true,false,true,true,true,array['offer_pending','rejected']::text[],null),
  ('offer_pending','Offer pending','offer',90,false,true,false,true,false,false,array['offered','rejected']::text[],null),
  ('offered','Offer issued','offer',100,false,true,false,true,false,false,array['joined','rejected']::text[],null),
  ('joined','Joined','joining',110,true,false,false,true,false,false,array[]::text[],null),
  ('no_response','No response','follow_up',120,false,true,false,true,false,true,array['contacting','call_back','not_fit','interview_scheduled','rejected']::text[],'no_response'),
  ('call_back','Call back','follow_up',130,false,true,false,true,false,true,array['contacting','screening','no_response','not_fit','interview_scheduled','rejected']::text[],null),
  ('hold','On hold','follow_up',140,false,true,false,true,true,true,array['screening','interview_scheduled','rejected']::text[],null),
  ('not_fit','Not fit','closed',150,true,true,false,true,false,true,array[]::text[],null),
  ('rejected','Rejected','closed',160,true,true,false,true,true,false,array[]::text[],null)
) as stage(code,label,stage_group,sort_order,is_terminal,requires_remarks,requires_schedule,recruiter_can_set,interviewer_can_set,first_call_available,allowed_next_codes,notification_trigger)
on conflict (company_id, code) do nothing;

insert into public.recruitment_hr_workflow_settings (company_id)
select id from public.companies
on conflict (company_id) do nothing;

alter table public.recruitment_hr_lifecycle_rules enable row level security;
alter table public.recruitment_hr_workflow_settings enable row level security;
alter table public.recruitment_hr_interviews enable row level security;
alter table public.recruitment_hr_offer_versions enable row level security;

revoke all on public.recruitment_hr_lifecycle_rules from anon, authenticated;
revoke all on public.recruitment_hr_workflow_settings from anon, authenticated;
revoke all on public.recruitment_hr_interviews from anon, authenticated;
revoke all on public.recruitment_hr_offer_versions from anon, authenticated;

commit;
