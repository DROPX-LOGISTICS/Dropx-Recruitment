-- Persist enough non-PII state to identify newly posted ads and creative changes.
alter table public.recruitment_ad_mail_snapshots
  add column if not exists poster_fingerprint text;

alter table public.recruitment_ad_mail_activity
  add column if not exists change_types text[] not null default '{}'::text[];

comment on column public.recruitment_ad_mail_snapshots.poster_fingerprint is
  'Hash of the current creative reference, used only to identify poster changes in the evening digest.';
comment on column public.recruitment_ad_mail_activity.change_types is
  'One or more of new_ad, poster, status, budget; non-PII audit labels for the evening digest.';
