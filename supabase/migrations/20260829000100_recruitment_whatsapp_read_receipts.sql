alter table public.recruitment_whatsapp_outbox
  add column if not exists read_at timestamptz;

create index if not exists recruitment_whatsapp_outbox_delivery_timeline_idx
  on public.recruitment_whatsapp_outbox(company_id, status, updated_at desc);

