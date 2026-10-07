begin;

create table public.recruitment_temporary_location_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_access_id uuid not null references public.recruitment_user_access(id),
  location_id uuid not null references public.recruitment_locations(id),
  request_id uuid not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  constraint recruit_temporary_grant_window check (expires_at > starts_at),
  constraint recruit_temporary_revoke_actor check ((revoked_at is null) = (revoked_by is null)),
  unique (company_id, request_id, location_id)
);
create index recruit_temporary_active_scope_idx
  on public.recruitment_temporary_location_grants(company_id, user_access_id, expires_at)
  where revoked_at is null;
create index recruit_temporary_history_idx
  on public.recruitment_temporary_location_grants(company_id, user_access_id, created_at desc);
create index recruit_temporary_location_idx on public.recruitment_temporary_location_grants(location_id);
create index recruit_temporary_grantor_idx on public.recruitment_temporary_location_grants(granted_by);
create index recruit_temporary_revoker_idx on public.recruitment_temporary_location_grants(revoked_by);

-- These are privileged administrative exceptions. Custom Recruit sessions are
-- checked by the server; no browser/PostgREST role may grant itself access.
alter table public.recruitment_temporary_location_grants enable row level security;
revoke all on public.recruitment_temporary_location_grants from public, anon, authenticated;
grant select, insert, update on public.recruitment_temporary_location_grants to service_role;
revoke delete, truncate on public.recruitment_temporary_location_grants from service_role;

create function public.validate_recruit_temporary_location_grant()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'revoked_at' - 'revoked_by') is distinct from
       (to_jsonb(old) - 'revoked_at' - 'revoked_by')
       or old.revoked_at is not null or new.revoked_at is null then
      raise exception 'Temporary grants are immutable; disable and create a new grant';
    end if;
    if not exists (select 1 from public.profiles p where p.id = new.revoked_by and p.company_id = new.company_id and p.is_active) then
      raise exception 'Invalid revoking user';
    end if;
    return new;
  end if;
  if new.revoked_at is not null or new.revoked_by is not null or new.expires_at <= now() then
    raise exception 'A new grant must be active with a future expiry';
  end if;
  if not exists (
    select 1 from public.recruitment_user_access a
    join public.profiles p on p.id = a.profile_id and p.company_id = a.company_id and p.is_active
    join public.company_product_memberships m on m.user_id = p.id and m.company_id = a.company_id and m.product_code = 'recruit' and m.is_active
    where a.id = new.user_access_id and a.company_id = new.company_id and a.is_active
  ) or not exists (
    select 1 from public.recruitment_locations l
    join public.stations s on s.id = l.station_id and s.company_id = l.company_id and s.is_active
    where l.id = new.location_id and l.company_id = new.company_id and l.is_active
  ) or not exists (
    select 1 from public.profiles p where p.id = new.granted_by and p.company_id = new.company_id and p.is_active
  ) then
    raise exception 'User, location and actor must be active in the same company';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_recruit_temporary_location_grant() from public, anon, authenticated;
grant execute on function public.validate_recruit_temporary_location_grant() to service_role;
create trigger validate_recruit_temporary_location_grant
  before insert or update on public.recruitment_temporary_location_grants
  for each row execute function public.validate_recruit_temporary_location_grant();
comment on table public.recruitment_temporary_location_grants is
  'Recruit-only additive location exceptions. Expiry and revocation checked on every request; never projected into company or other product scope. Rows retain grant/revoke audit history.';

commit;
