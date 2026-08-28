begin;

alter table public.recruitment_field_contacts
  add column if not exists normalized_phone text,
  add column if not exists source_type text not null default 'field_sourcing',
  add column if not exists source_validation_status text not null default 'legacy_unverified',
  add column if not exists duplicate_of_lead_id uuid references public.recruitment_leads(id) on delete set null,
  add column if not exists duplicate_of_contact_id uuid references public.recruitment_field_contacts(id) on delete set null,
  add column if not exists pipeline_status text,
  add column if not exists pipeline_status_updated_at timestamptz,
  add column if not exists pipeline_status_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.recruitment_field_contacts
set normalized_phone = right(regexp_replace(phone, '[^0-9]', '', 'g'), 10),
    pipeline_status = coalesce(pipeline_status, outcome),
    pipeline_status_updated_at = coalesce(pipeline_status_updated_at, created_at),
    updated_at = coalesce(updated_at, created_at)
where normalized_phone is null or pipeline_status is null;

with matched_leads as (
  select c.id as contact_id, (
    select l.id
    from public.recruitment_leads l
    where l.company_id = c.company_id
      and l.normalized_phone = c.normalized_phone
    order by l.archived asc, l.updated_at desc, l.id
    limit 1
  ) as lead_id
  from public.recruitment_field_contacts c
)
update public.recruitment_field_contacts c
set source_validation_status = 'legacy_system_duplicate',
    duplicate_of_lead_id = matched_leads.lead_id
from matched_leads
where c.id = matched_leads.contact_id and matched_leads.lead_id is not null;

with ranked as (
  select id,
    first_value(id) over (partition by company_id, normalized_phone order by created_at, id) as first_id,
    row_number() over (partition by company_id, normalized_phone order by created_at, id) as row_number
  from public.recruitment_field_contacts
  where source_validation_status <> 'legacy_system_duplicate'
)
update public.recruitment_field_contacts c
set source_validation_status = 'legacy_field_duplicate',
    duplicate_of_contact_id = ranked.first_id
from ranked
where c.id = ranked.id and ranked.row_number > 1;

update public.recruitment_field_contacts
set source_validation_status = 'verified_unique'
where source_validation_status = 'legacy_unverified';

alter table public.recruitment_field_contacts
  drop constraint if exists recruitment_field_contacts_source_type_check,
  add constraint recruitment_field_contacts_source_type_check
    check (source_type in ('field_sourcing')),
  drop constraint if exists recruitment_field_contacts_source_validation_status_check,
  add constraint recruitment_field_contacts_source_validation_status_check
    check (source_validation_status in ('verified_unique','legacy_system_duplicate','legacy_field_duplicate','legacy_unverified')),
  drop constraint if exists recruitment_field_contacts_pipeline_status_check,
  add constraint recruitment_field_contacts_pipeline_status_check
    check (pipeline_status in ('interested','follow_up','interview_scheduled','not_interested','not_eligible','joining_reported','joined_verified'));

create unique index if not exists recruitment_field_contacts_unique_verified_phone_idx
  on public.recruitment_field_contacts(company_id, normalized_phone)
  where source_validation_status = 'verified_unique';
create index if not exists recruitment_field_contacts_normalized_phone_idx
  on public.recruitment_field_contacts(company_id, normalized_phone);
create index if not exists recruitment_field_contacts_pipeline_idx
  on public.recruitment_field_contacts(company_id, pipeline_status, created_at desc);

create table if not exists public.recruitment_field_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  duty_id uuid not null references public.recruitment_field_duties(id) on delete cascade,
  recruiter_profile_id uuid not null references public.profiles(id) on delete restrict,
  normalized_phone text not null,
  submitted_name text not null,
  result text not null check (result in ('accepted','duplicate_system','duplicate_field')),
  matched_lead_id uuid references public.recruitment_leads(id) on delete set null,
  matched_contact_id uuid references public.recruitment_field_contacts(id) on delete set null,
  created_contact_id uuid references public.recruitment_field_contacts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_field_contact_attempts_recruiter_idx
  on public.recruitment_field_contact_attempts(company_id, recruiter_profile_id, created_at desc);
