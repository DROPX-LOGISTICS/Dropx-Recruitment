import {describe,it,expect} from 'vitest';
import {adBudget,stationBudgets,morningDue,eveningDue,ist,mailGroups,normalizeAds,renderManagerMail,signAction,verifyAction,type MailPerson,type MailAd,type MailActivity} from './ad-manager-mail-model';
const person=(id:string,role:string,stations:string[]):MailPerson=>({id,role,station_ids:stations,name:id,email:`${id}@example.com`,mobile:'1234567890'});
const ad=(id:string,stationId:string,status='ACTIVE'):MailAd=>({id,stationId,station:stationId,role:'Delivery Associate',ad_name:id,status,daily_budget:250,poster_url:null,raw_payload:{},last_synced_at:null,location_id:stationId,role_id:'da',ends_at:null});
describe('Workforce manager mail',()=>{
 it('counts shared campaign budgets only once at station level',()=>{
  const raw_payload={budget_source:'campaign',campaign:{id:'campaign',daily_budget:50000}};
  expect(stationBudgets([{...ad('a','S1'),raw_payload},{...ad('b','S1'),raw_payload}])[0]).toMatchObject({daily:500,count:2});
 });
 it('does not mislabel lifetime budgets as daily or allocate cross-station pools',()=>{
  const a={...ad('a','S1'),raw_payload:{campaign:{id:'c',lifetime_budget:500000}}};
  expect(adBudget(a)).toMatchObject({amount:5000,kind:'lifetime'});
  expect(stationBudgets([a])[0]).toMatchObject({daily:0,lifetime:5000});
  expect(stationBudgets([{...a,budgetSharedOutsideStation:true}])[0]).toMatchObject({daily:0,lifetime:0,shared:1});
 });
 it('marks a campaign shared with HR as unallocated without leaking HR details',()=>{
  const raw_payload={campaign:{id:'c',daily_budget:10000}};
  const base={...ad('a','S1'),raw_payload,recruitment_locations:{code:'S1',station_id:'S1'}};
  const ads=normalizeAds([{...base,recruitment_roles:{code:'DA',stream:'workforce'}},{...base,id:'hr',recruitment_roles:{code:'HR',stream:'hr'}}]);
  expect(ads).toHaveLength(1);expect(ads[0].budgetSharedOutsideStation).toBe(true);
 });
 it('excludes HR and SSA even when an old role row says workforce',()=>{
  const row={...ad('a','S1'),recruitment_locations:{station_id:'S1',code:'S1'}};
  expect(normalizeAds([{...row,recruitment_roles:{code:'DA',name:'DA',stream:'workforce'}},{...row,recruitment_roles:{code:'HR',stream:'hr'}},{...row,recruitment_roles:{code:'SSA',stream:'workforce'}}])).toHaveLength(1);
 });
 it('sends each mapped person one direct mail for their complete station scope',()=>{
  const groups=mailGroups([person('manager','CLM',['S1','S2']),person('head','NH',['S1','S2','S3']),person('wfa','WFA',['S1']),person('bh','BH',['S1','S2'])],[ad('1','S1'),ad('2','S2'),ad('3','S3')]);
  expect(groups).toHaveLength(4);
  expect(groups.find(g=>g.manager.id==='manager')?.stations).toEqual(['S1','S2']);
  expect(groups.find(g=>g.manager.id==='wfa')?.stations).toEqual(['S1']);
  expect(groups.find(g=>g.manager.id==='head')?.stations).toEqual(['S1','S2','S3']);
  for(const group of groups) expect(group.cc).toEqual([]);
 });
 it('deduplicates a profile and ignores people without mapped stations',()=>{
  const people=[person('m','AOM',['S1','S2']),person('w','WFA',['S1','S2']),person('b','BH',['S1','S2']),person('none','CLM',[])];
  const groups=mailGroups(people,[ad('1','S1'),ad('2','S2')]);expect(groups).toHaveLength(3);expect(groups.every(group=>group.ads.length>0)).toBe(true);
  const merged=mailGroups([...people,{...people[0],role:'LOCATION',station_ids:['S3']}],[ad('1','S1'),ad('2','S2'),ad('3','S3')]);
  expect(merged.filter(group=>group.manager.id==='m')).toHaveLength(1);
  expect(merged.find(group=>group.manager.id==='m')?.stations).toEqual(['S1','S2','S3']);
 });
 it('uses exact IST morning and evening windows with monthly boundaries',()=>{
  expect(morningDue(new Date('2026-09-28T02:59:00Z'))).toBe(false);
  expect(morningDue(new Date('2026-09-28T03:00:00Z'))).toBe(true);
  expect(morningDue(new Date('2026-09-28T03:05:00Z'))).toBe(false);
  expect(eveningDue(new Date('2026-09-28T14:30:00Z'))).toBe(true);
  expect(eveningDue(new Date('2026-09-28T14:35:00Z'))).toBe(false);
  expect(ist(new Date('2026-09-30T19:00:00Z')).slice(0,7)).toBe('2026-10');
 });
 it('rejects expired and altered action tokens',()=>{
  const p={company:'c',person:'m',ad:'a',action:'resume_ad' as const,source:'delivery',exp:2000};
  const token=signAction(p,'secret');expect(verifyAction(token,'secret',1000)).toEqual(p);
  expect(()=>verifyAction(token,'other',1000)).toThrow();expect(()=>verifyAction(token,'secret',3000)).toThrow();expect(()=>verifyAction(token+'x','secret',1000)).toThrow();
 });
 it('renders a compact station table for the morning digest',()=>{
  const group=mailGroups([person('manager','CLM',['S1'])],[ad('a','S1')])[0];
  const mail=renderManagerMail({group,kind:'daily',date:'2026-09-28',sample:true});
  expect(mail.html).toContain('Configured budget');expect(mail.text).toContain('STATION | LIVE | PAUSED / ENDED');expect(mail.html).not.toContain('cid:');expect(mail.subject).toContain('Morning status');expect(mail.subject).toContain('[SAMPLE]');
 });
 it('renders escaped evening activity rows without a per-change email',()=>{
  const group=mailGroups([person('manager','CLM',['S1'])],[ad('active','S1')])[0];
  const activity:MailActivity={ad_id:'active',station_id:'S1',station:'S1',ad_name:'<img onerror=bad>',role:'Delivery Associate',occurred_at:'2026-09-28T14:30:00.000Z',previous_status:'PAUSED',current_status:'ACTIVE',previous_budget:100,current_budget:150,budget_kind:'daily'};
  const mail=renderManagerMail({group,kind:'event',date:'2026-09-28',activities:[activity]});expect(mail.html).toContain('&lt;img onerror=bad&gt;');expect(mail.html).toContain('Paused → Active · budget ₹100/day → ₹150/day');expect(mail.html).not.toContain('<img onerror');expect(mail.subject).toContain('Evening activity');
 });
});
