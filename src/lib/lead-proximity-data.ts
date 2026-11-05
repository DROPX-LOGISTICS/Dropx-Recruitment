import { supabaseAdmin } from './supabase-admin';
import { pinAreaCentre, leadProximity, validPoint, STATION_HIRING_PINS, type Point } from './lead-proximity';
// Geographic PIN centres are public reference data, not candidate or session data.
const centres=new Map<string,{point:Point|null;expires:number}>();
export async function withLeadProximity<T extends {post_code?:string|null;recruitment_locations?:any}>(rows:T[]) {
  if(!supabaseAdmin)return rows.map(row=>({...row,proximity:leadProximity(null,null)}));
  const pins=[...new Set(rows.map(row=>String(row.post_code??'').replace(/\s/g,'')).filter(pin=>/^[1-9]\d{5}$/.test(pin)))];
  const missing=pins.filter(pin=>(centres.get(pin)?.expires??0)<Date.now());
  for(let i=0;i<missing.length;i+=100) {
    const batch=missing.slice(i,i+100);
    const result=await supabaseAdmin.from('pincode_boundaries').select('pincode,geojson').in('pincode',batch);
    if(result.error)continue; // Source outage remains unknown; never invent zero km.
    const found=new Map((result.data??[]).map(r=>[r.pincode,pinAreaCentre(r.geojson)]));
    for(const pin of batch)centres.set(pin,{point:found.get(pin)??null,expires:Date.now()+3600_000});
  }
  if(centres.size>30000)for(const [pin,c] of centres)if(c.expires<Date.now())centres.delete(pin);
  return rows.map(row=>{
    const station=Array.isArray(row.recruitment_locations)?row.recruitment_locations[0]:row.recruitment_locations;
    const pin=String(row.post_code??'').replace(/\s/g,'');
    return {...row,proximity:{...leadProximity(validPoint(station?.latitude,station?.longitude),centres.get(pin)?.point??null),localPin:(STATION_HIRING_PINS[station?.code]??[]).includes(pin)}};
  });
}
