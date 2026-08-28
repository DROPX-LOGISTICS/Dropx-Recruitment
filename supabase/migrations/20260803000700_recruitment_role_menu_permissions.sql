begin;

-- Recruitment uses the universal DropX role as its identity source, but keeps
-- portal-specific menu actions in a first-class table.  This removes the
-- previous split authority where navigation read connection JSON while APIs
-- read user-access rows.
create table if not exists public.recruitment_role_menu_permissions (
  company_id uuid not null references public.companies(id) on delete cascade,
  role_id uuid not null references public.user_roles(id) on delete cascade,
  role_code text not null,
  workspace text not null check (workspace in ('workforce', 'hr')),
  menu_id text not null,
  can_view boolean not null default false,
  can_add boolean not null default false,
  can_edit boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, role_id, workspace, menu_id)
);

create index if not exists recruitment_role_menu_permissions_code_idx
  on public.recruitment_role_menu_permissions(company_id, upper(role_code));

alter table public.recruitment_role_menu_permissions enable row level security;
revoke all on public.recruitment_role_menu_permissions from anon, authenticated;

-- Replacing a role matrix is one transaction so users never see a half-saved
-- Workforce/HR permission set.
create or replace function public.recruitment_replace_role_menu_permissions(
  p_company_id uuid,
  p_role_id uuid,
  p_role_code text,
  p_permissions jsonb,
  p_actor_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.user_roles
    where id = p_role_id and is_active = true
  ) then
    raise exception 'Choose an active universal company role.';
  end if;

  delete from public.recruitment_role_menu_permissions
  where company_id = p_company_id and role_id = p_role_id;

  insert into public.recruitment_role_menu_permissions(
    company_id, role_id, role_code, workspace, menu_id,
    can_view, can_add, can_edit, updated_by, updated_at
  )
  select
    p_company_id,
    p_role_id,
    upper(btrim(coalesce(p_role_code, ''))),
    workspace_entry.key,
    menu_entry.key,
    coalesce((menu_entry.value ->> 'view')::boolean, false)
      or coalesce((menu_entry.value ->> 'add')::boolean, false)
      or coalesce((menu_entry.value ->> 'edit')::boolean, false),
    coalesce((menu_entry.value ->> 'add')::boolean, false),
    coalesce((menu_entry.value ->> 'edit')::boolean, false),
    p_actor_profile_id,
    now()
  from jsonb_each(coalesce(p_permissions, '{}'::jsonb)) workspace_entry
  cross join lateral jsonb_each(
    case when jsonb_typeof(workspace_entry.value) = 'object'
      then workspace_entry.value else '{}'::jsonb end
  ) menu_entry
  where workspace_entry.key in ('workforce', 'hr')
    and jsonb_typeof(menu_entry.value) = 'object'
    and (
      coalesce((menu_entry.value ->> 'view')::boolean, false)
      or coalesce((menu_entry.value ->> 'add')::boolean, false)
      or coalesce((menu_entry.value ->> 'edit')::boolean, false)
    );
end;
$$;

revoke all on function public.recruitment_replace_role_menu_permissions(uuid,uuid,text,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.recruitment_replace_role_menu_permissions(uuid,uuid,text,jsonb,uuid)
  to service_role;

commit;
