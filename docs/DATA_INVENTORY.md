# Migration Data Inventory

Snapshot inspected: 28 July 2026, Asia/Kolkata.

## Meta source workbook

- Spreadsheet: `DROPX LEADS`
- ID: `1eJtkCqgUCRVWHWFGcgODGqP2OladhrY7HuTP8MDOAT0`
- Tabs: 63
- Examples of mirrored/duplicate-looking tabs that must be reconciled by lead ID, not discarded by tab name:
  - `RECRUITER` and `RECRUITER (2)`
  - `ODCD` and `ODCD (2)`
  - `STATIONMGR` and `STATIONMGR1`
  - `TL1` and `TL1 (2)`

## Operational workbook

- Spreadsheet: `DropX Leads System`
- ID: `1TQK61by7duJ0dpkoAlQbBC75OBKQzynaEsQNAJClPIk`
- `LeadsDB`: 17,955 grid rows, 109 columns
- `WhatsAppLog`: 48,851 grid rows, 7 columns
- `UpdateLog`: 23,600 grid rows, 7 columns
- `SyncLog`: 241,444 grid rows, 5 columns
- Other operational tabs: Users, Stations, JobTypes, LeadAttempts, LeadsArchive, ActiveAds, MetaApiLog, AdRequests, AdStopRequests, AdBudgetRequests, StationContacts and CleanupReport.

## Current master counts from bounded live reads

- Stations: 51 visible records plus header in the inspected range.
- Job types: 23 records plus header.
- Users: at least 24 visible records in the first bounded read; full migration must page through the populated range.

## Authoritative migration rules

- `LeadsDB.lead_id` controls Meta lead identity.
- `LeadsDB.ad_name` controls routing.
- `duplicate_key` and normalized phone assist non-Meta reconciliation.
- `call_status`, `final_status`, timestamps and counters must be preserved independently.
- All 109 lead fields are mapped to normalized columns or retained in `questionnaire`; no populated field is silently dropped.
- Raw Meta tabs are imported as source occurrences and reconciled against `LeadsDB`.

