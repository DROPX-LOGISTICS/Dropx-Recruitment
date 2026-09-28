import { NextResponse } from 'next/server';
import { recruitmentSession,requiredEnv } from '@/lib/recruitment-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runAdMail,sendManagerSamples } from '@/lib/ad-manager-mail';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request){
 const session=await recruitmentSession(request);
 if(!session?.isOwner||!supabaseAdmin)return NextResponse.json({error:'Owner access required'},{status:403});
 try{const company=requiredEnv('RECRUITMENT_COMPANY_ID');const overview=await runAdMail(company,true);
 const rows=await supabaseAdmin.from('recruitment_ad_mail_deliveries').select('id,kind,status,created_at,sent_at,error').eq('company_id',company).order('created_at',{ascending:false}).limit(100);
 if(rows.error)throw rows.error;
 return NextResponse.json({...overview,recent:rows.data});}catch{return NextResponse.json({error:'Unable to load ad mail status'},{status:500});}
}
export async function POST(request:Request){
 const session=await recruitmentSession(request);
 if(!session?.isOwner||!supabaseAdmin)return NextResponse.json({error:'Owner access required'},{status:403});
 try{const company=requiredEnv('RECRUITMENT_COMPANY_ID');const body=await request.json();
 if(body.action==='sample')return NextResponse.json(await sendManagerSamples(company,session.profileId));
 if(body.action==='retry'&&typeof body.id==='string'){
  const row=await supabaseAdmin.from('recruitment_ad_mail_deliveries').select('status').eq('company_id',company).eq('id',body.id).single();
  if(row.error||!['failed','needs_review'].includes(row.data?.status))return NextResponse.json({error:'Only failed or uncertain deliveries can be retried.'},{status:400});
  if(row.data.status==='needs_review'&&body.confirmedUndelivered!==true)return NextResponse.json({error:'Verify the message was not delivered before retrying.'},{status:400});
  const saved=await supabaseAdmin.from('recruitment_ad_mail_deliveries').update({status:'queued',error:null}).eq('company_id',company).eq('id',body.id).eq('status',row.data.status);
  if(saved.error)throw saved.error;return NextResponse.json({queued:true});
 }
 if(typeof body.enabled!=='boolean')return NextResponse.json({error:'Choose enabled or disabled'},{status:400});
 const result=await supabaseAdmin.from('recruitment_ad_mail_settings').upsert({company_id:company,enabled:body.enabled,updated_at:new Date().toISOString()},{onConflict:'company_id'});
 if(result.error)throw result.error;return NextResponse.json({enabled:body.enabled});
 }catch{return NextResponse.json({error:'Unable to update ad mail. Check the delivery log.'},{status:500});}
}
