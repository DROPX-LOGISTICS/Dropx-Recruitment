begin;

create table if not exists public.workforce_profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_executive_id uuid not null references public.field_executives(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  current_values jsonb not null default '{}'::jsonb,
  proposed_values jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workforce_profile_change_requests_one_pending_idx
  on public.workforce_profile_change_requests (company_id, field_executive_id)
  where status = 'pending';

create index if not exists workforce_profile_change_requests_queue_idx
  on public.workforce_profile_change_requests (company_id, status, created_at);

create index if not exists workforce_profile_change_requests_executive_idx
  on public.workforce_profile_change_requests (field_executive_id);

create index if not exists workforce_profile_change_requests_requester_idx
  on public.workforce_profile_change_requests (requested_by);

create index if not exists workforce_profile_change_requests_reviewer_idx
  on public.workforce_profile_change_requests (reviewed_by)
  where reviewed_by is not null;

alter table public.workforce_profile_change_requests enable row level security;
revoke all on table public.workforce_profile_change_requests from anon, authenticated;
grant select, insert, update, delete on table public.workforce_profile_change_requests to service_role;

create or replace function public.review_workforce_profile_change_request(
  p_company_id uuid,
  p_request_id uuid,
  p_approver_id uuid,
  p_decision text,
  p_review_note text default null
)
returns table (request_id uuid, request_status text, field_executive_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  change_request public.workforce_profile_change_requests%rowtype;
  decision text := lower(trim(coalesce(p_decision, '')));
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;
  if decision = 'rejected' and nullif(trim(coalesce(p_review_note, '')), '') is null then
    raise exception 'A rejection reason is required.';
  end if;

  select * into change_request
  from public.workforce_profile_change_requests
  where company_id = p_company_id
    and id = p_request_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending profile change request was not found.';
  end if;

  if decision = 'approved' then
    update public.field_executives
    set full_name = change_request.proposed_values->>'full_name',
        mobile_country_code = change_request.proposed_values->>'mobile_country_code',
        mobile = change_request.proposed_values->>'mobile',
        email = change_request.proposed_values->>'email',
        date_of_join = (change_request.proposed_values->>'date_of_join')::date,
        location_id = (change_request.proposed_values->>'location_id')::uuid,
        designation = change_request.proposed_values->>'designation',
        updated_at = now()
    where company_id = p_company_id
      and id = change_request.field_executive_id;
    if not found then
      raise exception 'Field Executive profile was not found.';
    end if;
  end if;

  update public.workforce_profile_change_requests
  set status = decision,
      reviewed_by = p_approver_id,
      review_note = nullif(trim(coalesce(p_review_note, '')), ''),
      reviewed_at = now(),
      updated_at = now()
  where id = change_request.id;

  return query select change_request.id, decision, change_request.field_executive_id;
end;
$$;

revoke all on function public.review_workforce_profile_change_request(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_workforce_profile_change_request(uuid, uuid, uuid, text, text) to service_role;

commit;
