import { describe, expect, it } from "vitest";
import { orderTenantIdsByPreference } from "../src/workspaces/billing-profile";

const TENANTS = ["t-alpha", "t-beta", "t-gamma"];

describe("orderTenantIdsByPreference", () => {
  it("reads the current workspace's billing identity first", () => {
    expect(orderTenantIdsByPreference(TENANTS, "t-beta")).toEqual([
      "t-beta",
      "t-alpha",
      "t-gamma",
    ]);
  });

  it("ignores a tenant the user is not a member of", () => {
    expect(orderTenantIdsByPreference(TENANTS, "t-someone-else")).toEqual(
      TENANTS,
    );
  });

  it("keeps the membership order when no preference is given", () => {
    expect(orderTenantIdsByPreference(TENANTS)).toEqual(TENANTS);
  });

  it("never duplicates the preferred tenant", () => {
    const ordered = orderTenantIdsByPreference(TENANTS, "t-alpha");

    expect(ordered).toEqual(TENANTS);
    expect(new Set(ordered).size).toBe(ordered.length);
  });
});
