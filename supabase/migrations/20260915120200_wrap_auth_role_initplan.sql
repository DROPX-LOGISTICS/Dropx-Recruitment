-- Supabase's linter flags bare auth.role() (and auth.uid(), current_setting(), etc.) inside an
-- RLS policy as "auth_rls_initplan": Postgres re-evaluates an unwrapped auth.<fn>() call once per
-- row instead of once per query, because the planner can't prove it's the same value across
-- rows. Wrapping it as (select auth.role()) gives the planner that proof, so it's evaluated once
-- and reused -- same access decision, cheaper per-row cost. These tables are only ever written
-- through the service-role key (supabaseAdmin) from server routes today, never through
-- PostgREST as an authenticated end-user role in a hot path, so this is a low-priority
-- correctness-neutral hygiene fix, not a response to any measured slowdown.
--
-- Each policy is dropped and recreated under its existing name (not a new one) so this replaces
-- the original definition in place rather than adding a duplicate; `if exists` on the drop makes
-- this safe to re-run.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'field_travel_expense_types', 'field_travel_approval_assignments', 'field_travel_reimbursements',
    'recruitment_manual_punch_reasons', 'recruitment_manual_punch_decisions',
    'recruitment_job_requisitions', 'recruitment_applications',
    'recruitment_ai_screening_results', 'recruitment_requisition_events'
  ] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = table_name) then
      execute format('drop policy if exists %I on public.%I', 'service_role_'||table_name||'_all', table_name);
      execute format(
        'create policy %I on public.%I for all using ((select auth.role()) = ''service_role'') with check ((select auth.role()) = ''service_role'')',
        'service_role_'||table_name||'_all', table_name
      );
    end if;
  end loop;
end $$;

notify pgrst,'reload schema';
