# Workforce ad reports

Production control: **Active Ads → Workforce reports** (Owner, not View as user).

- The only operational emails are two fixed Asia/Kolkata reports: the compact current-status report at **08:30** and the compact activity report at **20:00**. Each schedule has a five-minute delivery window so a retry cannot generate an afternoon message.
- Meta polling records status and configured-budget changes in a private audit ledger. It never sends an email. The evening report rolls those records into a single table for the day: time, station, ad and change. A no-change day still produces one clear zero-activity report.
- Every active, mapped recipient receives one direct report containing all and only the stations in their People location scope. WFA and BH profiles are direct recipients, not CC recipients. Active master owners receive all active stations. A person who holds several eligible mappings is deduplicated into one report.
- Morning and evening reports have separate stable threads for each recipient and month. Mail uses no poster attachments or operational action links, keeping it compact and preventing delivery noise.
- The morning table lists station, live count, paused/ended count and configured budget. The evening table lists only that day’s status and budget changes. Shared or unallocated budgets are identified rather than allocated to an unrelated station.
- Existing sent email remains auditable. Queued legacy per-change event emails are cancelled by the migration. SMTP acceptance is recorded, not claimed as inbox delivery; uncertain sends require provider-log review before any retry.

Verification covers direct, deduplicated station scope; exact IST schedule windows; compact rendering; activity baselining; queue idempotency; monthly threading; no CC recipients; and SMTP uncertainty. Production checks must confirm the Git-backed Vercel alias, enabled cron, recipient RPC and email-provider acceptance.

Rollback: set the company’s `recruitment_ad_mail_settings.enabled` to `false`. This stops future report scheduling without changing ads, historical activity or delivery audit records.
