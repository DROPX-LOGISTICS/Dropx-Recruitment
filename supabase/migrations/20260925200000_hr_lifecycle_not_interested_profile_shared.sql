-- HR candidate call outcomes: add "Not interested" and "Profile shared".
--
-- Commit b033ef2 added both to the code defaults, but every company already
-- has its own rows in recruitment_hr_lifecycle_rules (checked live on
-- 2026-09-25: 4 companies x 18 statuses, neither code present), and those rows
-- replace the code defaults entirely, so the Recruit call-outcome dropdown
-- never showed them.
--
-- The dropdown lists statuses with first_call_available = true that are an
-- allowed next step from the candidate's current status. This file:
--   1. inserts both statuses for every company that has lifecycle rows,
--      as call outcomes (skipped if a company already has the code);
--   2. appends them to existing allowed_next_codes without replacing any
--      company's own customisation.
--
-- "Not interested": the candidate declined. Terminal, like Not fit/Rejected,
--   and reachable from every active status.
-- "Profile shared": the profile/JD has been shared and the next step is
--   awaited. Reachable from the intake, screening and follow-up statuses.

begin;

insert into public.recruitment_hr_lifecycle_rules (
  company_id, code, label, stage_group, sort_order, is_active, is_terminal,
  requires_remarks, requires_schedule, recruiter_can_set, interviewer_can_set,
  first_call_available, allowed_next_codes, notification_trigger
)
select company.company_id, v.code, v.label, v.stage_group, v.sort_order, true, v.is_terminal,
  true, false, true, false,
  true, v.allowed_next_codes, null
from (select distinct company_id from public.recruitment_hr_lifecycle_rules) company
cross join (values
  ('profile_shared', 'Profile shared', 'screening', 45, false,
    array['screening', 'interview_scheduled', 'call_back', 'no_response', 'hold', 'not_fit', 'not_interested', 'rejected']::text[]),
  ('not_interested', 'Not interested', 'closed', 155, true, array[]::text[])
) as v(code, label, stage_group, sort_order, is_terminal, allowed_next_codes)
on conflict (company_id, code) do nothing;

-- Not interested: next step from every active (non-terminal) status.
update public.recruitment_hr_lifecycle_rules
set allowed_next_codes = allowed_next_codes || array['not_interested']::text[],
    updated_at = now()
where not is_terminal
  and code <> 'not_interested'
  and not ('not_interested' = any(allowed_next_codes));

-- Profile shared: next step from intake, screening and follow-up statuses.
update public.recruitment_hr_lifecycle_rules
set allowed_next_codes = allowed_next_codes || array['profile_shared']::text[],
    updated_at = now()
where code in ('new', 'contacting', 'screening', 'documents_pending', 'no_response', 'call_back', 'hold')
  and not ('profile_shared' = any(allowed_next_codes));

-- Expect 4 rows, each: statuses = 20, has_both = true, active_without_not_interested = 0.
select company_id,
  count(*) as statuses,
  count(*) filter (where code in ('not_interested', 'profile_shared') and first_call_available) = 2 as has_both,
  count(*) filter (where not is_terminal and not ('not_interested' = any(allowed_next_codes)) and code <> 'not_interested') as active_without_not_interested
from public.recruitment_hr_lifecycle_rules
group by company_id
order by company_id;

commit;
