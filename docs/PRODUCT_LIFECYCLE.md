# DropX Recruitment — Product Lifecycle

## 1. Product boundary

DropX Recruitment is a separate recruitment product for:

- `workforce`: DA, Picker, SSA, WM, Driver, DCD, ODCD, VAN and related high-volume roles.
- `hr`: Recruiter, Team Leader, Shift Incharge, Store/Station/Hub Manager, Cluster Manager and other white-collar roles.

The owner can access both streams and every location. Other users receive an explicit stream, role and location scope. Access is never inferred from the selected screen or a client-side filter.

The existing Apps Script and Google Sheets system remains authoritative during migration. It is not removed or changed until the reconciliation and cutover gates pass.

## 2. Sources and ownership

| Source | Purpose during migration | Long-term ownership |
| --- | --- | --- |
| Meta Lead Ads webhook | New lead creation | Primary real-time source |
| Meta Graph API | Lead, ad, form and campaign enrichment | Primary enrichment source |
| `DROPX LEADS` workbook | Historic raw Meta pages and migration cross-check | Read-only archive after cutover |
| `DropX Leads System` workbook | Current lead state, users, stations, job types, attempts, updates and WhatsApp logs | Read-only archive after cutover |
| Supabase | Normalized leads, workflow, masters, access, source events and audit history | Primary operational database |
| WhatsApp Cloud API | OTP and recruitment notifications | Outbound messaging provider |

## 3. Lead identity and duplicate policy

Identity is resolved in this order:

1. Meta `leadgen_id` within the DropX company.
2. Normalized Indian mobile number plus job-role/ad context for non-Meta imports.
3. A deterministic source-event key for rows without a usable lead ID or phone.

Every incoming payload is stored once in `recruitment_lead_source_events`, even when it resolves to an existing lead. The dashboard displays one canonical lead, increments `duplicate_count`, and preserves all source events. Duplicate ingestion never overwrites a newer recruiter update.

## 4. Routing rules

`ad_name` is the authoritative routing field.

1. Parse the station/location code and job-type code from `ad_name`.
2. Match aliases from active location and role masters.
3. Determine `workforce` or `hr` from the matched job role.
4. Store campaign and ad-set names as metadata only.
5. If routing is ambiguous, keep the lead visible in the owner/admin `Unmapped` queue.
6. Never silently drop a lead because campaign, ad set, form or source-tab names differ.

## 5. Lead state machine

### Intake states

- `new`: Valid unique lead, not yet contacted.
- `unmapped`: Lead is preserved but location or role needs mapping.
- `duplicate`: Source occurrence is attached to an existing canonical lead; it is not shown as a second lead.
- `invalid`: Payload is preserved but lacks minimum contact data.

### Working states

- `assigned`
- `contacting`
- `no_response`
- `call_back`
- `interested`
- `not_interested`
- `not_fit`
- `long_distance`
- `wrong_number`

### Interview states

- `interview_scheduled`
- `interview_rescheduled`
- `interview_completed`
- `interview_no_show`
- `selected`
- `hold`
- `rejected`

### Outcome states

- `documents_pending`
- `offer_pending`
- `offered`
- `joined`
- `did_not_join`
- `closed`
- `archived`

Only configured transitions are permitted. Every transition writes `recruitment_lead_history` with actor, timestamp, previous state, new state, remarks and source device.

## 6. Operational lifecycle

1. **Receive** — Verify webhook signature and store the raw event idempotently.
2. **Enrich** — Fetch Meta lead fields and ad metadata with bounded retry/backoff.
3. **Validate** — Normalize name, phone, email and timestamps; preserve all unrecognized answers in `questionnaire`.
4. **Deduplicate** — Resolve canonical identity without losing source occurrences.
5. **Route** — Use ad name to map stream, location and job role.
6. **Assign** — Auto-assign by configured rule or place in the scoped unassigned queue.
7. **Notify** — Queue approved WhatsApp templates through an idempotent outbox.
8. **Contact** — Record every attempt; no-response and callback counters are append-only facts.
9. **Interview** — Schedule, remind, reschedule and record the outcome.
10. **Select** — Collect required role-specific fields and documents.
11. **Join/close** — Record the final disposition without deleting history.
12. **Archive** — Hide closed records from default operational queues while retaining search and audit access.

## 7. SLA rules

- A new routed lead enters the pending queue immediately.
- `24h+ pending` means no qualifying contact outcome within 24 hours of `lead_created_at`.
- Callback SLA is calculated from `callback_at`, not the last-updated timestamp.
- Interview reminders are derived from the scheduled interview time.
- SLA calculations use `Asia/Kolkata` for display and UTC for storage.
- Retries or duplicate source events never reset an existing lead's SLA clock.

## 8. Access model

Access is the intersection of:

- active DropX profile;
- active recruitment access record;
- allowed stream (`workforce`, `hr`, or both);
- allowed locations, unless `all locations`;
- allowed job roles, unless unrestricted for the stream;
- capability flags for masters, ads and users.

Owners have both streams, all locations and all management capabilities. API responses are filtered server-side. Web and Flutter use identical session and authorization checks.

## 9. Menus and responsibilities

- **Dashboard** — Source-backed KPI cards, workload queues, trend and freshness.
- **All Leads** — Server-side search, filters, pagination, assignment and status updates.
- **No Response / Call Back** — Attempt and due-date queues.
- **Interviews** — Schedule, calendar/list, reminders and outcomes.
- **Reports** — Funnel, source/ad, location, role, recruiter, SLA and joining analysis.
- **Active Ads** — Meta status, lead count, spend, CPL, mapping and authorized requests.
- **Masters** — Locations, job roles, aliases, status reasons, templates and routing rules.
- **Team & Access** — Registered mobile/email identity, stream, locations, roles and capability flags.
- **Unmapped** — Owner/admin remediation queue for leads and ads that cannot be safely routed.
- **Audit** — Source events, field changes, attempts, notifications, imports and user actions.

## 10. WhatsApp lifecycle

All outbound messages are inserted into an idempotent outbox first.

1. Create queued message with a deterministic idempotency key.
2. Worker sends the approved template.
3. Store provider message ID and response.
4. Webhook updates sent/delivered/read/failed state.
5. Retry transient failures with capped exponential backoff.
6. Never retry permanent template, recipient or permission errors automatically.

OTP messages are separate from recruitment notifications. OTPs expire in five minutes, allow five attempts, are rate-limited, stored only as keyed hashes and are invalidated after successful use.

## 11. Migration and cutover

### Backfill

1. Import masters and users.
2. Import canonical LeadsDB rows.
3. Import attempts, update history, WhatsApp history and archived leads.
4. Import raw Meta sheets as source occurrences.
5. Reconcile totals by source sheet, ad name, role, station, status and normalized phone.

### Shadow operation

- Meta events are written to Supabase while the old system remains active.
- New records are compared with Sheets at fixed checkpoints.
- Recruiter updates remain in the old system until two-way update safety is proven or a formal cutover starts.

### Production gates

- No unexplained missing canonical leads.
- Duplicate policy validated, including `SBPD_RC`.
- Status, attempts, assignments and WhatsApp history reconcile.
- Owner, HR and Workforce access tests pass.
- Meta webhook and retry tests pass.
- P95 common API response meets the agreed performance target.
- Backup and rollback procedures are verified.

Only then:

1. Attach `recruit.dropxlogistics.com`.
2. Switch Meta webhook to the production endpoint.
3. Move operational updates to the new product.
4. Keep Sheets read-only for the agreed observation period.
5. Retire the old recruitment module only after written acceptance.

