begin;

alter table public.recruitment_ad_requests
  drop constraint if exists recruitment_ad_requests_request_type_check;

alter table public.recruitment_ad_requests
  add constraint recruitment_ad_requests_request_type_check
  check (request_type in ('new_ad', 'budget_change', 'stop_ad', 'resume_ad'));

commit;
