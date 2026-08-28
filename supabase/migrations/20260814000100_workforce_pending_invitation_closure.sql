-- Audited soft closure for Workforce invitations that were never submitted.
-- This deliberately preserves the profile, reserved IDs and full event trail.

create table if not exists public.workforce_invitation_close_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null check (category in ('business', 'candidate', 'no_response')),
  code text not null,
  label text not null,
  description text,
  comment_required boolean not null default false,
  display_order integer not null default 100 check (display_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_invitation_close_reason_code_format
    check (code = upper(code) and code ~ '^[A-Z0-9_]+$'),
  constraint workforce_invitation_close_reason_company_code_key unique (company_id, code)
);

create index if not exists workforce_invitation_close_reason_active_idx
  on public.workforce_invitation_close_reasons(company_id, category, display_order)
  where is_active = true;

alter table public.workforce_invitation_close_reasons enable row level security;
revoke all on table public.workforce_invitation_close_reasons from anon, authenticated;

insert into public.workforce_invitation_close_reasons
  (company_id, category, code, label, description, comment_required, display_order)
select company.id, seed.category, seed.code, seed.label, seed.description, seed.comment_required, seed.display_order
from public.companies company
cross join (values
  ('business', 'REQUIREMENT_WITHDRAWN', 'Workforce requirement withdrawn', 'The role or headcount is no longer required.', false, 10),
  ('business', 'ROLE_OR_LOCATION_CHANGED', 'Role or location requirement changed', 'The original station, role or deployment plan changed.', false, 20),
  ('business', 'DUPLICATE_OR_TEST_PROFILE', 'Duplicate or test invitation', 'The invitation was created for testing or duplicates another profile.', true, 30),
  ('business', 'ELIGIBILITY_NOT_MET', 'Current requirement not met', 'The candidate does not meet the present operational requirement.', true, 40),
  ('candidate', 'COMPENSATION_NOT_ACCEPTED', 'Compensation or rate card not accepted', 'The candidate did not accept the offered pay or rate card.', false, 110),
  ('candidate', 'CANDIDATE_WITHDREW', 'Candidate withdrew', 'The candidate chose not to continue registration.', false, 120),
  ('candidate', 'JOINING_PLAN_CHANGED', 'Candidate joining plan changed', 'The candidate is no longer available on the planned date or location.', false, 130),
  ('no_response', 'UNREACHABLE_AFTER_FOLLOW_UP', 'Unable to reach after follow-ups', 'The candidate did not respond after reasonable follow-up attempts.', false, 210),
  ('no_response', 'REGISTRATION_NOT_COMPLETED', 'Registration not completed', 'The candidate did not complete the invited registration.', false, 220),
  ('no_response', 'INVITATION_ABANDONED', 'Invitation abandoned', 'The candidate opened or received the invitation but did not continue.', false, 230),
  ('candidate', 'OTHER', 'Other candidate reason', 'Use when none of the configured candidate reasons apply.', true, 190)
) as seed(category, code, label, description, comment_required, display_order)
on conflict (company_id, code) do update set
  category = excluded.category,
  label = excluded.label,
  description = excluded.description,
  comment_required = excluded.comment_required,
  display_order = excluded.display_order,
  updated_at = now();

create or replace function public.close_pending_workforce_invitation(
  p_company_id uuid,
  p_field_executive_id uuid,
  p_actor_id uuid,
  p_category text,
  p_reason_code text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.field_executives%rowtype;
  v_reason public.workforce_invitation_close_reasons%rowtype;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_now timestamptz := now();
  v_remarks text;
begin
  if p_company_id is null or p_field_executive_id is null or p_actor_id is null then
    raise exception 'Company, invitation and acting user are required.';
  end if;

  select * into v_target
  from public.field_executives
  where company_id = p_company_id and id = p_field_executive_id
  for update;

  if not found then
    raise exception 'Workforce invitation was not found.';
  end if;
  if coalesce(v_target.is_active, false)
     or lower(coalesce(v_target.onboarding_status, '')) <> 'pending'
     or v_target.onboarding_submitted_at is not null then
    raise exception 'Only an incomplete, unsubmitted pending invitation can be closed.';
  end if;

  select * into v_reason
  from public.workforce_invitation_close_reasons
  where company_id = p_company_id
    and category = lower(trim(p_category))
    and code = upper(trim(p_reason_code))
    and is_active = true;

  if not found then
    raise exception 'Choose an active closure reason.';
  end if;
  if v_reason.comment_required and length(coalesce(v_notes, '')) < 5 then
    raise exception 'Add a short note for the selected reason.';
  end if;

  v_remarks := v_reason.label || case when v_notes is null then '' else ': ' || v_notes end;

  update public.field_executives set
    onboarding_status = 'cancelled',
    is_active = false,
    onboarding_token_hash = null,
    onboarding_token_expires_at = null,
    onboarding_reviewed_at = v_now,
    onboarding_reviewed_by = p_actor_id,
    onboarding_review_remarks = v_remarks,
    updated_at = v_now
  where id = p_field_executive_id and company_id = p_company_id;

  update public.workforce_profile_change_requests set
    status = 'rejected',
    reviewed_by = p_actor_id,
    review_note = 'Invitation closed before registration was submitted.',
    reviewed_at = v_now,
    updated_at = v_now
  where company_id = p_company_id
    and field_executive_id = p_field_executive_id
    and status = 'pending';

  insert into public.workforce_onboarding_events (
    company_id, field_executive_id, event_code, from_status, to_status,
    actor_user_id, source_portal, remarks, metadata
  ) values (
    p_company_id, p_field_executive_id, 'invitation_cancelled', 'pending', 'cancelled',
    p_actor_id, 'recruit', v_remarks,
    jsonb_build_object(
      'decision_category', v_reason.category,
      'reason_code', v_reason.code,
      'reason_label', v_reason.label,
      'notes', v_notes,
      'initiated_by', v_target.created_by,
      'registration_submitted', false
    )
  );

  if v_target.recruitment_lead_id is not null then
    insert into public.recruitment_lead_history (
      company_id, lead_id, event_type, field_name, old_value, new_value,
      remarks, actor_profile_id, metadata
    ) values (
      p_company_id, v_target.recruitment_lead_id, 'workforce_invitation_cancelled',
      'onboarding_status', 'pending', 'cancelled', v_remarks, p_actor_id,
      jsonb_build_object(
        'field_executive_id', p_field_executive_id,
        'decision_category', v_reason.category,
        'reason_code', v_reason.code,
        'reason_label', v_reason.label
      )
    );
  end if;

  return jsonb_build_object(
    'id', p_field_executive_id,
    'status', 'cancelled',
    'category', v_reason.category,
    'reasonCode', v_reason.code,
    'reasonLabel', v_reason.label,
    'closedAt', v_now
  );
end;
$$;

revoke all on function public.close_pending_workforce_invitation(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.close_pending_workforce_invitation(uuid, uuid, uuid, text, text, text) to service_role;

comment on table public.workforce_invitation_close_reasons is
  'Company-scoped master reasons for audited closure of unsubmitted Workforce invitations.';
comment on function public.close_pending_workforce_invitation(uuid, uuid, uuid, text, text, text) is
  'Atomically soft-closes one unsubmitted Workforce invitation and writes its immutable onboarding event.';
