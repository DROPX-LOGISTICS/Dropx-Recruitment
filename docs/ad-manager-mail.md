# Workforce ad reports

Production control: **Active Ads → Workforce reports** (Owner, not View as user).

- One combined operational report runs daily at **13:00 Asia/Kolkata** (`30 7 * * *` UTC), replacing both 08:30 and 20:00. The five-minute delivery window covers execution jitter; per-recipient/date idempotency prevents duplicate sends.
- The email contains **only currently active Workforce ads**: station/store code and name, designation, ad name, configured budget, actual spend today and spend to date. One CTA opens Recruit. No paused/ended lists, lead counts, run-day tables or operational action buttons.
- Meta polling records audit observations only, never emails. Changes are summarized as one net line per currently active ad, from midnight IST up to the report. Repeated observations and budget changes that cancel out are omitted. Historical ads first discovered today are not called new ads.
- Creative tracking uses stable creative/image/video identifiers, not expiring image URLs. Legacy fingerprints establish a new baseline quietly; legacy URL-only poster events are excluded from the summary. A changed URL alone is not evidence of a new poster.
- Every active, mapped recipient receives one direct report containing all and only the stations in their People location scope. WFA and BH profiles are direct recipients, not CC recipients. Active master owners receive all active stations. A person who holds several eligible mappings is deduplicated into one report.
- The combined report has one stable thread per recipient/month. Up to eight approved, size-bounded real creative images are embedded inline. Other ads remain listed with a compact preview placeholder. Recipients with no active ads are skipped.
- Budget comes from Meta campaign/ad-set configuration, labelled shared or lifetime where applicable. Spend to date comes from Meta lifetime insights stored by ingestion (same source as Active Ads); spend today comes from the existing paginated ad-level Meta insights service. Missing/failed spend is **Unavailable**, never budget-derived or silently zero. The snapshot timestamp is included.
- Owner samples use the same combined format, real source data and observed changes, limited to one sample daily. No synthetic budget edits or poster changes are sent.
- Existing sent email and old queues remain auditable. Only current-date compact-format jobs dispatch; legacy morning/evening queues cannot be replayed by the new cron. SMTP acceptance is recorded, not claimed as inbox delivery; uncertain sends require provider-log review before any retry.

Verification covers direct, deduplicated station scope; exact IST schedule windows; compact rendering; activity baselining; queue idempotency; monthly threading; no CC recipients; and SMTP uncertainty. Production checks must confirm the Git-backed Vercel alias, enabled cron, recipient RPC and email-provider acceptance.

Rollback: set the company’s `recruitment_ad_mail_settings.enabled` to `false`. This stops future report scheduling without changing ads, historical activity or delivery audit records.
