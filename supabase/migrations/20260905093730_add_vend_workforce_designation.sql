begin;

-- Recruitment designations are master-driven. Register VEND for every company
-- that already has a station-scoped <station>_VEND ad, then repair those ads
-- and their existing leads without relying on a generated company or role id.
with vend_companies as (
  select distinct ad.company_id
  from public.recruitment_ads ad
  join public.recruitment_locations location
    on location.company_id = ad.company_id
   and upper(location.code) = upper(split_part(ad.ad_name, '_', 1))
   and location.is_active
  where upper(split_part(ad.ad_name, '_', 2)) = 'VEND'
)
insert into public.recruitment_roles (
  company_id,
  code,
  name,
  stream,
  aliases,
  required_fields,
  is_active,
  updated_at
)
select
  company_id,
  'VEND',
  'Vendor',
  'workforce'::public.recruitment_stream,
  array['VENDOR']::text[],
  array['full_name', 'phone', 'city', 'post_code']::text[],
  true,
  now()
from vend_companies
on conflict (company_id, code) do update set
  name = excluded.name,
  stream = excluded.stream,
  aliases = (
    select array_agg(distinct alias order by alias)
    from unnest(public.recruitment_roles.aliases || excluded.aliases) alias
  ),
  required_fields = (
    select array_agg(distinct field order by field)
    from unnest(public.recruitment_roles.required_fields || excluded.required_fields) field
  ),
  is_active = true,
  updated_at = now();

update public.recruitment_ads ad
set
  location_id = location.id,
  role_id = role.id,
  route_status = 'mapped',
  updated_at = now()
from public.recruitment_locations location,
     public.recruitment_roles role
where location.company_id = ad.company_id
  and role.company_id = ad.company_id
  and upper(location.code) = upper(split_part(ad.ad_name, '_', 1))
  and upper(split_part(ad.ad_name, '_', 2)) = 'VEND'
  and role.code = 'VEND'
  and role.stream = 'workforce'::public.recruitment_stream
  and location.is_active
  and role.is_active
  and (
    ad.location_id is distinct from location.id
    or ad.role_id is distinct from role.id
    or ad.route_status is distinct from 'mapped'
  );

insert into public.recruitment_lead_history (
  company_id,
  lead_id,
  event_type,
  field_name,
  old_value,
  new_value,
  remarks,
  actor_email,
  metadata
)
select
  lead.company_id,
  lead.id,
  'routing_remap',
  'location_role',
  concat(coalesce(lead.location_id::text, 'unmapped'), '|', coalesce(lead.role_id::text, 'unmapped')),
  concat(location.code, '|', role.code),
  'Re-routed from the current station ad code after the VEND designation was added to the master.',
  'system:migration',
  jsonb_build_object(
    'ad_id', ad.id,
    'ad_name', ad.ad_name,
    'source_of_truth', 'ad_name',
    'designation_code', 'VEND'
  )
from public.recruitment_leads lead
join public.recruitment_ads ad
  on ad.company_id = lead.company_id
 and ad.id = lead.ad_id
join public.recruitment_locations location
  on location.id = ad.location_id
join public.recruitment_roles role
  on role.id = ad.role_id
where upper(split_part(ad.ad_name, '_', 2)) = 'VEND'
  and role.code = 'VEND'
  and (
    lead.location_id is distinct from location.id
    or lead.role_id is distinct from role.id
    or lead.stream is distinct from 'workforce'::public.recruitment_stream
    or lead.status = 'unmapped'
  );

update public.recruitment_leads lead
set
  location_id = ad.location_id,
  role_id = ad.role_id,
  stream = 'workforce'::public.recruitment_stream,
  status = case when lead.status = 'unmapped' then '' else lead.status end,
  updated_at = now()
from public.recruitment_ads ad,
     public.recruitment_roles role
where ad.company_id = lead.company_id
  and ad.id = lead.ad_id
  and role.company_id = ad.company_id
  and role.id = ad.role_id
  and upper(split_part(ad.ad_name, '_', 2)) = 'VEND'
  and role.code = 'VEND'
  and (
    lead.location_id is distinct from ad.location_id
    or lead.role_id is distinct from ad.role_id
    or lead.stream is distinct from 'workforce'::public.recruitment_stream
    or lead.status = 'unmapped'
  );

insert into public.recruitment_connection_audit (
  company_id,
  provider,
  action,
  changed_fields,
  outcome,
  message,
  actor_email
)
select
  role.company_id,
  'masters',
  'designation_saved',
  array['name', 'workspace', 'aliases', 'required_fields', 'active'],
  'success',
  'workforce designation VEND · Vendor enabled and existing station VEND applications remapped.',
  'system:migration'
from public.recruitment_roles role
where role.code = 'VEND'
  and role.stream = 'workforce'::public.recruitment_stream
  and exists (
    select 1
    from public.recruitment_ads ad
    where ad.company_id = role.company_id
      and upper(split_part(ad.ad_name, '_', 2)) = 'VEND'
  )
  and not exists (
    select 1
    from public.recruitment_connection_audit audit
    where audit.company_id = role.company_id
      and audit.provider = 'masters'
      and audit.action = 'designation_saved'
      and audit.actor_email = 'system:migration'
      and audit.message = 'workforce designation VEND · Vendor enabled and existing station VEND applications remapped.'
  );

commit;
