# DropX Recruitment

Separate recruitment platform for `recruit.dropxlogistics.com`.

## Workstreams

- Workforce: DA, Picker, VAN, ODCD, DCD, SSA and related roles.
- HR: Recruiter, Team Leader, Station Manager, Cluster Manager and related roles.
- Owner: both streams and every location.

## Meta-first delivery order

1. Apply the recruitment Supabase migration.
2. Configure rotated Meta credentials and `leads_retrieval`.
3. Deploy the webhook endpoint.
4. Verify the callback in Meta.
5. Send a Meta test lead and reconcile its raw event, route and canonical lead.
6. Backfill Google Sheets in shadow mode.
7. Build and verify complete UI/workflow parity.

The current Sheets and Apps Script deployment remain production until final
reconciliation and explicit cutover approval.
