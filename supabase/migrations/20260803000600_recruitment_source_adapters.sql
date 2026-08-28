begin;

alter table public.recruitment_connection_settings
  drop constraint if exists recruitment_connection_settings_provider_check;
alter table public.recruitment_connection_settings
  add constraint recruitment_connection_settings_provider_check
  check (provider in ('meta','indeed','whatsapp','google','mobile'));

create or replace function public.recruitment_list_connection_settings(p_company_id uuid)
returns table(
  provider text,
  is_enabled boolean,
  public_config jsonb,
  configured_secret_keys text[],
  connection_status text,
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_by_email text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with providers(provider) as (
    values
      ('meta'::text),
      ('indeed'::text),
      ('whatsapp'::text),
      ('google'::text),
      ('mobile'::text)
  )
  select
    providers.provider,
    coalesce(settings.is_enabled, false),
    coalesce(settings.public_config, '{}'::jsonb),
    coalesce(array(select jsonb_object_keys(coalesce(settings.secret_ids, '{}'::jsonb))), '{}'::text[]),
    coalesce(settings.connection_status, 'not_tested'),
    settings.last_tested_at,
    settings.last_success_at,
    settings.last_error,
    settings.updated_by_email,
    settings.updated_at
  from providers
  left join public.recruitment_connection_settings settings
    on settings.company_id = p_company_id and settings.provider = providers.provider
  order by array_position(array['meta','indeed','whatsapp','google','mobile'], providers.provider);
$$;

create or replace function public.recruitment_save_connection_setting(
  p_company_id uuid,
  p_provider text,
  p_is_enabled boolean,
  p_public_config jsonb,
  p_secrets jsonb,
  p_actor_profile_id uuid,
  p_actor_email text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  allowed_keys text[];
  current_secret_ids jsonb := '{}'::jsonb;
  next_secret_ids jsonb := '{}'::jsonb;
  secret_pair record;
  secret_id uuid;
  clean_value text;
  changed text[] := array['is_enabled','public_config'];
begin
  if p_provider not in ('meta','indeed','whatsapp','google','mobile') then
    raise exception 'Unsupported connection provider';
  end if;

  allowed_keys := case p_provider
    when 'meta' then array['access_token','page_access_token','app_secret','verify_token']
    when 'indeed' then array['webhook_secret','api_token']
    when 'whatsapp' then array['access_token','app_secret','verify_token']
    when 'google' then array['client_secret']
    when 'mobile' then array['api_token']
    else '{}'::text[]
  end;

  select secret_ids into current_secret_ids
  from public.recruitment_connection_settings
  where company_id = p_company_id and provider = p_provider;
  current_secret_ids := coalesce(current_secret_ids, '{}'::jsonb);
  next_secret_ids := current_secret_ids;

  for secret_pair in select key, value from jsonb_each_text(coalesce(p_secrets, '{}'::jsonb))
  loop
    if not (secret_pair.key = any(allowed_keys)) then
      raise exception 'Unsupported secret field for provider %', p_provider;
    end if;
    clean_value := btrim(secret_pair.value);
    if clean_value = '' then
      continue;
    end if;
    secret_id := nullif(current_secret_ids ->> secret_pair.key, '')::uuid;
    if secret_id is null then
      secret_id := vault.create_secret(
        clean_value,
        concat('recruitment_', p_company_id, '_', p_provider, '_', secret_pair.key),
        concat('DropX Recruitment ', p_provider, ' ', secret_pair.key)
      );
    else
      perform vault.update_secret(
        secret_id,
        clean_value,
        concat('recruitment_', p_company_id, '_', p_provider, '_', secret_pair.key),
        concat('DropX Recruitment ', p_provider, ' ', secret_pair.key)
      );
    end if;
    next_secret_ids := jsonb_set(next_secret_ids, array[secret_pair.key], to_jsonb(secret_id::text), true);
    changed := array_append(changed, secret_pair.key);
  end loop;

  insert into public.recruitment_connection_settings(
    company_id, provider, is_enabled, public_config, secret_ids,
    connection_status, updated_by, updated_by_email, updated_at
  )
  values(
    p_company_id, p_provider, p_is_enabled, coalesce(p_public_config, '{}'::jsonb),
    next_secret_ids, 'not_tested', p_actor_profile_id, nullif(btrim(p_actor_email), ''), now()
  )
  on conflict(company_id, provider) do update set
    is_enabled = excluded.is_enabled,
    public_config = excluded.public_config,
    secret_ids = excluded.secret_ids,
    connection_status = 'not_tested',
    last_error = null,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = now();

  insert into public.recruitment_connection_audit(
    company_id, provider, action, changed_fields, actor_profile_id, actor_email
  )
  values(
    p_company_id, p_provider, 'configuration_saved',
    (select array_agg(distinct field) from unnest(changed) field),
    p_actor_profile_id, nullif(btrim(p_actor_email), '')
  );
end;
$$;

revoke all on function public.recruitment_list_connection_settings(uuid) from public, anon, authenticated;
revoke all on function public.recruitment_save_connection_setting(uuid, text, boolean, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.recruitment_list_connection_settings(uuid) to service_role;
grant execute on function public.recruitment_save_connection_setting(uuid, text, boolean, jsonb, jsonb, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
