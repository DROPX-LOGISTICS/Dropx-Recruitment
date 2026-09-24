import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import RecruitBrand from "./RecruitBrand";
import RecruitLogin from "./RecruitLogin";
import manifest from "./manifest";

vi.mock("next/script", () => ({ default: () => null }));

describe("Recruit identity and sign-in", () => {
  it("retains the original DropX logo alongside a separate Recruit identity", () => {
    const html = renderToStaticMarkup(<RecruitBrand />);
    expect(html).toContain('src="/dropx-logo.png"');
    expect(html).toContain('alt="DropX"');
    expect(html).toContain('src="/brand/recruit-symbol-v1.png"');
    expect(html).toContain("Recruit</span>");
  });
  it("renders labelled mobile sign-in, Google region and the existing APK link", () => {
    const html = renderToStaticMarkup(<RecruitLogin />);
    expect(html).toContain('for="recruit-mobile"');
    expect(html).toContain('autoComplete="tel-national"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-label="Continue with Google"');
    expect(html).toContain('/downloads/dropx-recruitment-android.apk?v=133');
    expect(html).toContain("Delivery associates");
    expect(html).toContain("Corporate talent");
  });
  it("keeps the sign-in form hidden while an existing session is checked", () => {
    const html = renderToStaticMarkup(<RecruitLogin checking />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<form');
  });
  it("provides real correctly-sized PNG home-screen icons", () => {
    const config = manifest();
    expect(config.start_url).toBe("/");
    expect(config.name).toBe("DropX Recruit");
    for (const icon of config.icons ?? []) {
      const bytes = readFileSync(`public${icon.src}`);
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
      expect(icon.sizes).toBe(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
    }
  });
});
