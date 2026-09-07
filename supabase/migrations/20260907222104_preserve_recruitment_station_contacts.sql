-- Keep station identity in Dashboard while preserving Recruit-owned contact
-- details. Empty Dashboard fields must never erase a candidate contact.

create extension if not exists pageinspect with schema extensions;

create table if not exists public.recruitment_location_contact_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid not null references public.recruitment_locations(id) on delete cascade,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  poc_name text,
  poc_mobile text,
  recorded_at timestamptz not null default now()
);

create index if not exists recruitment_location_contact_history_lookup_idx
  on public.recruitment_location_contact_history(company_id, location_id, recorded_at desc);

alter table public.recruitment_location_contact_history enable row level security;
revoke all on public.recruitment_location_contact_history from anon, authenticated;

create or replace function public.remember_recruitment_location_contact()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(old.address, old.latitude, old.longitude, old.poc_name, old.poc_mobile)
     is distinct from
     row(new.address, new.latitude, new.longitude, new.poc_name, new.poc_mobile) then
    insert into public.recruitment_location_contact_history (
      company_id, location_id, address, latitude, longitude, poc_name, poc_mobile
    ) values (
      old.company_id, old.location_id, old.address, old.latitude, old.longitude,
      old.poc_name, old.poc_mobile
    );
  end if;
  return new;
end;
$$;

drop trigger if exists recruitment_location_contacts_remember_previous on public.recruitment_location_contacts;
create trigger recruitment_location_contacts_remember_previous
before update on public.recruitment_location_contacts
for each row execute function public.remember_recruitment_location_contact();

create or replace function public.sync_dashboard_station_to_recruitment_location()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recruitment_location_id uuid;
  canonical_address text;
begin
  if new.company_id is null or nullif(trim(new.station_code), '') is null then
    return new;
  end if;

  canonical_address := coalesce(
    nullif(trim(new.address), ''),
    nullif(concat_ws(', ',
      nullif(trim(new.address_line1), ''),
      nullif(trim(new.address_line2), ''),
      nullif(trim(new.city), ''),
      nullif(trim(new.postal_code), '')
    ), '')
  );

  select location.id
  into recruitment_location_id
  from public.recruitment_locations as location
  where location.station_id = new.id;

  if recruitment_location_id is null then
    insert into public.recruitment_locations (
      company_id, station_id, code, name, state, region, address, latitude,
      longitude, poc_name, poc_mobile, is_active, updated_at
    ) values (
      new.company_id, new.id, upper(trim(new.station_code)),
      coalesce(nullif(trim(new.station_name), ''), upper(trim(new.station_code))),
      new.state, new.region, canonical_address, new.latitude, new.longitude,
      nullif(trim(new.poc_name), ''), nullif(trim(new.poc_mobile), ''),
      coalesce(new.is_active, false) and not coalesce(new.hide_from_location_list, false),
      now()
    )
    on conflict (company_id, code) do update
    set station_id = excluded.station_id,
        name = excluded.name,
        state = excluded.state,
        region = excluded.region,
        is_active = excluded.is_active,
        updated_at = now()
    returning id into recruitment_location_id;
  else
    update public.recruitment_locations
    set company_id = new.company_id,
        code = upper(trim(new.station_code)),
        name = coalesce(nullif(trim(new.station_name), ''), upper(trim(new.station_code))),
        state = new.state,
        region = new.region,
        is_active = coalesce(new.is_active, false) and not coalesce(new.hide_from_location_list, false),
        updated_at = now()
    where id = recruitment_location_id;
  end if;

  insert into public.recruitment_location_contacts as contact (
    company_id, location_id, address, latitude, longitude, poc_name, poc_mobile, updated_at
  ) values (
    new.company_id, recruitment_location_id, canonical_address, new.latitude,
    new.longitude, nullif(trim(new.poc_name), ''), nullif(trim(new.poc_mobile), ''), now()
  )
  on conflict (company_id, location_id) do update
  set address = coalesce(nullif(trim(excluded.address), ''), contact.address),
      latitude = coalesce(excluded.latitude, contact.latitude),
      longitude = coalesce(excluded.longitude, contact.longitude),
      poc_name = coalesce(nullif(trim(excluded.poc_name), ''), nullif(trim(contact.poc_name), '')),
      poc_mobile = coalesce(nullif(trim(excluded.poc_mobile), ''), nullif(trim(contact.poc_mobile), '')),
      updated_at = now();

  return new;
end;
$$;

-- Restore any surviving legacy values immediately. The remaining historical
-- rows are recovered in the follow-up data migration after raw-page validation.
update public.recruitment_location_contacts as contact
set poc_name = coalesce(nullif(trim(contact.poc_name), ''), nullif(trim(location.poc_name), '')),
    poc_mobile = coalesce(nullif(trim(contact.poc_mobile), ''), nullif(trim(location.poc_mobile), '')),
    updated_at = now()
from public.recruitment_locations as location
where location.id = contact.location_id
  and location.company_id = contact.company_id
  and (
    (nullif(trim(contact.poc_name), '') is null and nullif(trim(location.poc_name), '') is not null)
    or
    (nullif(trim(contact.poc_mobile), '') is null and nullif(trim(location.poc_mobile), '') is not null)
  );
