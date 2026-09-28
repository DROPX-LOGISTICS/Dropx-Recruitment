# Workforce ad manager mail

Production control: **Active Ads → Manager emails** (Owner, not View as user).

- Daily digest: 08:30 Asia/Kolkata, with a recovery window until 10:30. The five-minute cron claims a company lease and queues idempotently per recipient/scope/day.
- Status events: ACTIVE, PAUSED, COMPLETED, evaluated from Meta delivery and end dates. Observed on the next mail poll after the existing Meta sync (currently up to 30 minutes). Initial activation baselines history without a backfill blast.
- Workforce roles only; SSA/HR are excluded. No applicant data is mailed.
- To: active Operations designation holders and existing station mailboxes within their current station scope. CC: scoped WFA and BH profiles. Multiple stations are consolidated only where all copied people can see all included stations.
- Monthly subject and real Message-ID/In-Reply-To/References threading. Scope or recipient changes intentionally create a new isolated thread. Delivery within a thread is serialized.
- Email contains current station active budget totals and each ad's configured budget. Campaign/ad-set budgets are deduplicated. Lifetime and daily budgets stay separate. A pool shared across stations or HR is flagged as unallocated, never added to a station's exact total.
- Up to eight safe, bounded-size poster attachments per message, embedded by CID. No Recruit login required for these images. Missing/expired posters do not block an operational email.
- Signed seven-day links expose only the referenced ad, validate current active identity/location scope and the original delivery, and require an explicit form POST. They create pending Ad Requests, never execute Meta actions. Resume requires headcount; no joining date. Workforce reviewers configure duration/budget before restarting an ended ad.
- Sample button sends one pair per day only to the signed-in owner's profile email; no operational CC and no live action links.
- SMTP acceptance is recorded, not claimed as inbox delivery. Uncertain sends are held for review, never blindly retried. Owner may retry after checking provider logs. The private ledger and recipient RPCs are service-role-only.

Verification: model and service tests cover role exclusions, scoped grouping, budget sharing, IST/month boundaries, threading, baseline/no historical blast, cron locking, duplicate prevention, uncertain SMTP, sample isolation, signed link expiry/tampering, request creation and scope revocation. Production verification must additionally check the Git-backed Vercel alias, sample acceptance, and enabled cron.

Rollback: pause Manager emails or set the company's recruitment_ad_mail_settings.enabled=false. This stops scheduling without changing ads or requests. Preserve the delivery ledger for deduplication and audit.
