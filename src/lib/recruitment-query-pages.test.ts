import { describe, expect, it } from "vitest";
import { recruitmentQueryPages } from "./recruitment-query-pages";
describe("complete diagnostic query evidence",()=>{
 it("includes records beyond the first Supabase page",async()=>expect(await recruitmentQueryPages(async(from)=>({data:from===0?Array.from({length:1000},(_,id)=>({id})):[{id:1000}],error:null}))).toHaveLength(1001));
 it("fails if a later page cannot be read",async()=>await expect(recruitmentQueryPages(async(from)=>({data:from===0?Array(1000).fill({}):null,error:from===0?null:new Error("offline")}))).rejects.toThrow("offline"));
});
