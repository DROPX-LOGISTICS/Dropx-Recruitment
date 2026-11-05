/** Approximate geographic proximity, never a route distance or hiring decision. */
export type Point = { lat: number; lng: number };
export type LeadProximity = { km: number | null; basis: 'pin_area' | 'unavailable'; reason?: string; localPin?: boolean };
// Confirmed hiring catchment; do not use this to move applicants between ads.
export const STATION_HIRING_PINS: Readonly<Record<string, readonly string[]>> = {
  'TLPB-XPT': ['670702', '670593']
};
const number = (v: unknown) => v === null || v === undefined || v === '' ? NaN : Number(v);
export function validPoint(lat: unknown, lng: unknown): Point | null {
  const a=number(lat), b=number(lng);
  return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180 ? {lat:a,lng:b} : null;
}
export function distanceKm(a: Point,b: Point) {
  const r=Math.PI/180, dlat=(b.lat-a.lat)*r, dlng=(b.lng-a.lng)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
}
/** Area-weighted polygon centre. Holes subtract area; malformed geometry is unknown. */
export function pinAreaCentre(value: unknown): Point | null {
  try {
    const geo=typeof value==='string'?JSON.parse(value):value;
    if (!geo || typeof geo!=='object') return null;
    const g=geo.type==='Feature'?geo.geometry:geo;
    const polygons=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:null;
    if(!Array.isArray(polygons))return null;
    let total=0,x=0,y=0;
    for(const polygon of polygons) {
      if(!Array.isArray(polygon))return null;
      for(let ringIndex=0;ringIndex<polygon.length;ringIndex++) {
        const ring=polygon[ringIndex]; if(!Array.isArray(ring)||ring.length<4)return null;
        let area=0,cx=0,cy=0;
        for(let i=0;i<ring.length;i++) {
          const a=ring[i],b=ring[(i+1)%ring.length];
          if(!Array.isArray(a)||!Array.isArray(b)||!validPoint(a[1],a[0])||!validPoint(b[1],b[0]))return null;
          const cross=Number(a[0])*Number(b[1])-Number(b[0])*Number(a[1]);
          area+=cross;cx+=(Number(a[0])+Number(b[0]))*cross;cy+=(Number(a[1])+Number(b[1]))*cross;
        }
        if(Math.abs(area)<1e-12)continue;
        const weight=Math.abs(area)*(ringIndex===0?1:-1);
        x+=cx/(3*area)*weight;y+=cy/(3*area)*weight;total+=weight;
      }
    }
    return total>0?validPoint(y/total,x/total):null;
  } catch { return null; }
}
export function leadProximity(station: Point|null, centre: Point|null): LeadProximity {
  if(!station)return {km:null,basis:'unavailable',reason:'Station pin missing'};
  if(!centre)return {km:null,basis:'unavailable',reason:'PIN area unavailable'};
  return {km:Math.round(distanceKm(station,centre)*10)/10,basis:'pin_area'};
}
export function compareLeadProximity(a:{id:string;lead_created_at?:string|null;proximity?:LeadProximity},b:typeof a) {
  const local = Number(Boolean(b.proximity?.localPin)) - Number(Boolean(a.proximity?.localPin));
  if(local)return local;
  const delta=(a.proximity?.km??Infinity)-(b.proximity?.km??Infinity);
  if(Number.isFinite(delta)&&delta!==0)return delta;
  if(a.proximity?.km!=null&&b.proximity?.km==null)return -1;
  if(a.proximity?.km==null&&b.proximity?.km!=null)return 1;
  return (b.lead_created_at??'').localeCompare(a.lead_created_at??'')||b.id.localeCompare(a.id);
}
