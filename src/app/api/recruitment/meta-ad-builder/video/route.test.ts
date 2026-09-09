import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({session:vi.fn(),allowed:vi.fn(),getBucket:vi.fn(),createBucket:vi.fn(),signedUpload:vi.fn(),list:vi.fn(),signedRead:vi.fn(),remove:vi.fn(),upload:vi.fn(),video:vi.fn()}));
vi.mock("@/lib/recruitment-api",()=>({recruitmentSession:mocks.session,canUseRecruitmentMenu:mocks.allowed,requiredEnv:(name:string)=>name==="RECRUITMENT_COMPANY_ID"?"company-1":"private-test-secret"}));
vi.mock("@/lib/supabase-admin",()=>({supabaseAdmin:{storage:{getBucket:mocks.getBucket,createBucket:mocks.createBucket,from:()=>({createSignedUploadUrl:mocks.signedUpload,list:mocks.list,createSignedUrl:mocks.signedRead,remove:mocks.remove})}}}));
vi.mock("@/lib/meta-ad-builder",()=>({getMetaVideo:mocks.video,uploadMetaAdVideoFromUrl:mocks.upload}));
import { POST } from "./route";
const request=(body:Record<string,unknown>)=>new Request("https://recruit.test/api/video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stream:"workforce",...body})});
beforeEach(()=>{
  vi.resetAllMocks();mocks.session.mockResolvedValue({profileId:"actor-1"});mocks.allowed.mockReturnValue(true);
  mocks.getBucket.mockResolvedValue({data:{public:false},error:null});
  mocks.signedUpload.mockResolvedValue({data:{signedUrl:"https://storage.test/signed-upload"},error:null});
  mocks.signedRead.mockResolvedValue({data:{signedUrl:"https://storage.test/private-read"},error:null});
  mocks.upload.mockResolvedValue("99999");mocks.remove.mockResolvedValue({error:null});
});
async function start(){const response=await POST(request({action:"start",fileName:"reel.mp4",contentType:"video/mp4",size:29959331}));expect(response.status).toBe(200);return response.json();}
describe("video upload API",()=>{
  it("requires creative-upload permission before issuing an upload URL",async()=>{
    mocks.session.mockResolvedValue(null);expect((await POST(request({action:"start"}))).status).toBe(401);
    mocks.session.mockResolvedValue({profileId:"actor-1"});mocks.allowed.mockReturnValue(false);
    expect((await POST(request({action:"start"}))).status).toBe(403);expect(mocks.signedUpload).not.toHaveBeenCalled();
  });
  it("accepts metadata for a 30MB file without sending its bytes through the app",async()=>{
    const result=await start();expect(result.uploadUrl).toContain("signed-upload");expect(result).not.toHaveProperty("serviceRoleKey");
    expect((await POST(request({action:"start",fileName:"too-big.mp4",contentType:"video/mp4",size:51*1024*1024}))).status).toBe(400);
  });
  it("checks the stored object before sending it to Meta and only deletes it once processing is ready",async()=>{
    const uploaded=await start();const path=mocks.signedUpload.mock.calls[0][0];const name=path.split("/").at(-1);
    mocks.list.mockResolvedValue({data:[{name,metadata:{size:12,mimetype:"video/mp4"}}],error:null});
    expect((await POST(request({action:"complete",ticket:uploaded.ticket}))).status).toBe(400);expect(mocks.upload).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue({data:[{name,metadata:{size:29959331,mimetype:"video/mp4"}}],error:null});
    const sent=await (await POST(request({action:"complete",ticket:uploaded.ticket}))).json();
    expect(mocks.upload).toHaveBeenCalledWith("https://storage.test/private-read","reel.mp4");
    mocks.video.mockResolvedValue({status:"processing"});expect((await (await POST(request({action:"status",ticket:sent.ticket}))).json()).ready).toBe(false);expect(mocks.remove).not.toHaveBeenCalled();
    mocks.video.mockResolvedValue({status:"ready",videoUrl:"https://video.test/reel.mp4"});expect((await (await POST(request({action:"status",ticket:sent.ticket}))).json()).ready).toBe(true);expect(mocks.remove).toHaveBeenCalledWith([path]);
  });
});
