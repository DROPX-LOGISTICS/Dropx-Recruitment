begin;

insert into public.recruitment_roles(
  company_id, code, name, stream, aliases, required_fields, is_active
)
select
  company.id,
  'JAE',
  'Junior Accountant / Accounts Executive',
  'hr'::public.recruitment_stream,
  array['JUNIOR ACCOUNTANT','ACCOUNTS EXECUTIVE','JUNIOR ACCOUNTS EXECUTIVE'],
  array[
    'full_name','phone','email','city','post_code','Highest_Qualification',
    'experience','current_employer','Current_Monthly_Inhand_Salary','notice_period'
  ],
  true
from public.companies company
where company.code = 'DROPX_LOGISTICS'
on conflict(company_id, code) do update set
  name = excluded.name,
  stream = excluded.stream,
  aliases = excluded.aliases,
  required_fields = excluded.required_fields,
  is_active = true,
  updated_at = now();

create table if not exists public.recruitment_indeed_job_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  indeed_job_id text not null,
  indeed_published_id text,
  public_title text not null,
  internal_code text not null,
  location_id uuid not null references public.recruitment_locations(id) on delete restrict,
  role_id uuid not null references public.recruitment_roles(id) on delete restrict,
  is_active boolean not null default true,
  last_application_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, indeed_job_id),
  check (indeed_job_id = btrim(indeed_job_id) and length(indeed_job_id) between 1 and 512),
  check (public_title = btrim(public_title) and length(public_title) between 3 and 120),
  check (internal_code ~ '^[A-Z0-9]+_[A-Z0-9]+$')
);
create index if not exists recruitment_indeed_jobs_company_active_idx
  on public.recruitment_indeed_job_mappings(company_id, is_active, internal_code);

create table if not exists public.recruitment_indeed_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mapping_id uuid not null references public.recruitment_indeed_job_mappings(id) on delete restrict,
  lead_id uuid references public.recruitment_leads(id) on delete set null,
  apply_id text not null,
  indeed_job_id text not null,
  applicant_email text,
  payload_hash text not null,
  applied_at timestamptz,
  resume_path text,
  resume_name text,
  resume_content_type text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(company_id, apply_id)
);
create index if not exists recruitment_indeed_duplicate_lookup_idx
  on public.recruitment_indeed_applications(company_id, indeed_job_id, applicant_email, received_at desc)
  where applicant_email is not null;
create index if not exists recruitment_indeed_lead_idx
  on public.recruitment_indeed_applications(company_id, lead_id, received_at desc);

create or replace function public.recruitment_validate_indeed_mapping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role_company uuid;
  role_code text;
  role_stream public.recruitment_stream;
  location_company uuid;
begin
  select company_id, code, stream
    into role_company, role_code, role_stream
  from public.recruitment_roles
  where id = new.role_id and is_active;
  select company_id into location_company
  from public.recruitment_locations
  where id = new.location_id and is_active;

  if role_company is null or role_company <> new.company_id or role_stream <> 'hr' then
    raise exception 'Indeed job mappings require an active HR designation in the same company';
  end if;
  if location_company is null or location_company <> new.company_id then
    raise exception 'Indeed job mappings require an active business location in the same company';
  end if;
  if regexp_replace(new.internal_code, '^.*_', '') <> role_code then
    raise exception 'Indeed internal code suffix must match the HR designation code';
  end if;
  if upper(new.public_title) = new.internal_code then
    raise exception 'Candidate-facing title must not expose the internal routing code';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recruitment_validate_indeed_mapping_trigger
  on public.recruitment_indeed_job_mappings;
create trigger recruitment_validate_indeed_mapping_trigger
before insert or update on public.recruitment_indeed_job_mappings
for each row execute function public.recruitment_validate_indeed_mapping();

with company as (
  select id from public.companies where code = 'DROPX_LOGISTICS'
), jobs(indeed_job_id, indeed_published_id, public_title, internal_code, location_code, role_code) as (
  values
    (
      'aXJpOi8vYXBpcy5pbmRlZWQuY29tL0VtcGxveWVySm9iLzM0ZmU1MDcwLTQ1NDgtNDFhZC1iZWYxLWQ3YTI4NDc5M2M4OA==',
      '1535cf162dbd',
      'Cluster Manager – Last Mile Delivery',
      'AP_CLM',
      'GDRD',
      'CLM'
    ),
    (
      'aXJpOi8vYXBpcy5pbmRlZWQuY29tL0VtcGxveWVySm9iL2U0NjNlNGFlLTlmZGItNDg5Zi04Y2QxLWZhMTM2MWQ2ZGJhNw==',
      '95637902b892',
      'Junior Accountant / Accounts Executive',
      'HO_JAE',
      'HO',
      'JAE'
    )
)
insert into public.recruitment_indeed_job_mappings(
  company_id, indeed_job_id, indeed_published_id, public_title,
  internal_code, location_id, role_id, is_active
)
select
  company.id,
  jobs.indeed_job_id,
  jobs.indeed_published_id,
  jobs.public_title,
  jobs.internal_code,
  location.id,
  role.id,
  true
from company
join jobs on true
join public.recruitment_locations location
  on location.company_id = company.id and location.code = jobs.location_code
join public.recruitment_roles role
  on role.company_id = company.id and role.code = jobs.role_code
on conflict(company_id, indeed_job_id) do update set
  indeed_published_id = excluded.indeed_published_id,
  public_title = excluded.public_title,
  internal_code = excluded.internal_code,
  location_id = excluded.location_id,
  role_id = excluded.role_id,
  is_active = true,
  updated_at = now();

alter table public.recruitment_indeed_job_mappings enable row level security;
alter table public.recruitment_indeed_applications enable row level security;
revoke all on public.recruitment_indeed_job_mappings from anon, authenticated;
revoke all on public.recruitment_indeed_applications from anon, authenticated;
revoke all on function public.recruitment_validate_indeed_mapping() from public, anon, authenticated;

update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array[
      'application/pdf','image/png','image/jpeg','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/rtf','text/plain'
    ]
where id = 'recruitment-documents';

notify pgrst, 'reload schema';

commit;
