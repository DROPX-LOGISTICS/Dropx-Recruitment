import { describe, expect, it } from "vitest";
import { previewUserRole, searchPreviewUsers } from "./preview-user-search";

const users = [
  { profileId: "owner", name: "Owner" },
  { profileId: "akshay", name: "AKSHAY P", email: "akshay@example.test", employeeId: "D1006", designationName: "Cluster Manager" },
  { profileId: "govind", name: "GOVIND NAGARAJU", employeeId: "D0977", designationName: "Store Manager" }
];

describe("preview user search", () => {
  it("searches names, designations, email and employee IDs without case sensitivity", () => {
    for (const query of ["akshay", "D1006", "  akshay manager ", "akshay@example.test"]) {
      expect(searchPreviewUsers(users, "owner", query).map(user => user.profileId)).toEqual(["akshay"]);
    }
    expect(searchPreviewUsers(users, "owner", "store")[0].profileId).toBe("govind");
  });
  it("excludes the viewer, keeps all other results and handles no matches", () => {
    expect(searchPreviewUsers(users, "owner", "")).toHaveLength(2);
    expect(searchPreviewUsers(users, "owner", "owner")).toEqual([]);
    expect(searchPreviewUsers(users, "owner", "unknown")).toEqual([]);
  });
  it("prefers the People designation for display", () => {
    expect(previewUserRole({ ...users[1], roleName: "Legacy role" })).toBe("Cluster Manager");
    expect(previewUserRole(users[0])).toBe("User");
  });
});
