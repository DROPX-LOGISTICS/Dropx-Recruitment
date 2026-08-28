import type { AdRequestAction } from "./recruitment-menu-roles";

export const adRequestStatuses = [
  "requested",
  "under_review",
  "approved",
  "rejected",
  "published",
  "completed",
  "cancelled"
] as const;

export type AdRequestStatus = typeof adRequestStatuses[number];
export type AdRequestLifecycleAction =
  | "review"
  | "approve"
  | "reject"
  | "publish"
  | "complete"
  | "cancel";

const lifecycle: Record<AdRequestStatus, Partial<Record<AdRequestLifecycleAction, AdRequestStatus>>> = {
  requested: { publish: "completed", reject: "rejected", cancel: "cancelled" },
  under_review: { publish: "completed", reject: "rejected", cancel: "cancelled" },
  approved: { publish: "completed" },
  rejected: {},
  published: {},
  completed: {},
  cancelled: {}
};

const permissionForAction: Record<AdRequestLifecycleAction, AdRequestAction> = {
  review: "review",
  approve: "approve",
  reject: "reject",
  publish: "publish",
  complete: "complete",
  cancel: "cancel_own"
};

export function normalizeAdRequestStatus(value: unknown): AdRequestStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  return adRequestStatuses.includes(normalized as AdRequestStatus)
    ? normalized as AdRequestStatus
    : "requested";
}

export function nextAdRequestStatus(
  current: unknown,
  action: AdRequestLifecycleAction
): AdRequestStatus | null {
  return lifecycle[normalizeAdRequestStatus(current)][action] ?? null;
}

export function allowedAdRequestLifecycleActions(input: {
  current: unknown;
  permissions: AdRequestAction[];
  isMine: boolean;
}) {
  const current = normalizeAdRequestStatus(input.current);
  const allowed = new Set(input.permissions);
  return (Object.keys(lifecycle[current]) as AdRequestLifecycleAction[]).filter((action) => {
    if (action === "cancel") return input.isMine && allowed.has("cancel_own");
    if (action === "publish" && ["requested", "under_review"].includes(current)) {
      return allowed.has("approve");
    }
    return allowed.has(permissionForAction[action]);
  });
}
