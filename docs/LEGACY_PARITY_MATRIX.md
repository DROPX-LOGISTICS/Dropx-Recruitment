# DropX Recruitment — Legacy Parity Matrix

This matrix is the acceptance contract for replacing the Apps Script recruitment dashboard. The legacy system remains untouched until every required item is implemented, reconciled and accepted.

## Evidence reviewed

- Live Apps Script dashboard in the authenticated DropX Chrome profile.
- 4,961-line Apps Script backend supplied by the user.
- 3,108-line HTML/CSS/JavaScript frontend supplied by the user.
- All operational sheets in `DropX Leads System`.
- All source pages in `DROPX LEADS`.

## Dashboard

| Existing behavior | Replacement requirement |
| --- | --- |
| Total, no status, no response, callback, interview, joined and 24h+ cards | Preserve with server-side PostgreSQL counts and scoped access |
| Station and cluster multi-select | Master-driven station/cluster selectors |
| My DA pending, today interviews and 24h pending shortcuts | One-click scoped queues |
| Work queue: no status, retry due, callback due, interview today and 12h/24h/48h no-status | Preserve the exact SLA definitions |
| Designation pendency by station/role and ad state | Preserve mapped role/location/ad relationship |
| Station attention, owners, health score and performance | Preserve score inputs and server-side access scope |
| Status breakdown, hiring visibility and conversion | Preserve and expose in Reports |

## Lead lists and lead profile

| Existing behavior | Replacement requirement |
| --- | --- |
| Search name, phone and city | Search name, phone, email, city and exact ad name |
| Status, station, cluster and role multi-selects | Master-driven server-side filters |
| Fetch button and bounded list | Server pagination; never download the full database |
| Candidate/application fields plus dynamic Meta answers | Structured lead fields plus lossless `questionnaire` JSON |
| Status dropdown | Lifecycle-controlled transition menu |
| Remarks and follow-up/interview date | Editable with audit history |
| Assigned user, attempt counts, duplicate count and SLA | Preserve and display |
| Final status, final remarks and work email | Preserve and display |
| Automatic archive after five No Response attempts | Preserve as a configured workflow rule |

## WhatsApp triggers

| Trigger | Legacy template | Parameters |
| --- | --- | --- |
| New unique lead appended | `job_application_number` | candidate name, role, station POC mobile, station address |
| Status changed/retried to No Response | `job_application_reminder` | candidate name, role, applicant phone, station POC |
| Interview scheduled or interview date changed | `job_location_share` | candidate name, station address, Google Maps link, station POC |
| Interview due today and reminder not previously sent | `job_location_share` | same interview-location parameters |

All messages must enter an idempotent outbox before provider delivery. Provider response, message ID, sent/delivered/read/failed state and errors remain auditable. Callback currently has no mapped legacy template and must not be sent using an unrelated template.

## Active Ads and requests

- Search/filter by status, station, cluster and role.
- Sort by spend, budget, leads, created time, ad name or station.
- Show active/paused state, spend, daily budget, reach, lead count and poster.
- Request a new ad with role, station, daily budget, number of days, poster link, payment offer, location details and notes.
- HR/admin request queue with approval remarks.
- Budget-change and stop-ad requests.
- Direct Meta actions only after permissions and authorization are proven; no silent local-only state changes.
- Ad naming SOP: `STATIONCODE_JOBCODE`.

## Masters

- Locations/stations: code, name, state, region, cluster and active state.
- Station contacts: address, coordinates/map link, POC name and POC mobile.
- Roles/designations: code, name, Workforce/HR stream, application fields, ad format and visibility rules.
- Users: mobile, email, role, stream, station/cluster/location scope and capability flags.
- Status/reason rules, WhatsApp template mapping and routing aliases.
- Owners can access both streams and all locations; Workforce and HR users are server-scoped.

## Reports

- Lead data export.
- Interview schedule.
- Spend analysis and CPL/CPI/cost per joined.
- Daily/weekly/monthly ad and lead spend.
- Daily lead generation.
- No-status aging.
- Designation pendency.
- Lead quality.
- No Response/Callback effort.
- User attempt summary.

Filters include lead date, last-updated date, interview date, status, no-status age, spend dates, station, cluster, designation and ad status. XLSX is the canonical export; XLS remains compatibility-only.

## Migration evidence targets

