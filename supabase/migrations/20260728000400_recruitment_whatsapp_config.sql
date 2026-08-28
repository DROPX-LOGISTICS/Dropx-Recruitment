begin;

create or replace function public.recruitment_get_whatsapp_config()
returns table(access_token text, phone_number_id text, graph_version text)
language sql
security definer
set search_path = public, vault
as $$
  select
    secret.decrypted_secret,
    settings.phone_number_id,
    coalesce(nullif(settings.graph_api_version,''),'v25.0')
  from public.whatsapp_settings settings
  join vault.decrypted_secrets secret on secret.id=settings.token_secret_id
  where settings.is_enabled
  limit 1;
$$;

revoke all on function public.recruitment_get_whatsapp_config() from public, anon, authenticated;
grant execute on function public.recruitment_get_whatsapp_config() to service_role;

commit;
