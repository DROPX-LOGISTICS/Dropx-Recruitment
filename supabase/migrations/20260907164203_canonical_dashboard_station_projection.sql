-- Dashboard `stations` is the canonical location master. Recruitment keeps a
-- local projection only because historical recruitment records reference its
-- UUIDs. The projection is maintained automatically and cannot create a second
-- active location master.

alter table public.recruitment_locations
  add column if not exists station_id uuid;

-- ERSN is the retired Recruit-only code for the canonical KBWE / Payyoli
-- station. Rename the existing row so its ads, leads and contact history keep
-- the same recruitment location UUID.
update public.recruitment_locations as recruitment_location
set
  station_id = station.id,
  code = upper(trim(station.station_code)),
  name = coalesce(nullif(trim(station.station_name), ''), upper(trim(station.station_code))),
  state = station.state,
  region = station.region,
  is_active = coalesce(station.is_active, false) and not coalesce(station.hide_from_location_list, false),
  updated_at = now()
from public.stations as station
where recruitment_location.company_id = station.company_id
  and upper(trim(recruitment_location.code)) = 'ERSN'
  and upper(trim(station.station_code)) = 'KBWE'
  and lower(trim(recruitment_location.name)) = lower(trim(coalesce(station.station_name, station.station_code)))
  and not exists (
    select 1
    from public.recruitment_locations as existing
    where existing.company_id = station.company_id
      and upper(trim(existing.code)) = upper(trim(station.station_code))
      and existing.id <> recruitment_location.id
  );

-- Keep the currently running ad label aligned with the canonical station code.
-- Historical paused ad names remain unchanged; their station relation now points
-- to KBWE and no lead or spend history is rewritten.
update public.recruitment_ads as ad
set
  ad_name = 'KBWE' || substring(ad.ad_name from 5),
  raw_payload = case
    when jsonb_typeof(ad.raw_payload) = 'object'
      then jsonb_set(ad.raw_payload, '{name}', to_jsonb('KBWE' || substring(ad.ad_name from 5)), true)
    else ad.raw_payload
  end,
  updated_at = now()
from public.recruitment_locations as recruitment_location
where ad.location_id = recruitment_location.id
  and recruitment_location.station_id = (
    select station.id
    from public.stations as station
    where station.company_id = recruitment_location.company_id
      and upper(trim(station.station_code)) = 'KBWE'
    limit 1
  )
  and upper(ad.status) = 'ACTIVE'
  and upper(left(ad.ad_name, 5)) = 'ERSN_';

-- Match the existing projection by company and station code.
update public.recruitment_locations as recruitment_location
set
  station_id = station.id,
  code = upper(trim(station.station_code)),
  name = coalesce(nullif(trim(station.station_name), ''), upper(trim(station.station_code))),
  state = station.state,
  region = station.region,
  is_active = coalesce(station.is_active, false) and not coalesce(station.hide_from_location_list, false),
  updated_at = now()
from public.stations as station
where recruitment_location.company_id = station.company_id
  and upper(trim(recruitment_location.code)) = upper(trim(station.station_code));

-- Add every Dashboard location that Recruitment has not seen yet.
insert into public.recruitment_locations (
  company_id,
  station_id,
  code,
  name,
  state,
  region,
  address,
  latitude,
  longitude,
  poc_name,
  poc_mobile,
  is_active,
  updated_at
)
select
  station.company_id,
  station.id,
  upper(trim(station.station_code)),
  coalesce(nullif(trim(station.station_name), ''), upper(trim(station.station_code))),
  station.state,
  station.region,
  coalesce(
    nullif(trim(station.address), ''),
    nullif(concat_ws(', ',
      nullif(trim(station.address_line1), ''),
      nullif(trim(station.address_line2), ''),
      nullif(trim(station.city), ''),
      nullif(trim(station.postal_code), '')
    ), '')
  ),
  station.latitude,
  station.longitude,
  station.poc_name,
  station.poc_mobile,
  coalesce(station.is_active, false) and not coalesce(station.hide_from_location_list, false),
  now()
from public.stations as station
where station.company_id is not null
  and nullif(trim(station.station_code), '') is not null
  and not exists (
    select 1
    from public.recruitment_locations as recruitment_location
    where recruitment_location.company_id = station.company_id
      and upper(trim(recruitment_location.code)) = upper(trim(station.station_code))
  );

-- A Recruit-only row is retained for historical joins but can never remain in
-- an active location picker. RENG is one current example; no leads are deleted.
update public.recruitment_locations
set is_active = false, updated_at = now()
where station_id is null
  and is_active = true;

alter table public.recruitment_locations
  add constraint recruitment_locations_station_id_fkey
  foreign key (station_id) references public.stations(id) on delete restrict;

create unique index if not exists recruitment_locations_station_id_key
  on public.recruitment_locations(station_id)
  where station_id is not null;

