import { describe, expect, it } from "vitest";
import {
  allowedAdRequestLifecycleActions,
  nextAdRequestStatus
} from "./ad-request-lifecycle";

describe("ad request lifecycle", () => {
  it("makes approval the final action while closing legacy stages", () => {
    expect(nextAdRequestStatus("requested", "publish")).toBe("completed");
    expect(nextAdRequestStatus("under_review", "publish")).toBe("completed");
    expect(nextAdRequestStatus("approved", "publish")).toBe("completed");
    expect(nextAdRequestStatus("published", "complete")).toBeNull();
    expect(nextAdRequestStatus("requested", "approve")).toBeNull();
  });

  it("allows cancellation only for the requester", () => {
    const permissions = ["cancel_own"] as const;
    expect(allowedAdRequestLifecycleActions({
      current: "requested", permissions: [...permissions], isMine: true
    })).toContain("cancel");
    expect(allowedAdRequestLifecycleActions({
      current: "requested", permissions: [...permissions], isMine: false
    })).not.toContain("cancel");
  });

  it("uses configured action permissions instead of role names", () => {
    expect(allowedAdRequestLifecycleActions({
      current: "requested",
      permissions: ["approve"],
      isMine: false
    })).toEqual(["publish"]);
  });
});
