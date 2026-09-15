-- dashboard/route.ts's summary mode fires 8 separate `count: "exact", head: true` queries in
-- parallel (via Promise.all) on every dashboard-summary load -- one for the grand total and one
-- each for noStatus/noResponse/callBack/interviews/joined/pending24h/unmapped, all filtered
-- subsets of the exact same base query. Each `count: "exact"` forces Postgres to do a real count
-- scan, so this is 8x the counting work of a single pass over the same rows. This RPC computes
-- all eight in one query using conditional aggregates (`count(*) filter (where ...)`), so
-- Postgres only has to scan the matching rows once.
--
-- Deliberately takes only the ALREADY-RESOLVED filter values (location/role id arrays, or null
-- to mean "no restriction on this dimension") rather than re-deriving any permission decision in
-- SQL -- hasFullLeadAccess()/canUseRecruitmentMenu() in recruitment-api.ts stay the single source
-- of truth for who can see what; this function only ever receives the final scope the app layer
-- already decided on, exactly mirroring what applyLeadScope() does today when building the
-- Supabase query. Passing a non-null empty array for either id parameter is deliberately treated
-- the same as the app's existing hasEmptyFilter short-circuit (a scope resolved to nothing
-- matches nothing) rather than being ignored as "no restriction".
create or replace function public.recruitment_dashboard_summary_counts(
  p_company_id uuid,
  p_stream public.recruitment_stream,
  p_scope_location_ids uuid[],   -- null = no restriction on this session's own location scope
  p_scope_role_ids uuid[],       -- null = no restriction on this session's own role scope
  p_filter_location_ids uuid[],  -- null = no station/cluster filter applied; [] = filter matched nothing
  p_filter_role_ids uuid[],      -- null = no role filter applied; [] = filter matched nothing
  p_stale_before timestamptz
)
returns table (
  total bigint,
  no_status bigint,
  no_response bigint,
  call_back bigint,
  interviews bigint,
  joined bigint,
  pending_24h bigint,
  unmapped bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) as total,
    count(*) filter (where status in ('', 'new')) as no_status,
    count(*) filter (where status = 'no_response') as no_response,
    count(*) filter (where status = 'call_back') as call_back,
    count(*) filter (where status like 'interview_%') as interviews,
    count(*) filter (where status = 'joined' or final_status = 'joined') as joined,
    count(*) filter (
      where status in ('', 'new', 'no_response', 'call_back')
        and lead_created_at < p_stale_before
    ) as pending_24h,
    count(*) filter (where location_id is null or role_id is null) as unmapped
  from public.recruitment_leads
  where company_id = p_company_id
    and archived = false
    and (p_stream is null or stream = p_stream)
    and (p_scope_location_ids is null or location_id = any(p_scope_location_ids))
    and (p_scope_role_ids is null or role_id = any(p_scope_role_ids))
    and (p_filter_location_ids is null or location_id = any(p_filter_location_ids))
    and (p_filter_role_ids is null or role_id = any(p_filter_role_ids));
$$;

comment on function public.recruitment_dashboard_summary_counts is
  'Collapses dashboard/route.ts summary mode''s 8 separate count("exact") queries into one scan. Callers must resolve all permission scoping (hasFullLeadAccess/applyLeadScope''s equivalent) before calling this -- it applies no access control of its own beyond the explicit id-array parameters given.';