create index if not exists recruitment_field_contact_attempts_phone_idx
  on public.recruitment_field_contact_attempts(company_id, normalized_phone, created_at desc);

create table if not exists public.recruitment_field_contact_status_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.recruitment_field_contacts(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  from_status text,
  to_status text not null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_field_contact_status_history_contact_idx
  on public.recruitment_field_contact_status_history(company_id, contact_id, created_at desc);

alter table public.recruitment_field_contact_attempts enable row level security;
alter table public.recruitment_field_contact_status_history enable row level security;
revoke all on public.recruitment_field_contact_attempts from public, anon, authenticated;
revoke all on public.recruitment_field_contact_status_history from public, anon, authenticated;

create or replace function public.recruitment_create_field_contact_v1(
  p_company_id uuid,
  p_duty_id uuid,
  p_actor_profile_id uuid,
  p_visit_id uuid,
  p_full_name text,
  p_normalized_phone text,
  p_location_id uuid,
  p_role_id uuid,
  p_vehicle_type text,
  p_rate_card_offered text,
  p_outcome text,
  p_follow_up_at timestamptz,
  p_notes text,
  p_latitude numeric,
  p_longitude numeric
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_duty public.recruitment_field_duties%rowtype;
  v_lead_id uuid;
  v_lead_source text;
  v_contact_id uuid;
  v_attempt_id uuid;
begin
  if p_normalized_phone !~ '^[0-9]{10}$' then
    return jsonb_build_object('accepted', false, 'code', 'INVALID_PHONE');
  end if;

  select * into v_duty
  from public.recruitment_field_duties
  where company_id = p_company_id and id = p_duty_id
  for update;
  if v_duty.id is null or v_duty.recruiter_profile_id <> p_actor_profile_id or v_duty.status <> 'active' then
    return jsonb_build_object('accepted', false, 'code', 'INVALID_DUTY');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company_id::text || ':' || p_normalized_phone, 0));

  select id, source into v_lead_id, v_lead_source
  from public.recruitment_leads
  where company_id = p_company_id and normalized_phone = p_normalized_phone
  order by archived asc, updated_at desc, id
  limit 1;
  if v_lead_id is not null then
    insert into public.recruitment_field_contact_attempts(
      company_id, duty_id, recruiter_profile_id, normalized_phone, submitted_name,
      result, matched_lead_id
    ) values (
      p_company_id, p_duty_id, p_actor_profile_id, p_normalized_phone, trim(p_full_name),
      'duplicate_system', v_lead_id
    ) returning id into v_attempt_id;
    return jsonb_build_object(
      'accepted', false,
      'code', 'DUPLICATE_SYSTEM_LEAD',
      'attemptId', v_attempt_id,
      'sourceCategory', case when v_lead_source = 'meta' then 'paid_or_system' else 'system' end
    );
  end if;

  select id into v_contact_id
  from public.recruitment_field_contacts
  where company_id = p_company_id and normalized_phone = p_normalized_phone
  order by created_at, id
  limit 1;
  if v_contact_id is not null then
    insert into public.recruitment_field_contact_attempts(
      company_id, duty_id, recruiter_profile_id, normalized_phone, submitted_name,
      result, matched_contact_id
    ) values (
      p_company_id, p_duty_id, p_actor_profile_id, p_normalized_phone, trim(p_full_name),
      'duplicate_field', v_contact_id
    ) returning id into v_attempt_id;
    return jsonb_build_object(
      'accepted', false,
      'code', 'DUPLICATE_FIELD_CONTACT',
      'attemptId', v_attempt_id
    );
  end if;

  insert into public.recruitment_field_contacts(
    company_id, duty_id, visit_id, full_name, phone, normalized_phone,
    location_id, role_id, vehicle_type, rate_card_offered, outcome,
    follow_up_at, notes, latitude, longitude, source_type,
    source_validation_status, pipeline_status, pipeline_status_updated_at,
    pipeline_status_updated_by, updated_at
  ) values (
    p_company_id, p_duty_id, p_visit_id, trim(p_full_name), p_normalized_phone, p_normalized_phone,
    p_location_id, p_role_id, p_vehicle_type, nullif(trim(p_rate_card_offered), ''), p_outcome,
    p_follow_up_at, nullif(trim(p_notes), ''), p_latitude, p_longitude, 'field_sourcing',
    'verified_unique', p_outcome, now(), p_actor_profile_id, now()
  ) returning id into v_contact_id;

  insert into public.recruitment_field_contact_status_history(
    company_id, contact_id, actor_profile_id, from_status, to_status, notes
  ) values (p_company_id, v_contact_id, p_actor_profile_id, null, p_outcome, 'Initial field contact');

  insert into public.recruitment_field_contact_attempts(
    company_id, duty_id, recruiter_profile_id, normalized_phone, submitted_name,
    result, created_contact_id
  ) values (
    p_company_id, p_duty_id, p_actor_profile_id, p_normalized_phone, trim(p_full_name),
    'accepted', v_contact_id
  ) returning id into v_attempt_id;

  return jsonb_build_object('accepted', true, 'code', 'CREATED', 'contactId', v_contact_id, 'attemptId', v_attempt_id);
