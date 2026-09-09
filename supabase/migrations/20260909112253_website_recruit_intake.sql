-- Public website content is explicitly published by scoped HR approvers.
alter table public.recruitment_job_requisitions
  add column if not exists website_published boolean not null default false,
  add column if not exists website_description text,
  add column if not exists website_location text;

create table public.recruitment_website_receipts (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  ip_hash text not null,
  phone_hash text not null,
  lead_id uuid not null references public.recruitment_leads(id) on delete cascade,
  application_id uuid references public.recruitment_applications(id) on delete cascade,
  owns_application boolean not null default false,
  created_at timestamptz not null default now()
);
create index recruitment_website_receipts_ip_time on public.recruitment_website_receipts(company_id,ip_hash,created_at);
create index recruitment_website_receipts_phone_time on public.recruitment_website_receipts(company_id,phone_hash,created_at);
alter table public.recruitment_website_receipts enable row level security;
revoke all on public.recruitment_website_receipts from public,anon,authenticated;
grant all on public.recruitment_website_receipts to service_role;

create or replace function public.website_recruit_catalog(p_company uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'locations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',s.station_name,'state',s.state) order by s.station_name)
    from public.recruitment_locations r join public.stations s on s.id=r.station_id and s.company_id=r.company_id
    where r.company_id=p_company and r.is_active and s.is_active and not s.hide_from_location_list), '[]'::jsonb),
  'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'code',r.code) order by r.code)
    from public.recruitment_roles r where r.company_id=p_company and r.is_active and r.stream='workforce' and r.code in ('DA','DCD','ODCD')
    and exists(select 1 from public.designations d join public.designation_register_routes dr on dr.designation_id=d.id
      join public.workforce_register_master m on m.id=dr.register_id
      where d.company_id=p_company and d.code=r.code and d.is_active and dr.registration_enabled and m.is_active and m.table_name='workforce')), '[]'::jsonb),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'title',q.title,'location',q.website_location,
      'description',q.website_description,'workerType',q.worker_type,'experienceMin',q.experience_min_years,'experienceMax',q.experience_max_years) order by q.created_at desc)
    from public.recruitment_job_requisitions q join public.recruitment_roles r on r.id=q.role_id and r.company_id=q.company_id
    where q.company_id=p_company and q.website_published and q.status='open' and q.approved_at is not null
      and q.openings>q.filled_positions and r.stream='hr' and r.is_active
      and length(trim(q.website_description))>=80 and length(trim(q.website_location))>=2), '[]'::jsonb)
);
$$;
revoke all on function public.website_recruit_catalog(uuid) from public,anon,authenticated;
grant execute on function public.website_recruit_catalog(uuid) to service_role;

