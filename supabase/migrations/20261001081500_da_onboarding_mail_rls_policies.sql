-- Keep the mail scheduler tables private while making the intended server-only
-- service-role access explicit to the database advisor.
create policy recruitment_da_onboarding_mail_settings_service_role
  on public.recruitment_da_onboarding_mail_settings
  for all to service_role
  using (true)
  with check (true);

create policy recruitment_da_onboarding_mail_deliveries_service_role
  on public.recruitment_da_onboarding_mail_deliveries
  for all to service_role
  using (true)
  with check (true);
