-- Candidate communication keeps using the station-contact pin. Meta audience
-- targeting is deliberately stored separately so changing an ad radius/pin can
-- never change the location sent to candidates.
alter table public.recruitment_location_contacts
  add column if not exists ad_latitude numeric(10,7),
  add column if not exists ad_longitude numeric(10,7);

alter table public.recruitment_location_contacts
  drop constraint if exists recruitment_location_contacts_ad_pin_pair_check;

alter table public.recruitment_location_contacts
  add constraint recruitment_location_contacts_ad_pin_pair_check
  check (
    (ad_latitude is null and ad_longitude is null)
    or (
      ad_latitude between 5 and 38
      and ad_longitude between 67 and 98
    )
  );
