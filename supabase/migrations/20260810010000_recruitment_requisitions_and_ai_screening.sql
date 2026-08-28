begin;

create table if not exists public.recruitment_job_requisitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requisition_code text not null,
  title text not null,
  role_id uuid references public.recruitment_roles(id) on delete restrict,
  location_id uuid references public.recruitment_locations(id) on delete restrict,
  worker_type text not null default 'employee',
  openings integer not null default 1,
  filled_positions integer not null default 0,
  status text not null default 'draft',
  priority text not null default 'normal',
  hiring_manager_profile_id uuid references public.profiles(id) on delete set null,
  recruiter_profile_id uuid references public.profiles(id) on delete set null,
  target_joining_date date,
  experience_min_years numeric(5,2),
  experience_max_years numeric(5,2),
  education text,
  salary_min numeric(14,2),
  salary_max numeric(14,2),
  currency text not null default 'INR',
  jd_text text not null,
  jd_storage_path text,
  jd_file_name text,
  must_have_skills text[] not null default '{}',
  preferred_skills text[] not null default '{}',
  screening_questions jsonb not null default '[]'::jsonb,
  source_channels text[] not null default '{}',
  version integer not null default 1,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruitment_job_requisitions_worker_type_check check (worker_type in ('employee','contractor')),
  constraint recruitment_job_requisitions_openings_check check (openings between 1 and 10000 and filled_positions between 0 and openings),
  constraint recruitment_job_requisitions_status_check check (status in ('draft','pending_approval','open','on_hold','closed','cancelled')),
  constraint recruitment_job_requisitions_priority_check check (priority in ('low','normal','high','critical')),
  constraint recruitment_job_requisitions_experience_check check (
    (experience_min_years is null or experience_min_years between 0 and 60)
    and (experience_max_years is null or experience_max_years between 0 and 60)
    and (experience_min_years is null or experience_max_years is null or experience_max_years >= experience_min_years)
  ),
  constraint recruitment_job_requisitions_salary_check check (
    (salary_min is null or salary_min >= 0) and (salary_max is null or salary_max >= 0)
    and (salary_min is null or salary_max is null or salary_max >= salary_min)
  ),
  unique(company_id, requisition_code)
);

create index if not exists recruitment_job_requisitions_company_status_idx
  on public.recruitment_job_requisitions(company_id,status,priority,created_at desc);
create index if not exists recruitment_job_requisitions_scope_idx
  on public.recruitment_job_requisitions(company_id,location_id,role_id,status);

create table if not exists public.recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.recruitment_leads(id) on delete cascade,
  requisition_id uuid not null references public.recruitment_job_requisitions(id) on delete restrict,
  source text not null default 'manual',
  external_application_id text,
  current_stage text not null default 'new',
  status text not null default 'active',
  applied_at timestamptz not null default now(),
  resume_storage_path text,
  resume_file_name text,
  resume_content_type text,
  latest_screened_at timestamptz,
  people_worker_type text,
  people_record_id uuid,
  transferred_at timestamptz,
  transferred_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruitment_applications_status_check check (status in ('active','withdrawn','rejected','hired','transferred')),
  constraint recruitment_applications_people_worker_check check (people_worker_type is null or people_worker_type in ('employee','contractor')),
  unique(company_id,lead_id,requisition_id)
);

create index if not exists recruitment_applications_requisition_stage_idx
  on public.recruitment_applications(company_id,requisition_id,status,current_stage,applied_at desc);
create index if not exists recruitment_applications_lead_idx
  on public.recruitment_applications(company_id,lead_id,applied_at desc);

create table if not exists public.recruitment_ai_screening_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  application_id uuid not null references public.recruitment_applications(id) on delete cascade,
  requisition_version integer not null,
  model text not null,
  prompt_version text not null,
  status text not null default 'completed',
  fit_score integer,
  recommendation text,
  summary text,
  must_have_matches jsonb not null default '[]'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  interview_questions jsonb not null default '[]'::jsonb,
  confidence numeric(5,4),
  input_tokens integer,
  output_tokens integer,
  redaction_applied boolean not null default true,
  error_code text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewer_decision text,
  reviewer_note text,
  reviewed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint recruitment_ai_screening_status_check check (status in ('completed','failed')),
  constraint recruitment_ai_screening_score_check check (fit_score is null or fit_score between 0 and 100),
  constraint recruitment_ai_screening_recommendation_check check (
    recommendation is null or recommendation in ('strong_review','review','needs_evidence')
  ),
  constraint recruitment_ai_screening_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint recruitment_ai_screening_review_check check (
    reviewer_decision is null or reviewer_decision in ('advance','hold','decline')
  )
);

create index if not exists recruitment_ai_screening_application_idx
  on public.recruitment_ai_screening_results(company_id,application_id,created_at desc);

create table if not exists public.recruitment_requisition_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requisition_id uuid not null references public.recruitment_job_requisitions(id) on delete cascade,
  event_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists recruitment_requisition_events_idx
  on public.recruitment_requisition_events(company_id,requisition_id,created_at desc);

create or replace function public.recruitment_touch_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end $$;

drop trigger if exists recruitment_job_requisitions_touch on public.recruitment_job_requisitions;
create trigger recruitment_job_requisitions_touch before update on public.recruitment_job_requisitions
for each row execute function public.recruitment_touch_updated_at();
drop trigger if exists recruitment_applications_touch on public.recruitment_applications;
create trigger recruitment_applications_touch before update on public.recruitment_applications
for each row execute function public.recruitment_touch_updated_at();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'recruitment_job_requisitions','recruitment_applications',
    'recruitment_ai_screening_results','recruitment_requisition_events'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=table_name and policyname='service_role_'||table_name||'_all') then
      execute format(
        'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
        'service_role_'||table_name||'_all',table_name
      );
    end if;
    execute format('revoke all on table public.%I from anon, authenticated',table_name);
    execute format('grant all on table public.%I to service_role',table_name);
  end loop;
end $$;

commit;
notify pgrst,'reload schema';
