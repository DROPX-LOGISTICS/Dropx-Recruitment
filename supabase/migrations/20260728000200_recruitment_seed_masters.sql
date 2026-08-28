begin;

with company as (
  select id from public.companies where code = 'DROPX_LOGISTICS'
), source(code, name, state, region, cluster) as (
  values
    ('KGQA','Kasargod','Kerala','KL','Sreerag'),
    ('KGQC','Kasargod','Kerala','KL','Sreerag'),
    ('TLPA','Chalode','Kerala','KL','Sreerag'),
    ('TLPB','Iritty','Kerala','KL','Sreerag'),
    ('PEUA','Kuttiady','Kerala','KL','Sreejyothish'),
    ('KGQE','Nadapuram','Kerala','KL','Sreejyothish'),
    ('PMB','Perambra','Kerala','KL','Sreejyothish'),
    ('CHM','Chempanoda','Kerala','KL','Sreejyothish'),
    ('QLDA','Koyilandy','Kerala','KL','Shihab'),
    ('KOZA','Kozhikode','Kerala','KL','Shihab'),
    ('KLZH','Sulthan Bathery','Kerala','KL','Shihab'),
    ('KTUB','Nilambur','Kerala','KL','Shihab'),
    ('KTUH','Vaniyambalam','Kerala','KL','Shihab'),
    ('ERSE','Perumbavoor','Kerala','KL','Dhananjay'),
    ('GDRD','Gudur','Andhra Pradesh','AP','Suresh'),
    ('XAPH','Kota','Andhra Pradesh','AP','Suresh'),
    ('GNTF','Amaravathi','Andhra Pradesh','AP','Bharat'),
    ('GNTI','Cheerala','Andhra Pradesh','AP','Bharat'),
    ('XAPL','Inkollu','Andhra Pradesh','AP','Bharat'),
    ('GYMC','Chandragiri','Andhra Pradesh','AP','Bharat'),
    ('XAPI','Bakharapeta','Andhra Pradesh','AP','Bharat'),
    ('NLRC','Buchireddy Palem','Andhra Pradesh','AP','Bharat'),
    ('NLRE','Parameshwar Nagar','Andhra Pradesh','AP','Suresh'),
    ('NLRF','Kavali','Andhra Pradesh','AP','Bharat'),
    ('TIRC','Puthur','Andhra Pradesh','AP','Bharat'),
    ('JDBD','Jagdalpur','Chattisgarh','ODCG','Himansu'),
    ('JGBA','Kondagaon','Chattisgarh','ODCG','Himansu'),
    ('RPRN','Narayanpur','Chattisgarh','ODCG','Himansu'),
    ('JUGD','Jharsughuda','Odisha','ODCG','Jagathnath'),
    ('SPBE','Kuchinda','Odisha','ODCG','Jagathnath'),
    ('JUGF','Sundergarh','Odisha','ODCG','Jagathnath'),
    ('KANA','Phulbani','Odisha','ODCG','Jagathnath'),
    ('KDJE','Barbil','Odisha','ODCG','Jagathnath'),
    ('KDJG','Champua','Odisha','ODCG','Jagathnath'),
    ('SBPD','Sambalpur','Odisha','ODCG','Jagathnath'),
    ('JUGE','Bandhbahal','Odisha','ODCG','Jagathnath'),
    ('PHN','Phulnakhra','Odisha','ODCG','Jagathnath'),
    ('KTUO','Kothamangalam','Kerala','KL','Dhananjay'),
    ('HBSC','Sambalpur','Odisha','ODCG','Jagathnath'),
    ('MEP','Meppayur','Kerala','KL','Sreejyothish'),
    ('TTB3','Nizampet','Telengana','ODCG','Vishnu'),
    ('TTA5','Moosapet','Telengana','ODCG','Vishnu'),
    ('TCC3','Adayar','Tamil Nadu','KL','Arjun'),
    ('TCD4','Nesapakkam','Tamil Nadu','KL','Arjun'),
    ('AWEZ','Kalady','Kerala','KL','Dhananjay'),
    ('RENG','Rengali','Odisha','ODCG','Jagathnath'),
    ('HO','Manjeri','Kerala','KL','Suja'),
    ('ERSN','Payyoli','Kerala','KL','Sreejyothish'),
    ('KLZA','Vadakara','Kerala','KL','Sreejyothish'),
    ('TZC4','Cooperganj','Uttar Pradesh','UP','Rahul')
)
insert into public.recruitment_locations(company_id, code, name, state, region, cluster)
select company.id, source.code, source.name, source.state, source.region, source.cluster
from company cross join source
on conflict(company_id, code) do update set
  name = excluded.name,
  state = excluded.state,
  region = excluded.region,
  cluster = excluded.cluster,
  is_active = true,
  updated_at = now();

