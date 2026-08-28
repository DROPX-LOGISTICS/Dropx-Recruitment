begin;

create table if not exists public.recruitment_connection_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('meta','whatsapp','google','mobile')),
  is_enabled boolean not null default false,
  public_config jsonb not null default '{}'::jsonb,
  secret_ids jsonb not null default '{}'::jsonb,
  connection_status text not null default 'not_tested'
    check (connection_status in ('not_tested','connected','warning','failed')),
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, provider)
);

create table if not exists public.recruitment_connection_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  action text not null,
  changed_fields text[] not null default '{}',
  outcome text not null default 'success',
  message text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists recruitment_connection_audit_company_idx
  on public.recruitment_connection_audit(company_id, created_at desc);

alter table public.recruitment_connection_settings enable row level security;
alter table public.recruitment_connection_audit enable row level security;
revoke all on public.recruitment_connection_settings from anon, authenticated;
revoke all on public.recruitment_connection_audit from anon, authenticated;

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
    values ('meta'::text), ('whatsapp'::text), ('google'::text), ('mobile'::text)
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
  order by providers.provider;
$$;

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
  if p_provider not in ('meta','whatsapp','google','mobile') then
    raise exception 'Unsupported connection provider';
  end if;

  allowed_keys := case p_provider
    when 'meta' then array['access_token','app_secret','verify_token']
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

create or replace function public.recruitment_update_connection_health(
  p_company_id uuid,
  p_provider text,
  p_status text,
  p_message text,
  p_actor_profile_id uuid,
  p_actor_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('connected','warning','failed') then
    raise exception 'Unsupported connection status';
  end if;

  update public.recruitment_connection_settings
  set
    connection_status = p_status,
    last_tested_at = now(),
    last_success_at = case when p_status = 'connected' then now() else last_success_at end,
    last_error = case when p_status = 'connected' then null else left(p_message, 1000) end,
    updated_by = p_actor_profile_id,
    updated_by_email = nullif(btrim(p_actor_email), ''),
    updated_at = now()
  where company_id = p_company_id and provider = p_provider;

  insert into public.recruitment_connection_audit(
    company_id, provider, action, changed_fields, outcome, message,
    actor_profile_id, actor_email
  )
  values(
    p_company_id, p_provider, 'connection_tested', array['connection_status'],
    p_status, left(p_message, 1000), p_actor_profile_id, nullif(btrim(p_actor_email), '')
  );
end;
$$;

revoke all on function public.recruitment_list_connection_settings(uuid) from public, anon, authenticated;
revoke all on function public.recruitment_get_connection_config(uuid, text) from public, anon, authenticated;
revoke all on function public.recruitment_save_connection_setting(uuid, text, boolean, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.recruitment_update_connection_health(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.recruitment_list_connection_settings(uuid) to service_role;
grant execute on function public.recruitment_get_connection_config(uuid, text) to service_role;
grant execute on function public.recruitment_save_connection_setting(uuid, text, boolean, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.recruitment_update_connection_health(uuid, text, text, text, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
