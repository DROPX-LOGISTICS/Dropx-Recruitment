-- Keep station identity in Dashboard while preserving Recruit-owned contact
-- details. Empty Dashboard fields must never erase a candidate contact.

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

-- Restore any surviving legacy values immediately, then recover the remaining
-- numbers from immutable pre-incident candidate-message history below.
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

-- The previous contact values were included in immutable candidate WhatsApp
-- template payloads. Recover the last verified number sent before the station
-- projection incident. This avoids guessing or replacing numbers with manager
-- contacts that were never shared with candidates.
with evidence as (
  select
    lead.location_id,
    outbox.created_at,
    case
      when outbox.template_name = 'job_application_number'
        then nullif(trim(outbox.template_parameters ->> 2), '')
      when outbox.template_name = 'job_location_share'
        then nullif(trim(outbox.template_parameters ->> 3), '')
    end as contact_mobile
  from public.recruitment_whatsapp_outbox as outbox
  join public.recruitment_leads as lead on lead.id = outbox.lead_id
  where outbox.created_at < '2026-09-07 17:07:19.502098+00'::timestamptz
    and outbox.template_name in ('job_application_number', 'job_location_share')
), ranked as (
  select
    location_id,
    right(regexp_replace(contact_mobile, '\D', '', 'g'), 10) as contact_mobile,
    row_number() over (partition by location_id order by created_at desc) as row_no
  from evidence
  where regexp_replace(coalesce(contact_mobile, ''), '\D', '', 'g') ~ '^[0-9]{10,13}$'
), latest as (
  select location_id, contact_mobile
  from ranked
  where row_no = 1
)
update public.recruitment_location_contacts as contact
set poc_mobile = latest.contact_mobile,
    updated_at = now()
from latest
where latest.location_id = contact.location_id
  and nullif(trim(contact.poc_mobile), '') is null;

-- Names visible in the pre-incident Station Contacts screen are restored
-- exactly. For the remaining recovered numbers, use People only when the same
-- normalized number resolves to one unambiguous person name.
with exact_names(code, poc_name) as (
  values
    ('AWEZ', 'Sabith'),
    ('CHM', 'Amaljith'),
    ('ERSE', 'Rahul'),
    ('GDRD', 'Suresh'),
    ('GNTF', 'Basava'),
    ('KBWE', 'Gokul')
), people as (
  select full_name, coalesce(nullif(mobile, ''), nullif(phone, '')) as mobile from public.profiles
  union all select full_name, mobile from public.employees
  union all select full_name, mobile from public.contractors
  union all select full_name, mobile from public.workforce
  union all select full_name, phone from public.delivery_associates
  union all select full_name, mobile from public.vendors
  union all select full_name, mobile from public.helpers
  union all select full_name, mobile from public.workforce_helpers
  union all select full_name, mobile from public.workforce_pickers
), unique_people as (
  select
    right(regexp_replace(mobile, '\D', '', 'g'), 10) as mobile,
    case
      when count(distinct upper(trim(full_name))) = 1 then min(trim(full_name))
      else null
    end as full_name
  from people
  where nullif(trim(full_name), '') is not null
    and regexp_replace(coalesce(mobile, ''), '\D', '', 'g') ~ '^[0-9]{10,13}$'
  group by right(regexp_replace(mobile, '\D', '', 'g'), 10)
), recovered_names as (
  select
    contact.id,
    coalesce(exact.poc_name, person.full_name) as poc_name
  from public.recruitment_location_contacts as contact
  join public.recruitment_locations as location on location.id = contact.location_id
  left join exact_names as exact on exact.code = upper(trim(location.code))
  left join unique_people as person
    on person.mobile = right(regexp_replace(contact.poc_mobile, '\D', '', 'g'), 10)
  where nullif(trim(contact.poc_name), '') is null
)
update public.recruitment_location_contacts as contact
set poc_name = recovered.poc_name,
    updated_at = now()
from recovered_names as recovered
where recovered.id = contact.id
  and recovered.poc_name is not null;

-- Keep compatibility reads in older Recruit flows aligned with the recovered
-- contact record while Dashboard continues to own station identity/mapping.
update public.recruitment_locations as location
set address = coalesce(nullif(trim(contact.address), ''), location.address),
    latitude = coalesce(contact.latitude, location.latitude),
    longitude = coalesce(contact.longitude, location.longitude),
    poc_name = coalesce(nullif(trim(contact.poc_name), ''), location.poc_name),
    poc_mobile = coalesce(nullif(trim(contact.poc_mobile), ''), location.poc_mobile),
    updated_at = now()
from public.recruitment_location_contacts as contact
where contact.location_id = location.id
  and contact.company_id = location.company_id;