comment on column public.recruitment_locations.station_id is
  'Canonical Dashboard station. Recruitment location identity and active state are synced from public.stations.';

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
      company_id,
      station_id,
      code,
      name,
      state,
      region,
      address,
      latitude,
      longitude,
      poc_name,
      poc_mobile,
      is_active,
      updated_at
    ) values (
      new.company_id,
      new.id,
      upper(trim(new.station_code)),
      coalesce(nullif(trim(new.station_name), ''), upper(trim(new.station_code))),
      new.state,
      new.region,
      canonical_address,
      new.latitude,
      new.longitude,
      new.poc_name,
      new.poc_mobile,
      coalesce(new.is_active, false) and not coalesce(new.hide_from_location_list, false),
      now()
    )
    on conflict (company_id, code) do update
    set
      station_id = excluded.station_id,
      name = excluded.name,
      state = excluded.state,
      region = excluded.region,
      is_active = excluded.is_active,
      updated_at = now()
    returning id into recruitment_location_id;
  else
    update public.recruitment_locations
    set
      company_id = new.company_id,
      code = upper(trim(new.station_code)),
      name = coalesce(nullif(trim(new.station_name), ''), upper(trim(new.station_code))),
      state = new.state,
      region = new.region,
      is_active = coalesce(new.is_active, false) and not coalesce(new.hide_from_location_list, false),
      updated_at = now()
    where id = recruitment_location_id;
  end if;

  insert into public.recruitment_location_contacts as contact (
    company_id,
    location_id,
    address,
    latitude,
    longitude,
    poc_name,
    poc_mobile,
    updated_at
  ) values (
    new.company_id,
    recruitment_location_id,
    canonical_address,
    new.latitude,
    new.longitude,
    new.poc_name,
    new.poc_mobile,
    now()
  )
  on conflict (company_id, location_id) do update
  set
    address = coalesce(excluded.address, contact.address),
    latitude = coalesce(excluded.latitude, contact.latitude),
    longitude = coalesce(excluded.longitude, contact.longitude),
    poc_name = coalesce(excluded.poc_name, contact.poc_name),
    poc_mobile = coalesce(excluded.poc_mobile, contact.poc_mobile),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists stations_sync_recruitment_location on public.stations;
create trigger stations_sync_recruitment_location
after insert or update of
  company_id,
  station_code,
  station_name,
  state,
  region,
  address,
  address_line1,
  address_line2,
  city,
  postal_code,
  latitude,
  longitude,
  poc_name,
  poc_mobile,
  is_active,
  hide_from_location_list
on public.stations
for each row
execute function public.sync_dashboard_station_to_recruitment_location();

create or replace function public.enforce_dashboard_station_on_recruitment_location()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  station public.stations%rowtype;
begin
  if new.station_id is null then
    select canonical.*
    into station
    from public.stations as canonical
    where canonical.company_id = new.company_id
      and upper(trim(canonical.station_code)) = upper(trim(new.code))
    limit 1;

    if station.id is null then
      if new.is_active then
        raise exception using
          errcode = '23514',
          message = format('Create station %s in Dashboard before using it in Recruitment.', coalesce(new.code, ''));
      end if;
      return new;
    end if;

    new.station_id := station.id;
  else
    select canonical.*
    into station
    from public.stations as canonical
    where canonical.id = new.station_id;
  end if;

  if station.id is null then
    raise exception using
      errcode = '23503',
      message = 'The linked Dashboard station does not exist.';
  end if;

  new.company_id := station.company_id;
  new.code := upper(trim(station.station_code));
  new.name := coalesce(nullif(trim(station.station_name), ''), upper(trim(station.station_code)));
  new.state := station.state;
  new.region := station.region;
  new.is_active := coalesce(station.is_active, false) and not coalesce(station.hide_from_location_list, false);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recruitment_locations_enforce_dashboard_station on public.recruitment_locations;
create trigger recruitment_locations_enforce_dashboard_station
before insert or update of station_id, company_id, code, name, state, region, is_active
on public.recruitment_locations
for each row
execute function public.enforce_dashboard_station_on_recruitment_location();

-- Seed the contact projection after the canonical IDs have been linked. An
-- existing Recruit contact is preserved whenever Dashboard has no value.
insert into public.recruitment_location_contacts as contact (
  company_id,
  location_id,
  address,
  latitude,
  longitude,
  poc_name,
  poc_mobile,
  updated_at
)
select
  station.company_id,
  recruitment_location.id,
  coalesce(
    nullif(trim(station.address), ''),
    nullif(concat_ws(', ',
      nullif(trim(station.address_line1), ''),
      nullif(trim(station.address_line2), ''),
      nullif(trim(station.city), ''),
      nullif(trim(station.postal_code), '')
    ), '')
  ),
  station.latitude,
  station.longitude,
  station.poc_name,
  station.poc_mobile,
  now()
from public.stations as station
join public.recruitment_locations as recruitment_location
  on recruitment_location.station_id = station.id
where station.company_id is not null
on conflict (company_id, location_id) do update
set
  address = coalesce(excluded.address, contact.address),
  latitude = coalesce(excluded.latitude, contact.latitude),
  longitude = coalesce(excluded.longitude, contact.longitude),
  poc_name = coalesce(excluded.poc_name, contact.poc_name),
  poc_mobile = coalesce(excluded.poc_mobile, contact.poc_mobile),
  updated_at = now();

comment on function public.sync_dashboard_station_to_recruitment_location() is
  'Keeps the Recruitment projection and station contacts aligned with the canonical Dashboard station master.';

comment on function public.enforce_dashboard_station_on_recruitment_location() is
  'Prevents active Recruit-only station identities and preserves Dashboard as the location source of truth.';
