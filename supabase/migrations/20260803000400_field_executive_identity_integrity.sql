begin;

-- Workforce onboarding uses one canonical profile per company, mobile and email.
-- The migration intentionally fails if historic duplicates remain; production
-- cleanup is performed separately after dependency verification.
create unique index if not exists field_executives_company_mobile_identity_unique
  on public.field_executives (
    company_id,
    right(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), 10)
  );

create unique index if not exists field_executives_company_email_identity_unique
  on public.field_executives (company_id, lower(btrim(email)));

create unique index if not exists field_executives_company_biometric_identity_unique
  on public.field_executives (company_id, biometric_id)
  where biometric_id is not null and btrim(biometric_id) <> '';

alter table public.field_executives
  drop constraint if exists field_executives_biometric_six_digits_check;

alter table public.field_executives
  add constraint field_executives_biometric_six_digits_check
  check (biometric_id is null or biometric_id ~ '^[0-9]{6}$');

-- The approved welcome template labels body variable 3 as Biometric ID.
update public.whatsapp_notification_configs
set variable_mappings = jsonb_set(
      coalesce(variable_mappings, '{}'::jsonb),
      '{body.3}',
      '"biometric_id"'::jsonb,
      true
    ),
    updated_at = now()
where event_code = 'field_executive_onboarding'
  and template_name = 'dropxone_welcome_message'
  and coalesce(variable_mappings ->> 'body.3', '') = 'mobile';

commit;
