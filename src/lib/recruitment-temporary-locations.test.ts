import { describe, expect, it } from "vitest";
import { temporaryLocationState, validateTemporaryLocationInput, withTemporaryLocations, type TemporaryLocationGrant } from "./recruitment-temporary-locations";
import { groupRecruitNavigation } from "./recruitment-navigation";
import { canAccessLead, applyLeadScope, canManageTemporaryLocations } from "./recruitment-api";

const now = Date.parse("2026-10-07T08:00:00Z");
const grant: TemporaryLocationGrant = { id: "grant", user_access_id: "access", location_id: "extra", starts_at: "2026-10-07T07:00:00Z", expires_at: "2026-10-07T09:00:00Z", revoked_at: null };
const base: any = { profileId: "user", allLocations: false, locationIds: ["normal"], isOwner: false, workforce: true, hr: false, roleIds: ["da"], menuAccess: { workforce: {}, hr: {} } };

describe("temporary Recruit scope", () => {
  it("adds extra locations without changing normal locations, roles or workspaces", () => {
    const effective = withTemporaryLocations(base, [grant, grant], now);
    expect(effective.locationIds).toEqual(["normal", "extra"]);
    expect(effective.baseLocationIds).toEqual(["normal"]);
    expect(effective.allLocations).toBe(false);
    expect(effective.hr).toBe(false);
    expect(base.locationIds).toEqual(["normal"]);
    expect(canAccessLead(effective, { stream: "workforce", location_id: "extra", role_id: "da" })).toBe(true);
    expect(canAccessLead(effective, { stream: "hr", location_id: "extra", role_id: "da" })).toBe(false);
    expect(canAccessLead(effective, { stream: "workforce", location_id: "extra", role_id: "other" })).toBe(false);
    expect(canAccessLead(effective, { stream: "workforce", location_id: "unrelated", role_id: "da" })).toBe(false);
    const filters: any[] = [];
    const query = { in: (column: string, ids: string[]) => { filters.push([column, ids]); return query; }, eq: () => query };
    applyLeadScope(query, effective, "workforce");
    expect(filters).toEqual([["location_id", ["normal", "extra"]], ["role_id", ["da"]]]);
  });
  it.each([
    { ...grant, revoked_at: "2026-10-07T07:30:00Z" },
    { ...grant, expires_at: "2026-10-07T08:00:00Z" },
    { ...grant, starts_at: "2026-10-07T08:00:01Z" },
    { ...grant, expires_at: "not a date" },
    { ...grant, starts_at: "not a date" },
    { ...grant, starts_at: grant.expires_at }
  ])("ignores disabled, expired, future or malformed grant %#", (row) => {
    expect(withTemporaryLocations(base, [row], now).locationIds).toEqual(["normal"]);
  });
  it("starts inclusively and expires exclusively", () => {
    expect(temporaryLocationState(grant, Date.parse(grant.starts_at))).toBe("Active");
    expect(temporaryLocationState(grant, Date.parse(grant.expires_at))).toBe("Expired");
  });
  it("never makes no locations mean all locations", () => {
    const scope = withTemporaryLocations({ ...base, locationIds: [] }, [], now);
    expect(scope.allLocations).toBe(false);
    expect(canAccessLead(scope, { stream: "workforce", location_id: "extra", role_id: "da" })).toBe(false);
  });
  it("leaves global users global and supports custom subsets", () => {
    expect(withTemporaryLocations({ allLocations: true, locationIds: [] }, [grant], now).locationIds).toEqual([]);
    expect(withTemporaryLocations({ allLocations: false, locationIds: ["subset"] }, [grant], now).locationIds).toEqual(["subset", "extra"]);
  });
  it("does not turn temporary access into delegation authority", () => {
    const editor = { ...base, menuActions: { workforce: { "Access Control": { edit: true } }, hr: {} }, allLocations: true };
    expect(canManageTemporaryLocations(editor)).toBe(false);
    expect(canManageTemporaryLocations({ ...editor, baseAllLocations: false })).toBe(false);
    expect(canManageTemporaryLocations({ ...editor, baseAllLocations: true })).toBe(true);
    expect(canManageTemporaryLocations({ ...editor, baseAllLocations: true, readOnly: true })).toBe(false);
    expect(canManageTemporaryLocations({ ...editor, isOwner: true, isPreview: true })).toBe(false);
  });
});

describe("temporary input", () => {
  const input = { profileId: "00000000-0000-4000-8000-000000000001", requestId: "00000000-0000-4000-8000-000000000002", locationIds: ["00000000-0000-4000-8000-000000000003"], expiresAt: "2026-10-07T18:00:00+05:30", reason: "Urgent coverage" };
  it("normalizes IST expiry and de-duplicates a multi-select batch", () => {
    expect(validateTemporaryLocationInput({ ...input, locationIds: [...input.locationIds, ...input.locationIds] }, now)).toMatchObject({ locationIds: input.locationIds, expiresAt: "2026-10-07T12:30:00.000Z" });
  });
  it.each([{ locationIds: [] }, { locationIds: ["bad"] }, { expiresAt: "" }, { expiresAt: "2026-10-07T08:00:00Z" }, { reason: " " }, { profileId: "" }, { requestId: "" }])("rejects invalid input %#", (overrides) => {
    expect(() => validateTemporaryLocationInput({ ...input, ...overrides }, now)).toThrow();
  });
});

describe("Recruit navigation", () => {
  it("preserves every route and puts access in expandable Settings, not Masters", () => {
    const rows: Array<[string, string, string]> = [["Master", "Station Directory", "Station Directory"], ["Master", "Users & Access", "Access Control"], ["Master", "User Roles", "User Roles"], ["Admin", "Connections", "Connections"], ["Admin", "System Logs", "Audit"], ["Admin", "Reports", "Master Reports"], ["Leads", "All Leads", "All Leads"]];
    const groups = groupRecruitNavigation(rows);
    expect(groups.flatMap(([, items]) => items.map((item) => item[2])).sort()).toEqual(rows.map((item) => item[2]).sort());
    expect(groups.find(([group]) => group === "Settings")?.[1].map((item) => item[2])).toEqual(["Access Control", "User Roles", "Connections", "Audit"]);
    expect(groups.find(([group]) => group === "Masters")?.[1].map((item) => item[2])).toEqual(["Station Directory"]);
  });
});
