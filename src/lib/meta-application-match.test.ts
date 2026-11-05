import {describe,it,expect} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {findMetaApplication} from './meta-application-match';
function database(rows:any[]) {
  const requests:URL[]=[];
  const client=createClient('https://example.test','test-key',{auth:{persistSession:false},global:{fetch:async(input)=>{
    const url=new URL(String(input));requests.push(url);
    let found=rows.filter(row=>['company_id','meta_lead_id','canonical_key','ad_name','normalized_phone'].every(field=>
      !url.searchParams.has(field)||url.searchParams.get(field)===`eq.${row[field]}`));
    return new Response(JSON.stringify(found.slice(0,1)),{headers:{'content-type':'application/json'}});
  }}});
  return {client,requests};
}
const old={id:'old',company_id:'company',meta_lead_id:'old-meta',canonical_key:'meta:old-meta',ad_name:'OLD_DA',normalized_phone:'9876543210',status:'long_distance'};
describe('ad-scoped application matching',()=>{
  it('does not inherit a different ad application even for the same phone',async()=>{
    const {client,requests}=database([old]);
    expect((await findMetaApplication(client,'company','new-meta','application:new:9876543210','NEW_DA','9876543210')).data).toBeNull();
    expect(requests.every(url=>url.searchParams.get('company_id')==='eq.company')).toBe(true);
    expect(requests.find(url=>url.searchParams.has('normalized_phone'))?.searchParams.get('ad_name')).toBe('eq.NEW_DA');
  });
  it('retains legacy same-ad retry matching',async()=>{
    const {client}=database([old]);
    expect((await findMetaApplication(client,'company','new-meta','application:old:9876543210','OLD_DA','9876543210')).data?.id).toBe('old');
  });
  it('matches an exact source ID before considering phone and never crosses companies',async()=>{
    const {client,requests}=database([old]);
    expect((await findMetaApplication(client,'company','old-meta','new-key','NEW_DA',null)).data?.id).toBe('old');
    expect(requests).toHaveLength(1);
    expect((await findMetaApplication(client,'different-company','old-meta','new-key','OLD_DA','9876543210')).data).toBeNull();
  });
});
