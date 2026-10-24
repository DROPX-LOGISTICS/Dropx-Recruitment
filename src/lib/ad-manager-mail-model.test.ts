import {describe,it,expect} from 'vitest';
import {adBudget,stationBudgets,dailyDue,ist,mailGroups,normalizeAds,renderManagerMail,signAction,verifyAction,type MailPerson,type MailAd,type MailActivity} from './ad-manager-mail-model';
import {adChangesToday,adSpendToDate} from './ad-manager-mail-render';
import {creativeChanged,creativeFingerprint} from './ad-mail-creative';
import {readFileSync} from 'node:fs';
const person=(id:string,role:string,stations:string[]):MailPerson=>({id,role,station_ids:stations,name:id,email:`${id}@example.com`,mobile:'1234567890'});
const ad=(id:string,stationId:string,status='ACTIVE'):MailAd=>({id,stationId,station:stationId,role:'Delivery Associate',ad_name:id,status,daily_budget:250,poster_url:null,raw_payload:{},last_synced_at:null,created_on:'2026-09-20T00:00:00.000Z',lead_count:4,location_id:stationId,role_id:'da',ends_at:null,current_run_started_at:'2026-09-24T00:00:00.000Z'});
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
 it('sends at 1 pm IST only, with one matching production cron',()=>{
  expect(dailyDue(new Date('2026-09-28T07:29:59Z'))).toBe(false);
  expect(dailyDue(new Date('2026-09-28T07:30:00Z'))).toBe(true);
  expect(dailyDue(new Date('2026-09-28T07:34:59Z'))).toBe(true);
  expect(dailyDue(new Date('2026-09-28T07:35:00Z'))).toBe(false);
  expect(dailyDue(new Date('2026-09-28T03:00:00Z'))).toBe(false);
  expect(dailyDue(new Date('2026-09-28T14:30:00Z'))).toBe(false);
  const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
  expect(config.crons.filter((c:any)=>c.path==='/api/cron/recruitment-ad-mail')).toEqual([{path:'/api/cron/recruitment-ad-mail',schedule:'30 7 * * *'}]);
  expect(ist(new Date('2026-09-30T19:00:00Z')).slice(0,7)).toBe('2026-10');
 });
 it('rejects expired and altered action tokens',()=>{
  const p={company:'c',person:'m',ad:'a',action:'resume_ad' as const,source:'delivery',exp:2000};
  const token=signAction(p,'secret');expect(verifyAction(token,'secret',1000)).toEqual(p);
  expect(()=>verifyAction(token,'other',1000)).toThrow();expect(()=>verifyAction(token,'secret',3000)).toThrow();expect(()=>verifyAction(token+'x','secret',1000)).toThrow();
 });
 it('shows active ads only, real spend, location, designation, sample posters and one CTA',()=>{
  const group=mailGroups([person('manager','CLM',['S1'])],[{...ad('a','S1'),stationName:'Adyar',spend_today:83.5,raw_payload:{insights:{data:[{spend:'1234.56'}]}}},ad('paused-secret','S1','PAUSED'),ad('ended-secret','S1','COMPLETED'),ad('out-of-scope','S2')])[0];
  const mail=renderManagerMail({group,kind:'daily',date:'2026-09-28',sample:true,images:{a:'poster-a@dropx'}});
  expect(mail.html).toContain('cid:poster-a@dropx');expect(mail.text).toContain('S1 · Adyar | Delivery Associate');
  expect(mail.text).toContain('₹83.5');expect(mail.text).toContain('₹1,234.56');expect(mail.text).toContain('₹250/day');
  for(const text of ['paused-secret','ended-secret','out-of-scope','LEADS','Post ad','Run days','Morning status','Evening activity'])expect(mail.html).not.toContain(text);
  expect(mail.html.match(/<a /g)).toHaveLength(1);expect(mail.subject).toContain('[SAMPLE]');expect(mail.subject).toContain('Active ads & changes');
 });
 it('never substitutes configured budgets or missing insights for actual spend',()=>{
  expect(adSpendToDate({...ad('a','S1'),total_spend:0})).toBeNull();
  expect(adSpendToDate({...ad('a','S1'),total_spend:400})).toBe(400);
  expect(adSpendToDate({...ad('a','S1'),raw_payload:{insights:{data:[]}}})).toBe(0);
  expect(adSpendToDate({...ad('a','S1'),raw_payload:{insights:{data:[{spend:'bad'}]}}})).toBeNull();
 });
 it('escapes names and distinguishes shared campaign and lifetime budgets',()=>{
  const group=mailGroups([person('manager','CLM',['S1'])],[{...ad('a','S1'),ad_name:'<img onerror=bad>',raw_payload:{campaign:{id:'c',lifetime_budget:500000}}}])[0];
  const mail=renderManagerMail({group,kind:'daily',date:'2026-09-28'});
  expect(mail.html).toContain('&lt;img onerror=bad&gt;');expect(mail.html).not.toContain('<img onerror');expect(mail.text).toContain('₹5,000 total budget · campaign');expect(mail.text).not.toContain('₹5,000/day');
 });
 const change=(overrides:Partial<MailActivity>={}):MailActivity=>({ad_id:'a',station_id:'S1',station:'S1',ad_name:'a',role:'DA',occurred_at:'2026-09-28T06:00:00Z',previous_status:'ACTIVE',current_status:'ACTIVE',previous_budget:100,current_budget:150,budget_kind:'daily',change_types:['budget'],...overrides});
 it('collapses repeated changes into one net line and ignores old URL-only poster noise',()=>{
  const rows=[change(),change({occurred_at:'2026-09-28T07:00:00Z',previous_budget:150,current_budget:200}),...Array.from({length:5066},()=>change({change_types:['poster']}))];
  const group=mailGroups([person('manager','CLM',['S1'])],[ad('a','S1')])[0];
  const mail=renderManagerMail({group,kind:'daily',date:'2026-09-28',activities:rows});
  expect(mail.text).toContain('Budget increased: ₹100 → ₹200/day');expect(mail.text).toContain('1 ad changed today');expect(mail.text).not.toContain('5066');expect(mail.text).not.toContain('Poster updated');expect(mail.html.length).toBeLessThan(7000);
  expect(adChangesToday(ad('a','S1'),[change(),change({previous_budget:150,current_budget:100,occurred_at:'2026-09-28T07:00:00Z'})],'2026-09-28','2026-09-28T07:30:00Z')).toBe('');
 });
 it('includes only same-day, current-ad and current-station changes before the report',()=>{
  const rows=[change({station_id:'other'}),change({ad_id:'other'}),change({occurred_at:'2026-09-27T06:00:00Z'}),change({occurred_at:'2026-09-28T10:00:00Z'})];
  expect(adChangesToday(ad('a','S1'),rows,'2026-09-28','2026-09-28T07:30:00Z')).toBe('');
 });
 it('reports real creative changes and new or resumed ads without counting historical discovery as new',()=>{
  const row=change({change_types:['new_ad','poster','creative_verified'],previous_status:null});
  expect(adChangesToday(ad('a','S1'),[row],'2026-09-28','2026-09-28T07:30:00Z')).toBe('Poster updated');
  expect(adChangesToday({...ad('a','S1'),created_on:'2026-09-28T05:00:00Z'},[row],'2026-09-28','2026-09-28T07:30:00Z')).toBe('Started today · Poster updated');
  expect(adChangesToday(ad('a','S1'),[change({previous_status:'PAUSED',change_types:['status']})],'2026-09-28','2026-09-28T07:30:00Z')).toBe('Resumed today');
 });
 it('does not count CDN refreshes as poster changes, and upgrades legacy baselines silently',()=>{
  const first=creativeFingerprint({poster_url:'https://s.fbcdn.net/a?token=old',raw_payload:{creative:{id:'123'}}});
  const same=creativeFingerprint({poster_url:'https://s.fbcdn.net/other?token=new',raw_payload:{creative:{id:'123'}}});
  expect(same).toBe(first);expect(creativeChanged('legacy-hash',first)).toBe(false);
  expect(creativeChanged(first,creativeFingerprint({raw_payload:{creative:{id:'456'}}}))).toBe(true);
  expect(creativeFingerprint({poster_url:'https://s.fbcdn.net/a?token=old'})).toBe(creativeFingerprint({poster_url:'https://s.fbcdn.net/a?token=new'}));
 });
 it('does not silently drop active ads above forty',()=>{
  const group=mailGroups([person('manager','CLM',['S1'])],Array.from({length:45},(_,i)=>ad(`ad-${i}`,'S1')))[0];
  const mail=renderManagerMail({group,kind:'daily',date:'2026-09-28'});
  for(let i=0;i<45;i++)expect(mail.text).toContain(`| ad-${i}\n`);
 });
});
