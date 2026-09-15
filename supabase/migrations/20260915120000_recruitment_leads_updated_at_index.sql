-- recruitment_leads has no index covering updated_at, despite it being filtered on directly by
-- two hot paths: the leads route's `updatedAge` filter (route.ts, gte/lte on updated_at, applied
-- both in the main paginated query and again in the facets full-scan filter) and the dashboard
-- route's "updatedToday"/response-time rollups. Both currently rely on
-- recruitment_leads_queue_idx (company_id, stream, archived, status, lead_created_at desc),
-- which does not help a query filtering by updated_at -- Postgres falls back to a sequential
-- scan for that predicate. As recruitment_leads grows (the same growth pattern that already hit
-- recruitment_lead_history's missing indexes; see
-- 20260914120000_recruitment_lead_history_performance_indexes.sql), this index prevents the same
-- statement_timeout failure mode from recurring here.

-- Originally written with CONCURRENTLY to avoid holding a write lock while the index builds,
-- but Supabase's SQL Editor always wraps a pasted script in a transaction and
-- CREATE INDEX CONCURRENTLY refuses to run inside one (error 25001) -- confirmed by hitting that
-- exact error when applying this migration. Dropped CONCURRENTLY so this runs as pasted; it
-- takes a brief write lock on recruitment_leads for the duration of the build, which is fine at
-- this table's current size (seconds, not minutes).
create index if not exists recruitment_leads_updated_at_idx
  on public.recruitment_leads(company_id, updated_at desc);

analyze public.recruitment_leads;