- Canonical leads and source occurrences.
- Update history.
- Attempt history.
- WhatsApp provider history.
- Station contacts.
- Active ads and all request types.
- Users/access, locations and roles.
- Counts reconciled by ad name, sheet, station, role, status and normalized phone.

## Cutover rule

The Apps Script and Sheets system remains operational and unchanged until:

1. all parity requirements above are implemented;
2. Meta and WhatsApp provider tests pass;
3. owner, Workforce and HR access tests pass;
4. data totals reconcile with no unexplained loss;
5. web and installable Flutter builds pass acceptance;
6. DropX gives explicit cutover approval.

## Verified legacy interaction inventory

This inventory was derived from the live authenticated dashboard plus the supplied
4,961-line Apps Script backend and 3,108-line HTML client. It is the page-by-page
acceptance checklist; a menu name alone does not count as parity.

### Dashboard

- Clickable cards: Total Leads, No Status, No Response, Call Back, Interviews,
  Joined and 24h+ Pending.
- Global multi-select filters: station, cluster and designation.
- Saved views: My DA pending, Today interviews and 24h pending.
- Work queues include no status, no-response retry due, callback due,
  interviews today and escalations.
- Diagnostic sections include designation pendency, station attention, status
  breakdown, hiring visibility, owners, station health and performance.
- 24h pending is limited to blank/No Response/Call Back and is based on received
  time, not simply the current status update time.

### All Leads

- Search: candidate name, phone, city, station code and station name.
- Multi-selects: status, station, cluster and role.
- Explicit Fetch Leads action and bounded result set.
- Lead card/profile: core candidate fields, every dynamic Meta question,
  station/role/ad, status, final status, remarks, callback/interview date,
  assigned user, source count, attempt counts, SLA and timeline.

### No Response / Call Back

- Search plus station, cluster and designation multi-selects.
- Updated-age multi-select values: never, under 30 minutes, 60+ minutes,
  120+ minutes, 24h+ and two days+.
- No Response becomes retry-due after five minutes.
- Callback becomes due at the callback/follow-up timestamp.
- A fifth No Response attempt archives the lead.

### Interviews

- Search plus station, cluster, designation, interview-date and final-status
  filters.
- “All Dates” clears only the date while preserving other filters.
- Profile update supports interview date, final status, final remarks and work
  email, with every change appended to the timeline.

### Reports

Exact report choices:

1. Lead Data
2. Interview Scheduled
3. Spend Analysis
4. Ad + Lead Spend by Day / Week / Month
5. Daily Lead Generation
6. No Status Leads
7. Designation Pendency
8. Lead Quality
9. No Response / Call Back Effort
10. User Attempt Summary

Exact filter surface: added-from/to, last-updated-from/to,
interview-from/to, status, no-status age (12h/24h/48h), spend-from/to,
station, cluster, designation and ad status (running/paused/no running ad).
Exports support XLSX canonically and XLS for compatibility.

### Active Ads and requests

- Search by ad/station/role.
- Multi-select filters: ad status, station, cluster and role.
- Sort: spend, budget, leads, newest, ad name and station.
- Ad cards include status, spend, budget, leads, poster and Meta sync state.
- Actions: request budget change, request stop, view poster and, when Meta
  authorization allows it, direct status/budget actions.
- New-ad request fields: role, station, budget/day, days, Drive poster link,
  payment offer, location details and notes.
- Ad naming contract: `STATIONCODE_JOBCODE`.

### Team and station contacts

- Team access is sourced from the Users master, with role plus
  station/cluster/state and designation visibility.
- Station Contacts is limited by administrator/RM access and supports station
  search plus POC name, POC mobile, address and coordinates.
- Location and designation access must be applied server-side to counts, lists,
  profiles, reports and exports—not only hidden in the interface.

## Workforce and HR categorization

### Workforce (blue-collar/ground hiring)

`DA`, `PC`, `SSA`, `PTSSA`, `WM`, `DCD`, `DR`, `ODCD`, `PTDA`, `PTPC`,
`VAN`, `IHS`, and `STORE`.

### HR (white-collar/management and recruitment)

`TL`, `SI`, `SM`, `HI`, `CLM`, `STM`, `HMT`, `HR`, `TC`, and `RC`.

The designation master owns this classification. Ad names are validated against
the master by ad name; campaign and ad-set names remain descriptive and never
override the designation/station route. Owner access spans both streams. HR and
Workforce users receive only their stream plus their configured geographic and
designation scope.
