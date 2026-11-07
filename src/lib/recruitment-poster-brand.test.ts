import { describe, expect, it, vi, beforeEach } from "vitest";
const from = vi.hoisted(() => vi.fn());
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from } }));
import { loadPosterBrand, resolvePosterBrand } from "./recruitment-poster-brand";
const q = (data: unknown, error: unknown = null) => { const c: any = { maybeSingle: async () => ({ data, error }) }; for (const k of ["select", "eq"]) c[k] = vi.fn(() => c); return c; };
beforeEach(() => vi.resetAllMocks());
describe("automatic station branding", () => {
 it("distinguishes quick commerce, last mile, heavy delivery and Flipkart without guessing", () => {
  expect(resolvePosterBrand("AMAZON", "NOW").key).toBe("amazon_now");
  for (const model of ["EDSP", "XPT"]) expect(resolvePosterBrand("AMAZON", model).label).toContain("Last Mile");
  expect(resolvePosterBrand("AMAZON", "AMXL").label).toContain("AMXL");
  expect(resolvePosterBrand("FLIPKART", "MDH").key).toBe("flipkart");
  for (const pair of [["AMAZON", null], ["AMAZON", "UNKNOWN"], ["MEESHO", "FM"], [null, null]]) expect(resolvePosterBrand(...pair as [string|null,string|null]).key).toBe("dropx");
 });
 it("loads the selected station and rejects inconsistent provider/model mappings", async () => {
  const station = q({ provider_id: "amazon", location_model_id: "now" }), provider = q({ id: "amazon", code: "AMAZON" }), model = q({ provider_id: "amazon", code: "NOW" });
  from.mockImplementation((table: string) => ({ stations: station, providers: provider, location_models: model }[table]));
  expect((await loadPosterBrand("company", "station")).key).toBe("amazon_now");
  for (const chain of [station, provider, model]) expect(chain.eq).toHaveBeenCalledWith("company_id", "company");
  model.maybeSingle = async () => ({ data: { provider_id: "flipkart", code: "NOW" }, error: null });
  expect((await loadPosterBrand("company", "station")).key).toBe("dropx");
 });
 it("does not generate with stale assumed branding after a database failure", async () => {
  from.mockReturnValue(q(null, { message: "internal details" }));
  await expect(loadPosterBrand("company", "station")).rejects.toThrow("branding could not be checked");
  expect((await loadPosterBrand("company", null)).key).toBe("dropx");
 });
});
