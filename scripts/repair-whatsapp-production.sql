-- Repair production gaps blocking Workforce WhatsApp interview automation.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE.

alter table public.recruitment_whatsapp_outbox
  add column if not exists notification_trigger text,
  add column if not exists recruitment_stream text,
  add column if not exists notification_context jsonb not null default '{}'::jsonb;

create index if not exists recruitment_whatsapp_outbox_trigger_status_idx
  on public.recruitment_whatsapp_outbox(company_id, notification_trigger, status, created_at desc);

create index if not exists recruitment_whatsapp_outbox_lead_timeline_idx
  on public.recruitment_whatsapp_outbox(company_id, lead_id, created_at desc);

create or replace function public.recruitment_get_connection_config(
  p_company_id uuid,
  p_provider text
)
returns table(
  is_enabled boolean,
  public_config jsonb,
  secrets jsonb
)
language sql
security definer
set search_path = public, vault
as $$
  select
    settings.is_enabled,
    settings.public_config,
    coalesce((
      select jsonb_object_agg(secret_pair.key, decrypted.decrypted_secret)
      from jsonb_each_text(settings.secret_ids) secret_pair
      join vault.decrypted_secrets decrypted on decrypted.id = secret_pair.value::uuid
    ), '{}'::jsonb)
  from public.recruitment_connection_settings settings
  where settings.company_id = p_company_id
    and settings.provider = p_provider
  limit 1;
$$;

revoke all on function public.recruitment_get_connection_config(uuid, text) from public, anon, authenticated;
grant execute on function public.recruitment_get_connection_config(uuid, text) to service_role;

notify pgrst, 'reload schema';