with company as (
  select id from public.companies where code = 'DROPX_LOGISTICS'
), source(code, name, stream, aliases, required_fields) as (
  values
    ('DA','Delivery Associate','workforce',array['DELIVERY ASSOCIATE'],array['full_name','phone','city','post_code']),
    ('SSA','Station Support Associate','hr',array['STATION SUPPORT ASSOCIATE'],array['full_name','phone','city','post_code','education','experience']),
    ('HMT','Hub Management Team','hr',array['HUB MANAGEMENT TEAM'],array['full_name','phone','city','post_code','education','experience']),
    ('PC','Picker','workforce',array['PICKER'],array['full_name','phone','city','post_code']),
    ('WM','Wish Master','workforce',array['WISH MASTER'],array['full_name','phone','city','post_code']),
    ('TL','Team Leader','hr',array['TEAM LEADER'],array['full_name','phone','city','post_code','education','experience','current_employer','current_salary']),
    ('SI','Shift Incharge','hr',array['SHIFT INCHARGE'],array['full_name','phone','city','post_code','education','experience']),
    ('SM','Store Manager','hr',array['STORE MANAGER'],array['full_name','phone','city','post_code','education','experience']),
    ('HI','Hub Incharge','hr',array['HUB INCHARGE'],array['full_name','phone','city','post_code','education','experience']),
    ('CLM','Cluster Manager','hr',array['CLUSTER MANAGER'],array['full_name','phone','city','post_code','education','experience']),
    ('STM','Station Manager','hr',array['STATION MANAGER','STATIONMGR'],array['full_name','phone','city','post_code','education','experience']),
    ('DCD','Driver cum DA','workforce',array['DRIVER CUM DA'],array['full_name','phone','city','post_code']),
    ('PTSSA','Part Time Station Support Associate','workforce',array['PART TIME SSA'],array['full_name','phone','city','post_code']),
    ('DR','Driver','workforce',array['DRIVER'],array['full_name','phone','city','post_code']),
    ('ODCD','Own Van Driver cum DA','workforce',array['OWN VAN DRIVER CUM DA'],array['full_name','phone','city','post_code','vehicle_model']),
    ('PTDA','Part Time Delivery Associate','workforce',array['PART TIME DA'],array['full_name','phone','city','post_code']),
    ('PTPC','Part Time Picker','workforce',array['PART TIME PICKER','PART TIME PICKERS'],array['full_name','phone','city','post_code']),
    ('VAN','Van Rent','workforce',array['VAN RENT'],array['full_name','phone','city','post_code','vehicle_model']),
    ('HR','HR Executive','hr',array['HR EXECUTIVE'],array['full_name','phone','city','post_code','education','experience']),
    ('IHS','Amazon Store Partner','workforce',array['AMAZON STORE','I HAVE SPACE'],array['full_name','phone','city','post_code']),
    ('TC','Telecalling Executive','hr',array['TELECALLER','TELECALLING EXECUTIVE'],array['full_name','phone','city','post_code','education','experience']),
    ('RC','Recruiter','hr',array['RECRUITER'],array['full_name','phone','city','post_code','education','experience']),
    ('STORE','Store Partner','workforce',array['STORE','STORE AVAILABLE'],array['full_name','phone','city','post_code'])
)
insert into public.recruitment_roles(company_id, code, name, stream, aliases, required_fields)
select company.id, source.code, source.name, source.stream::public.recruitment_stream, source.aliases, source.required_fields
from company cross join source
on conflict(company_id, code) do update set
  name = excluded.name,
  stream = excluded.stream,
  aliases = excluded.aliases,
  required_fields = excluded.required_fields,
  is_active = true,
  updated_at = now();

insert into public.recruitment_user_access(
  company_id,
  profile_id,
  can_access_workforce,
  can_access_hr,
  can_access_all_locations,
  can_manage_masters,
  can_manage_ads,
  can_manage_users
)
select
  profile.company_id,
  profile.id,
  true,
  true,
  true,
  true,
  true,
  true
from public.profiles profile
join public.companies company on company.id = profile.company_id
where company.code = 'DROPX_LOGISTICS'
  and profile.is_active
  and (
    profile.is_master_owner
    or lower(profile.email) in (
      'jamsheer@dropxlogistics.com',
      'jamsheerpp33@gmail.com',
      'nisar@dropxlogistics.com',
      'suja@dropxlogistics.com'
    )
  )
on conflict(company_id, profile_id) do update set
  can_access_workforce = true,
  can_access_hr = true,
  can_access_all_locations = true,
  can_manage_masters = true,
  can_manage_ads = true,
  can_manage_users = true,
  is_active = true,
  updated_at = now();

commit;
