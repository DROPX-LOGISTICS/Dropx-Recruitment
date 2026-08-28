begin;

alter table public.recruitment_whatsapp_outbox
  add column if not exists notification_trigger text,
  add column if not exists recruitment_stream text,
  add column if not exists notification_context jsonb not null default '{}'::jsonb;

create index if not exists recruitment_whatsapp_outbox_trigger_status_idx
  on public.recruitment_whatsapp_outbox(company_id, notification_trigger, status, created_at desc);

create index if not exists recruitment_whatsapp_outbox_lead_timeline_idx
  on public.recruitment_whatsapp_outbox(company_id, lead_id, created_at desc);

commit;