exception
  when unique_violation then
    insert into public.recruitment_field_contact_attempts(
      company_id, duty_id, recruiter_profile_id, normalized_phone, submitted_name, result
    ) values (p_company_id, p_duty_id, p_actor_profile_id, p_normalized_phone, trim(p_full_name), 'duplicate_field')
    returning id into v_attempt_id;
    return jsonb_build_object('accepted', false, 'code', 'DUPLICATE_FIELD_CONTACT', 'attemptId', v_attempt_id);
end;
$$;

create or replace function public.recruitment_update_field_contact_status_v1(
  p_company_id uuid,
  p_contact_id uuid,
  p_actor_profile_id uuid,
  p_status text,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_contact public.recruitment_field_contacts%rowtype;
  v_owner_id uuid;
begin
  if p_status not in ('interested','follow_up','interview_scheduled','not_interested','not_eligible','joining_reported') then
    return jsonb_build_object('updated', false, 'code', 'INVALID_STATUS');
  end if;
  select c.*, d.recruiter_profile_id into v_contact, v_owner_id
  from public.recruitment_field_contacts c
  join public.recruitment_field_duties d on d.id = c.duty_id and d.company_id = c.company_id
  where c.company_id = p_company_id and c.id = p_contact_id
  for update of c;
  if v_contact.id is null then
    return jsonb_build_object('updated', false, 'code', 'NOT_FOUND');
  end if;
  if v_owner_id <> p_actor_profile_id then
    return jsonb_build_object('updated', false, 'code', 'FORBIDDEN');
  end if;
  if v_contact.source_validation_status <> 'verified_unique' then
    return jsonb_build_object('updated', false, 'code', 'DUPLICATE_CONTACT');
  end if;
  if v_contact.pipeline_status = p_status then
    return jsonb_build_object('updated', true, 'code', 'UNCHANGED', 'contactId', p_contact_id);
  end if;
  update public.recruitment_field_contacts
  set pipeline_status = p_status,
      pipeline_status_updated_at = now(),
      pipeline_status_updated_by = p_actor_profile_id,
      updated_at = now()
  where id = p_contact_id;
  insert into public.recruitment_field_contact_status_history(
    company_id, contact_id, actor_profile_id, from_status, to_status, notes
  ) values (p_company_id, p_contact_id, p_actor_profile_id, v_contact.pipeline_status, p_status, nullif(trim(p_notes), ''));
  return jsonb_build_object('updated', true, 'code', 'UPDATED', 'contactId', p_contact_id, 'status', p_status);
end;
$$;

revoke all on function public.recruitment_create_field_contact_v1(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text,text,timestamptz,text,numeric,numeric) from public, anon, authenticated;
grant execute on function public.recruitment_create_field_contact_v1(uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text,text,timestamptz,text,numeric,numeric) to service_role;
revoke all on function public.recruitment_update_field_contact_status_v1(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.recruitment_update_field_contact_status_v1(uuid,uuid,uuid,text,text) to service_role;

commit;
