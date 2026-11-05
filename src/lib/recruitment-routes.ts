/** Public navigation only. Never serialize tokens, preview identities or permissions. */
export const recruitMenuSlugs: Record<string,string> = {
  'Dashboard':'dashboard','Workforce Plan':'workforce-plan','All Leads':'leads',
  'No Response / Call Back':'callbacks','Screening':'screening','My Interviews':'my-interviews',
  'Interviews':'interviews','Documents':'documents','Offers':'offers','Hired':'hired',
  'Archived Leads':'archived-leads','Unmapped':'unmapped','WhatsApp Messages':'whatsapp-messages',
  'Reports':'reports','Performance Center':'performance','Recruiter Performance':'telecaller-performance',
  'Field Recruitment':'field-performance','Influencer Performance':'influencer-performance',
  'Field Expense Approvals':'expense-approvals','Field Executive Onboarding':'workforce-register',
  'DA In-app Onboarding':'da-onboarding','Incentive Master':'incentives','Job Requisitions':'job-requisitions',
  'Resume Intake':'resume-intake','AI Fit Review':'ai-fit-review','Active Ads':'ads','Ad Requests':'ad-requests',
  'Station Directory':'stations','Station Contacts':'station-contacts','Roles':'designations',
  'Lead Status Master':'lead-statuses','HR Lifecycle':'hr-lifecycle','Notification Rules':'notifications',
  'User Roles':'user-roles','Access Control':'access','Master Reports':'executive-reports',
  'Connections':'connections','System Health':'system-health','Audit':'audit'
};
export const emptyRecruitFilters = {sort:'newest',status:'',finalStatus:'',adIds:'',station:'',cluster:'',role:'',updatedAge:'',interviewFrom:'',interviewTo:'',stale24:false};
export type RecruitWorkspace='workforce'|'hr';
export type RecruitRoute={stream:RecruitWorkspace;menu:string;filters:typeof emptyRecruitFilters;page:number;search:string};
export function recruitHref(stream:RecruitWorkspace,menu:string,filters=emptyRecruitFilters,page=1,search='') {
  const query=new URLSearchParams();
  for(const [key,defaultValue] of Object.entries(emptyRecruitFilters)) {
    const value=filters[key as keyof typeof filters];
    if(value!==defaultValue&&value!==''&&value!==false)query.set(key,String(value));
  }
  if(page>1)query.set('page',String(page));
  if(search.trim())query.set('search',search.trim());
  return `/${stream}/${recruitMenuSlugs[menu]??'dashboard'}${query.size?'?'+query:''}`;
}
export function parseRecruitRoute(path:string,query=''):RecruitRoute|null {
  const parts=path.replace(/\/$/,'').split('/').filter(Boolean);
  if(parts.length!==2||!['workforce','hr'].includes(parts[0]))return null;
  const menu=Object.keys(recruitMenuSlugs).find(key=>recruitMenuSlugs[key]===parts[1]);
  if(!menu)return null;
  const params=new URLSearchParams(query),filters={...emptyRecruitFilters};
  for(const key of Object.keys(filters) as (keyof typeof filters)[]) {
    const value=params.get(key);
    if(value===null)continue;
    if(key==='stale24')filters.stale24=value==='true';
    else if(key==='sort')filters.sort=value==='nearest'?'nearest':'newest';
    else filters[key]=value.slice(0,2000);
  }
  const page=Number(params.get('page'));
  return {stream:parts[0] as RecruitWorkspace,menu,filters,page:Number.isSafeInteger(page)&&page>0?Math.min(page,10000):1,search:(params.get('search')??'').slice(0,200)};
}
