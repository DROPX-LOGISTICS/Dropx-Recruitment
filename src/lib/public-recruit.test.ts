import { beforeAll, describe, expect, it } from "vitest";
import { allowedOrigin, cleanAttribution, issueIntakeToken, validPhone, verifyIntakeToken } from "./public-recruit";
beforeAll(()=>{process.env.SUPABASE_SERVICE_ROLE_KEY="test-only-signing-key";});
describe("public recruitment boundary",()=>{
 it("accepts Indian mobile formats and rejects junk prefixes",()=>{
  expect(validPhone("+91 98765 43210")).toBe("9876543210");
  expect(validPhone("00919876543210")).toBeNull();
  expect(validPhone("5987654321")).toBeNull();
 });
 it("rejects tampered, premature and expired submission tokens",()=>{
  const now=Date.now(),token=issueIntakeToken(now);
  expect(verifyIntakeToken(token,now+2000)).toBeTruthy();
  expect(verifyIntakeToken(token,now)).toBeNull();
  expect(verifyIntakeToken(token,now+7200001)).toBeNull();
  expect(verifyIntakeToken(token.slice(0,-1)+(token.endsWith("a")?"b":"a"),now+2000)).toBeNull();
 });
 it("allows the website while rejecting unrelated browser origins",()=>{
  expect(allowedOrigin(new Request("https://recruit.dropxlogistics.com/api/public/recruit/apply",{headers:{origin:"https://www.dropxlogistics.com"}}))).toBe(true);
  expect(allowedOrigin(new Request("https://recruit.dropxlogistics.com/api/public/recruit/apply",{headers:{origin:"https://unrelated.example"}}))).toBe(false);
 });
 it("retains campaign attribution without accepting arbitrary objects",()=>{
  expect(cleanAttribution({utm_source:"linkedin",secret:"no",utm_campaign:{a:1}})).toEqual({utm_source:"linkedin"});
 });
});
