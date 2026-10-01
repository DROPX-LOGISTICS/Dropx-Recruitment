-- Allow a manually scheduled, idempotent live-status snapshot to share the
-- recipient's existing monthly DA onboarding thread without changing the
-- regular afternoon/evening schedule.
alter table public.recruitment_da_onboarding_mail_deliveries
  drop constraint if exists recruitment_da_onboarding_mail_deliveries_slot_check;

alter table public.recruitment_da_onboarding_mail_deliveries
  add constraint recruitment_da_onboarding_mail_deliveries_slot_check
  check (slot in ('afternoon','evening','night','sample'));
