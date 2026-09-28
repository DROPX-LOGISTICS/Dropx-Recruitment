import { NextResponse } from 'next/server';
import { runAdMail,sendManagerSamples } from '@/lib/ad-manager-mail';
import { requiredEnv } from '@/lib/recruitment-api';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=300;
const authorized=(r:Request)=>Boolean(process.env.CRON_SECRET&&r.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`);
export async function GET(request:Request){
 if(!authorized(request))return NextResponse.json({error:'Forbidden'},{status:403});
 try{return NextResponse.json(await runAdMail(requiredEnv('RECRUITMENT_COMPANY_ID'),new URL(request.url).searchParams.get('preview')==='1'));}
 catch(error){console.error('recruit-ad-mail cron',error);return NextResponse.json({error:'Ad mail failed; inspect server logs.'},{status:500});}
}
export async function POST(request:Request){
 if(!authorized(request))return NextResponse.json({error:'Forbidden'},{status:403});
 try{const body=await request.json();if(typeof body.sampleProfileId!=='string')return NextResponse.json({error:'Sample profile required'},{status:400});return NextResponse.json(await sendManagerSamples(requiredEnv('RECRUITMENT_COMPANY_ID'),body.sampleProfileId));}
 catch(error){console.error('recruit-ad-mail samples',error);return NextResponse.json({error:'Sample mail failed; inspect server logs.'},{status:500});}
}
