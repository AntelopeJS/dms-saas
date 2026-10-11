import type { PermissionsResolverInfo } from "@antelopejs/interface-dms/permissions-resolver";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  register: vi.fn<(info: PermissionsResolverInfo) => void>(),
  owners: new Set<string>(),
}));

vi.mock("@antelopejs/interface-dms/permissions-resolver", () => ({
  RegisterPermissionsResolver: harness.register,
}));
vi.mock("../src/pages/tenant/owner-only", () => ({
  ownerOnlyPermissionIds: () => ["general.dangerZone", "data-export"],
}));
vi.mock("../src/workspaces/workspace-owner", () => ({
  isWorkspaceOwner: async (userId: string, tenantId: string) =>
    harness.owners.has(`${tenantId}:${userId}`),
}));

import { registerOwnerOnlyPermissionsResolver } from "../src/auth/owner-only-permissions-resolver";

const MEMBER_GRANTS = [
  "general",
  "general.identity",
  "general.dangerZone",
  "general.dangerZone.actions",
  "data-export",
  "data-export.request",
];

function resolve(current: string[], userId = "member") {
  const registration = harness.register.mock.calls[0][0];
  return registration.resolver(userId, "acme", new Set(current));
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.owners = new Set(["acme:owner"]);
  registerOwnerOnlyPermissionsResolver();
});

describe("owner-only surfaces", () => {
  it("withholds the danger zone and the data export from a member granted everything", async () => {
    expect(await resolve(MEMBER_GRANTS)).toEqual(
      new Set([
        "general",
        "general.identity",
        "general.dangerZone.actions",
        "data-export.request",
      ]),
    );
  });

  it("leaves an owner's permissions untouched", async () => {
    expect(await resolve(MEMBER_GRANTS, "owner")).toEqual(
      new Set(MEMBER_GRANTS),
    );
  });

  it("leaves the platform wildcard untouched", async () => {
    expect(await resolve(["*", "data-export"])).toEqual(
      new Set(["*", "data-export"]),
    );
  });

  it("runs after the plan intersection", () => {
    expect(harness.register.mock.calls[0][0].order).toBeGreaterThan(100);
  });
});
