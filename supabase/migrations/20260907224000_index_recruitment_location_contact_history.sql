-- Support the location foreign key independently of company-scoped history reads.
create index if not exists recruitment_location_contact_history_location_idx
  on public.recruitment_location_contact_history(location_id);