create or replace function public.website_recruit_apply(
 p_company uuid,p_receipt uuid,p_ip_hash text,p_phone_hash text,p_kind text,p_name text,p_phone text,p_email text,
 p_location uuid,p_role uuid,p_job uuid,p_details jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 receipt public.recruitment_website_receipts%rowtype;
 job public.recruitment_job_requisitions%rowtype;
 selected_location uuid:=p_location;
 selected_role uuid:=p_role;
 selected_city text;
 lead uuid;
 application uuid;
 owns_application boolean:=false;
 resume_missing boolean:=false;
begin
 if p_kind not in ('workforce','hr') or p_phone !~ '^[6-9][0-9]{9}$' or length(trim(p_name))<2
   or (p_details->'consent'->>'accepted') is distinct from 'true' then raise exception 'invalid_request'; end if;
 -- Serialize both rate counters and identity creation across serverless instances.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company::text||p_ip_hash,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company::text||p_phone_hash,1));
 select * into receipt from public.recruitment_website_receipts where id=p_receipt and company_id=p_company;
 if found then
   if receipt.phone_hash<>p_phone_hash then raise exception 'invalid_request'; end if;
   select resume_storage_path is null into resume_missing from public.recruitment_applications where id=receipt.application_id;
   return jsonb_build_object('lead_id',receipt.lead_id,'application_id',receipt.application_id,'allow_resume',receipt.owns_application and coalesce(resume_missing,false));
 end if;
 if (select count(*) from public.recruitment_website_receipts where company_id=p_company and ip_hash=p_ip_hash and created_at>now()-interval '15 minutes')>=10
   or (select count(*) from public.recruitment_website_receipts where company_id=p_company and phone_hash=p_phone_hash and created_at>now()-interval '15 minutes')>=3
   then raise exception 'rate_limited'; end if;
 if p_kind='hr' then
   select q.* into job from public.recruitment_job_requisitions q join public.recruitment_roles r on r.id=q.role_id and r.company_id=q.company_id
   where q.id=p_job and q.company_id=p_company and q.website_published and q.status='open' and q.approved_at is not null
     and q.openings>q.filled_positions and r.is_active and r.stream='hr'
     and length(trim(q.website_description))>=80 and length(trim(q.website_location))>=2 for update of q;
   if not found then raise exception 'not_available'; end if;
   selected_location:=job.location_id; selected_role:=job.role_id; selected_city:=job.website_location;
 else
   select s.station_name into selected_city from public.recruitment_locations r join public.stations s on s.id=r.station_id and s.company_id=r.company_id
   where r.id=p_location and r.company_id=p_company and r.is_active and s.is_active and not s.hide_from_location_list;
   if not found then raise exception 'not_available'; end if;
   if not exists(select 1 from public.recruitment_roles r where r.id=p_role and r.company_id=p_company and r.is_active and r.stream='workforce'
     and r.code in ('DA','DCD','ODCD') and exists(select 1 from public.designations d join public.designation_register_routes dr on dr.designation_id=d.id
       join public.workforce_register_master m on m.id=dr.register_id where d.company_id=p_company and d.code=r.code and d.is_active
       and dr.registration_enabled and m.is_active and m.table_name='workforce')) then raise exception 'not_available'; end if;
 end if;
 -- Preserve existing recruiter decisions and contact data. Reapplications are timeline events.
 select id into lead from public.recruitment_leads where company_id=p_company and normalized_phone=p_phone and stream::text=p_kind
   and (p_kind='hr' or (location_id=selected_location and role_id=selected_role)) order by created_at desc limit 1;
 if lead is null then
   insert into public.recruitment_leads(company_id,canonical_key,normalized_phone,full_name,phone,email,city,location_id,role_id,stream,source,status,questionnaire,lead_created_at)
   values(p_company,'website:'||p_kind||':'||p_phone||':'||coalesce(selected_role::text,'')||':'||coalesce(selected_location::text,''),p_phone,p_name,p_phone,p_email,selected_city,selected_location,selected_role,p_kind::public.recruitment_stream,'website','new',p_details,now())
   returning id into lead;
 end if;
 if p_kind='hr' then
   insert into public.recruitment_applications(company_id,lead_id,requisition_id,source,current_stage,status)
   values(p_company,lead,p_job,'website','new','active') on conflict(company_id,lead_id,requisition_id) do nothing returning id into application;
   owns_application:=application is not null;
   if application is null then select id into application from public.recruitment_applications where company_id=p_company and lead_id=lead and requisition_id=p_job; end if;
 end if;
 insert into public.recruitment_website_receipts(id,company_id,ip_hash,phone_hash,lead_id,application_id,owns_application)
 values(p_receipt,p_company,p_ip_hash,p_phone_hash,lead,application,owns_application);
 insert into public.recruitment_lead_history(company_id,lead_id,event_type,remarks,metadata)
 values(p_company,lead,'website_application_received','Application received through the DropX website.',
   p_details||jsonb_build_object('receipt',p_receipt,'requested_location_id',selected_location,'requested_role_id',selected_role,'requisition_id',p_job,'consent_received_at',now()));
 return jsonb_build_object('lead_id',lead,'application_id',application,'allow_resume',owns_application);
end;
$$;
revoke all on function public.website_recruit_apply(uuid,uuid,text,text,text,text,text,text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.website_recruit_apply(uuid,uuid,text,text,text,text,text,text,uuid,uuid,uuid,jsonb) to service_role;
