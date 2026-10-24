import {adBudget,ist,type MailActivity,type MailAd,type MailGroup} from './ad-manager-mail-model';

const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const amount=(value:unknown):number|null=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const money=(value:number|null)=>value===null?'Unavailable':`₹${value.toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const day=(value:string)=>Number.isFinite(Date.parse(value))?ist(new Date(value)).slice(0,10):'';
const stamp=(value:string)=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});

/** Same lifetime-spend snapshot as Recruit Active Ads, never budget × run days. */
export function adSpendToDate(ad:MailAd):number|null {
 const insights=ad.raw_payload?.insights?.data;
 if(Array.isArray(insights))return insights.length?amount(insights[0]?.spend):0;
 const stored=amount(ad.total_spend);
 // Older ingestion defaulted missing insights to zero. Do not present that as verified spend.
 return stored!==null&&stored>0?stored:null;
}

export function activeMailAds(group:MailGroup) {
 return [...new Map(group.ads.filter(ad=>ad.status==='ACTIVE'&&group.stations.includes(ad.stationId)).map(ad=>[ad.id,ad])).values()]
  .sort((a,b)=>a.station.localeCompare(b.station)||a.ad_name.localeCompare(b.ad_name));
}

/** One meaningful net-change line per active ad, not one line per poll. */
export function adChangesToday(ad:MailAd,activities:MailActivity[],date:string,asOf:string) {
 const rows=activities.filter(row=>row.ad_id===ad.id&&row.station_id===ad.stationId&&day(row.occurred_at)===date&&Date.parse(row.occurred_at)<=Date.parse(asOf))
  .sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at));
 const changes:string[]=[];
 const budgets=rows.filter(row=>row.change_types?.includes('budget')||(!row.change_types?.length&&row.previous_budget!=null&&row.current_budget!=null&&row.previous_budget!==row.current_budget));
 if(budgets.length){
  const before=amount(budgets[0].previous_budget),last=budgets[budgets.length-1],after=amount(last.current_budget);
  if(before!==null&&after!==null&&before!==after)changes.push(`Budget ${after>before?'increased':'reduced'}: ${money(before)} → ${money(after)}${last.budget_kind==='daily'?'/day':last.budget_kind==='lifetime'?' total budget':''}`);
 }
 const started=rows.some(row=>row.change_types?.includes('new_ad'))&&Boolean(ad.created_on&&day(ad.created_on)===date);
 const statuses=rows.filter(row=>row.previous_status!==null&&row.previous_status!==row.current_status&&(row.change_types?.includes('status')||!row.change_types?.length));
 if(started)changes.push('Started today');
 else if(statuses.length&&statuses[0].previous_status!=='ACTIVE'&&statuses[statuses.length-1].current_status==='ACTIVE')changes.push(statuses[0].previous_status==='PAUSED'?'Resumed today':'Now active');
 // Legacy poster rows were based on volatile URLs. Only stable-identity observations are authoritative.
 if(rows.some(row=>row.change_types?.includes('poster')&&row.change_types.includes('creative_verified')))changes.push('Poster updated');
 return changes.join(' · ');
}

function budgetText(ad:MailAd) {
 const budget=adBudget(ad);
 if(!Number.isFinite(budget.amount)||budget.amount<=0||budget.kind==='unknown')return 'Unavailable';
 return `${money(budget.amount)}${budget.kind==='daily'?'/day':' total budget'}${budget.source==='campaign'?' · campaign':ad.budgetShared?' · shared ad set':''}`;
}

function poster(ad:MailAd,images:Record<string,string>) {
 const cid=images[ad.id];
 return cid?`<img src="cid:${escapeHtml(cid)}" alt="${escapeHtml(ad.station)} ad poster" width="76" height="84" style="display:block;width:76px;height:84px;object-fit:contain;border-radius:6px;background:#f2f4f7">`
  :`<div style="width:76px;height:84px;background:#f2f4f7;border-radius:6px;color:#667085;text-align:center;font-size:10px;line-height:15px"><br><br>${ad.poster_url?'Poster in Recruit':'No poster preview'}</div>`;
}

export function renderManagerMail(input:{group:MailGroup;kind:'daily'|'event';date:string;sample?:boolean;activities?:MailActivity[];images?:Record<string,string>;asOf?:string}) {
 const {group,date,sample,activities=[],images={}}=input;
 const asOf=input.asOf||`${date}T13:00:00+05:30`;
 const ads=activeMailAds(group);
 const changes=new Map(ads.map(ad=>[ad.id,adChangesToday(ad,activities,date,asOf)]));
 const ordered=ads.slice().sort((a,b)=>Number(Boolean(changes.get(b.id)))-Number(Boolean(changes.get(a.id)))||a.station.localeCompare(b.station)||a.ad_name.localeCompare(b.ad_name));
 const visible=ordered;
 const changed=ads.filter(ad=>changes.get(ad.id)).length;
 const summary=`${ads.length} active ads · ${new Set(ads.map(ad=>ad.stationId)).size} locations · ${changed?`${changed} ${changed===1?'ad':'ads'} changed today`:'No changes today'}`;
 const cards=visible.map(ad=>{
  const location=ad.stationName&&ad.stationName!==ad.station?`${ad.station} · ${ad.stationName}`:ad.station;
  const update=changes.get(ad.id);
  const metrics=[['Budget',budgetText(ad)],['Spent today',money(amount(ad.spend_today))],['Spent to date',money(adSpendToDate(ad))]];
  return `<tr><td style="padding:13px 0;border-bottom:1px solid #e7e9ef"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="88" valign="top">${poster(ad,images)}</td><td valign="top" style="word-break:break-word"><div style="font-size:13px;line-height:19px;font-weight:bold;color:#18243d">${escapeHtml(location)} · ${escapeHtml(ad.role)}</div><div style="font-size:11px;line-height:16px;color:#667085;margin:2px 0 8px">${escapeHtml(ad.ad_name)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${metrics.map(([label,value])=>`<td width="33%" valign="top" style="padding-right:6px"><div style="font-size:10px;line-height:14px;color:#667085">${label}</div><div style="font-size:12px;line-height:17px;font-weight:bold;color:#18243d">${escapeHtml(value)}</div></td>`).join('')}</tr></table>${update?`<div style="font-size:11px;line-height:16px;margin-top:8px;color:#874314;background:#fff6e8;padding:6px 8px;border-radius:5px"><b>Today:</b> ${escapeHtml(update)}</div>`:''}</td></tr></table></td></tr>`;
 }).join('');
 const synced=ads.map(ad=>ad.last_synced_at).filter((value):value is string=>Boolean(value&&Number.isFinite(Date.parse(value)))).sort();
 const freshness=synced.length?`Ad snapshot: ${stamp(synced[0])} IST.`:'Ad snapshot time unavailable.';
 const footnote=`Budget is a cap, not spend. Spend is Meta-reported; spent to date includes earlier runs of the same ad. ${freshness}`;
 const title='Active ads & today’s changes';
 const text=[sample?'SAMPLE — no operational recipient was emailed':'',`DropX Recruit | ${title}`,`${stamp(asOf)} IST`,summary,'',...visible.flatMap(ad=>[
  `${ad.station}${ad.stationName&&ad.stationName!==ad.station?` · ${ad.stationName}`:''} | ${ad.role} | ${ad.ad_name}`,
  `Budget: ${budgetText(ad)} | Spent today: ${money(amount(ad.spend_today))} | Spent to date: ${money(adSpendToDate(ad))}`,
  changes.get(ad.id)?`Today: ${changes.get(ad.id)}`:'',''
 ]),!ads.length?'No active ads in your current station scope.':'','Open DropX Recruit: https://recruit.dropxlogistics.com',footnote].filter(Boolean).join('\n');
 return {subject:`${sample?'[SAMPLE] ':''}DropX Recruit | Active ads & changes | ${date.slice(0,7)}`,text,
  html:`<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#18243d"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(summary)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:18px 10px"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#fff;border:1px solid #e7e9ef;border-radius:12px;overflow:hidden"><tr><td style="padding:18px 20px;background:#19243c;border-top:4px solid #e84827;color:#fff"><div style="font-size:10px;letter-spacing:1px;font-weight:bold;color:#ffc4a8">DROPX RECRUIT${sample?' · SAMPLE':''}</div><h1 style="font-size:20px;line-height:26px;margin:7px 0">${title}</h1><div style="font-size:11px;color:#d7deeb">${escapeHtml(stamp(asOf))} IST · Daily report</div></td></tr><tr><td style="padding:14px 20px 0"><div style="font-size:12px;line-height:18px;padding-bottom:8px;color:#475467">${escapeHtml(summary)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${cards}</table>${!ads.length?'<p style="font-size:13px">No active ads in your current station scope.</p>':''}</td></tr><tr><td style="padding:18px 20px"><a href="https://recruit.dropxlogistics.com" style="display:inline-block;padding:11px 16px;background:#d92d58;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">Open DropX Recruit →</a><p style="font-size:10px;line-height:15px;color:#667085;margin:12px 0 0">${escapeHtml(footnote)}</p></td></tr></table></td></tr></table></body></html>`};
}
