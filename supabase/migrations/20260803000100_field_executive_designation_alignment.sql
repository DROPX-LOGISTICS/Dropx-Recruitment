-- Keep the dashboard Designation Master authoritative while aligning existing
-- active Workforce recruitment roles with Field Executive onboarding.
update public.designations as designation
set onboarding_categories = (
  select array_agg(distinct category order by category)
  from unnest(
    coalesce(designation.onboarding_categories, '{}'::text[])
    || array['field_executives']::text[]
  ) as category
)
where designation.is_active = true
  and exists (
    select 1
    from public.recruitment_roles as role
    where role.company_id = designation.company_id
      and role.stream = 'workforce'
      and role.is_active = true
      and (
        lower(btrim(role.code)) = lower(btrim(designation.code))
        or lower(btrim(role.name)) = lower(btrim(designation.name))
      )
  );
