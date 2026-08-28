begin;

-- Preserve the exact server-resolved punch station on the duty. The mobile
-- client may display this snapshot but cannot replace it with another station.
alter table public.recruitment_field_duties
  add column if not exists primary_station_id uuid references public.stations(id) on delete set null,
  add column if not exists primary_location_name text,
  add column if not exists primary_location_code text,
  add column if not exists primary_location_source text,
  add column if not exists primary_location_latitude numeric(10,7),
  add column if not exists primary_location_longitude numeric(10,7),
  add column if not exists punch_in_device_serial text,
  add column if not exists punch_in_request_id uuid references public.attendance_regularization_requests(id) on delete set null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recruitment_field_duties_primary_location_source_check'
      and conrelid = 'public.recruitment_field_duties'::regclass
  ) then
    alter table public.recruitment_field_duties
      add constraint recruitment_field_duties_primary_location_source_check
      check (primary_location_source is null or primary_location_source in ('biometric_device','manual_approved'));
  end if;
end $$;

create index if not exists recruitment_field_duties_primary_station_idx
  on public.recruitment_field_duties(company_id, primary_station_id, duty_date desc);

comment on column public.recruitment_field_duties.primary_location_source is
  'Immutable source used to resolve the duty station: biometric_device or approved manual IN.';

commit;
