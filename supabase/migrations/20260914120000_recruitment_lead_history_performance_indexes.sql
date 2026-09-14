-- recruitment_lead_history grew to ~116k rows with no index beyond
-- (company_id, lead_id, created_at). Two query shapes that the app runs on
-- every dashboard/personal-performance load were relying on a full table
-- scan and started exceeding Supabase's statement_timeout once the table
-- reached this size:
--
--   1. attributedHistory() in personal-performance/route.ts issues three
--      `.contains("metadata", {...})` (JSONB containment) queries per call,
--      looking for recruiter_profile_id / telecaller_profile_id /
--      field_recruiter_profile_id inside metadata. JSONB containment needs a
--      GIN index to avoid a sequential scan.
--   2. The same function also filters on `actor_profile_id` directly
--      (`.or("actor_profile_id.eq...")`), which had no supporting index.
--
-- Both symptoms reproduce as Postgres error 57014 "canceling statement due
-- to statement timeout", which is what surfaced as the 500 on
-- /api/recruitment/personal-performance (and, under concurrent load from the
-- same slow queries, on /api/recruitment/leads too).

-- CONCURRENTLY avoids holding a write lock on recruitment_lead_history while
-- the index builds, since this table takes inserts continuously in
-- production. It cannot run inside a transaction block, so if you are
-- applying this through a tool that wraps migrations in a transaction
-- (Supabase CLI `db push` does), run this file's statements directly in the
-- Supabase SQL Editor instead, one at a time.
create index concurrently if not exists recruitment_lead_history_metadata_gin_idx
  on public.recruitment_lead_history using gin (metadata);

create index concurrently if not exists recruitment_lead_history_actor_idx
  on public.recruitment_lead_history(company_id, actor_profile_id, created_at desc)
  where actor_profile_id is not null;

create index concurrently if not exists recruitment_lead_history_actor_email_idx
  on public.recruitment_lead_history(company_id, actor_email, created_at desc)
  where actor_email is not null;

create index concurrently if not exists recruitment_lead_history_event_type_idx
  on public.recruitment_lead_history(company_id, event_type, created_at desc);

analyze public.recruitment_lead_history;
