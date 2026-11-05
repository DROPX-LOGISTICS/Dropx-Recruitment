-- Scoped, idempotent repair of source-backed TLPB-XPT applications.
-- Run only after deploying ad-scoped deduplication. No notification/outbox writes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
declare
  company uuid := '43866344-b550-4e8a-9a2d-9d23f3d8a997';
  target_ad recruitment_ads%rowtype;
  event recruitment_lead_source_events%rowtype;
  old_lead recruitment_leads%rowtype;
  application uuid;
  application_key text;
  phone_digits text;
  fields jsonb;
begin
  select * into strict target_ad from recruitment_ads
    where company_id=company and id='04e10376-c42b-40d7-9387-3e43d741cd00'
      and ad_name='TLPB-XPT_DA_20261105'
      and location_id='8d93273b-5aed-4627-a4cf-d520d7570e5f';
  for event in select * from recruitment_lead_source_events
    where company_id=company and ad_name=target_ad.ad_name
      and status='processed' and lead_id is not null
    order by received_at for update
  loop
    select * into strict old_lead from recruitment_leads
      where id=event.lead_id and company_id=company for update;
    if old_lead.ad_id=target_ad.id then
      -- Preserve any explicit human assignment made after ingestion.
      if old_lead.location_id is distinct from target_ad.location_id
        and old_lead.last_updated_by is null and old_lead.status in ('','new') then
        insert into recruitment_lead_history(company_id,lead_id,event_type,field_name,old_value,new_value,remarks,actor_email,metadata,source_event_key)
        values(company,old_lead.id,'routing_repair','location_id',old_lead.location_id::text,target_ad.location_id::text,
          'Restored advertised hiring station; delivery PIN coverage is not recruitment ownership.',
          'system:tlpb-xpt-repair',jsonb_build_object('source_event_id',event.id),event.event_key||':station-repair-20261105')
        on conflict(company_id,source_event_key) do nothing;
        update recruitment_leads set location_id=target_ad.location_id,updated_at=now() where id=old_lead.id;
      end if;
      continue;
    end if;
    fields:=event.payload->'fields';
    if fields is null or event.meta_lead_id is null then
      raise exception 'Source payload incomplete: %',event.id;
    end if;
    phone_digits:=right(regexp_replace(coalesce(fields->>'phone_number',fields->>'phone',''),'[^0-9]','','g'),10);
    if phone_digits !~ '^[6-9][0-9]{9}$' then raise exception 'Review phone identity for %',event.id; end if;
    application_key:='application:tlpb-xpt-da-20261105:'||phone_digits;
    insert into recruitment_leads(company_id,meta_lead_id,canonical_key,normalized_phone,
      full_name,phone,email,city,post_code,location_id,role_id,stream,ad_id,ad_name,source,questionnaire,lead_created_at)
    values(company,event.meta_lead_id,application_key,phone_digits,
      fields->>'full_name',coalesce(fields->>'phone_number',fields->>'phone'),fields->>'email',fields->>'city',fields->>'post_code',
      target_ad.location_id,target_ad.role_id,'workforce',target_ad.id,target_ad.ad_name,'meta',fields,
      coalesce((event.payload->'lead'->>'created_time')::timestamptz,event.received_at))
    on conflict(company_id,canonical_key) do nothing;
    select id into strict application from recruitment_leads where company_id=company and canonical_key=application_key;
    insert into recruitment_lead_history(company_id,lead_id,event_type,field_name,old_value,new_value,remarks,actor_email,metadata,source_event_key)
    values(company,application,'application_repair','source_lead',old_lead.id::text,application::text,
      'Recovered a fresh application to this ad. Earlier application and recruiter decisions remain in their original history.',
      'system:tlpb-xpt-repair',jsonb_build_object('source_event_id',event.id,'meta_lead_id',event.meta_lead_id,'previous_application_id',old_lead.id),event.event_key||':application-repair-20261105')
    on conflict(company_id,source_event_key) do nothing;
    -- Retain the erroneous old ingest audit as evidence; source event now points at the correct application.
    update recruitment_lead_source_events set lead_id=application where id=event.id;
  end loop;
  -- This older TLPA application was moved to XPT by the fresh response.
  -- It has no subsequent human changes. Restore only that proven erroneous move.
  select * into strict old_lead from recruitment_leads
    where company_id=company and id='e569cd11-1bbf-4f4e-8ae2-afd961805b68' for update;
  if old_lead.location_id=target_ad.location_id and old_lead.ad_name='TLPA_DA'
    and old_lead.status='long_distance'
    and not exists(select 1 from recruitment_lead_history where lead_id=old_lead.id
      and created_at>'2026-11-05T16:35:43.651648Z'::timestamptz
      and (actor_profile_id is not null or event_type='status_change')) then
    insert into recruitment_lead_history(company_id,lead_id,event_type,field_name,old_value,new_value,remarks,actor_email,source_event_key)
      values(company,old_lead.id,'routing_repair','location_id',old_lead.location_id::text,'48699a3e-78a2-4d47-9517-33164d929212',
        'Restored original TLPA application after separate XPT response was recovered; prior decision unchanged.',
        'system:tlpb-xpt-repair','tlpb-xpt-20261105:restore-original-tlpa')
      on conflict(company_id,source_event_key) do nothing;
    update recruitment_leads set location_id='48699a3e-78a2-4d47-9517-33164d929212',updated_at=now() where id=old_lead.id;
  end if;
end $$;
commit;
select l.ad_name,r.code,count(*) applications from recruitment_leads l
join recruitment_locations r on r.id=l.location_id
where l.company_id='43866344-b550-4e8a-9a2d-9d23f3d8a997' and l.ad_name='TLPB-XPT_DA_20261105'
group by l.ad_name,r.code;
