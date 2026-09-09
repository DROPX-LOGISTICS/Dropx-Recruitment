import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session || !supabaseAdmin || !canUseRecruitmentMenu(session, "Job Requisitions", "all", "hr")) return NextResponse.json({error:"Job approval access is required to publish website content."},{status:403});
    const body = await request.json();
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const result = await supabaseAdmin.from("recruitment_job_requisitions").select("id,status,approved_at,role_id,location_id").eq("company_id",companyId).eq("id",String(body.id)).maybeSingle();
    const job=result.data;
    if (!job || (!session.isOwner && !session.allLocations && !session.locationIds.includes(job.location_id)) || (!session.isOwner && session.roleIds.length && !session.roleIds.includes(job.role_id))) return NextResponse.json({error:"Job not found in your scope."},{status:404});
    const description=String(body.description||"").trim().slice(0,12000), location=String(body.location||"").trim().slice(0,200), published=body.published===true;
    if (published && (job.status!=="open" || !job.approved_at || description.length<80 || location.length<2)) return NextResponse.json({error:"Publish an approved open job with a public location and a candidate-facing description of at least 80 characters."},{status:400});
    const updated=await supabaseAdmin.from("recruitment_job_requisitions").update({website_published:published,website_description:description,website_location:location,updated_by:session.profileId}).eq("id",job.id).eq("company_id",companyId);
    if(updated.error)throw updated.error;
    await supabaseAdmin.from("recruitment_requisition_events").insert({company_id:companyId,requisition_id:job.id,event_type:"website_publication_changed",summary:published?"Published on DropX careers":"Removed from DropX careers",metadata:{published,location},actor_profile_id:session.profileId,actor_email:session.email});
    return NextResponse.json({saved:true});
  }catch(error){console.error("Website publication failed",error);return NextResponse.json({error:"Unable to save website publication."},{status:500});}
}
