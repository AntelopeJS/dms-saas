import type { PermissionsResolverInfo } from "@antelopejs/interface-dms/permissions-resolver";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@antelopejs/interface-dms-saas/db/tables/plans.table";

interface SubscriptionFixture {
  planId?: string;
}

interface MemberFixture {
  isTenantOwner: boolean;
  roleIds: string[];
}

const harness = vi.hoisted(() => ({
  register: vi.fn<(info: PermissionsResolverInfo) => void>(),
  getModel: vi.fn(),
  subscription: { planId: "child" } as SubscriptionFixture | undefined,
  members: new Map<string, MemberFixture>(),
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return { ...actual, GetModel: harness.getModel };
});
vi.mock("@antelopejs/interface-dms/permissions-resolver", () => ({
  RegisterPermissionsResolver: harness.register,
}));
vi.mock("../src/db", async () => ({
  PlanModel: (
    await import("@antelopejs/interface-dms-saas/db/models/plans.model")
  ).PlanModel,
  TenantSubscriptionModel: class TenantSubscriptionModel {},
}));

import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { registerPlanPermissionsResolver } from "../src/auth/plan-permissions-resolver";
import { PlanModel, TenantSubscriptionModel } from "../src/db";

const plans = new Map<string, Plan>();
const planModel: PlanModel = Object.create(PlanModel.prototype);
planModel.get = vi.fn(async (id: string) => plans.get(id));

function plan(id: string, permissions: string[], parent: string | null): Plan {
  return Object.assign(Object.create(null), {
    _id: id,
    permissions,
    features: [],
    inheritsFromPlanId: parent,
  });
}

function resolve(current: string[], tenantId = "tenant-a") {
  const registration = harness.register.mock.calls[0][0];
  return registration.resolver("user", tenantId, new Set(current));
}

beforeEach(() => {
  vi.clearAllMocks();
  plans.clear();
  plans.set("parent", plan("parent", ["read"], null));
  plans.set("child", plan("child", ["write"], "parent"));
  harness.subscription = { planId: "child" };
  harness.members.clear();
  harness.members.set("tenant-a:user", { isTenantOwner: true, roleIds: [] });
  harness.getModel.mockImplementation((model, tenantId) => {
    if (model === PlanModel) return planModel;
    if (model === TenantSubscriptionModel) {
      return { findOne: async () => harness.subscription };
    }
    if (model === TenantMemberModel) {
      return {
        getByUser: async (userId: string) =>
          harness.members.get(`${tenantId}:${userId}`),
      };
    }
    throw new Error("Unexpected model");
  });
  registerPlanPermissionsResolver();
});

describe("plan permissions policy", () => {
  it.each([{ grants: [] }, { grants: ["read", "excluded"] }])(
    "grants the inherited plan to an owner with incoming grants $grants",
    async ({ grants }) => {
      harness.members.set("tenant-a:user", {
        isTenantOwner: true,
        roleIds: grants.length ? ["owner-role"] : [],
      });
      expect(await resolve(grants)).toEqual(new Set(["read", "write"]));
    },
  );

  it("intersects non-owner grants without granting missing plan permissions", async () => {
    harness.members.set("tenant-a:user", {
      isTenantOwner: false,
      roleIds: ["editor"],
    });
    expect(await resolve(["read", "excluded"])).toEqual(new Set(["read"]));
    expect(await resolve([])).toEqual(new Set());
  });

  it("does not reuse ownership from another tenant or grant absent members", async () => {
    harness.members.set("tenant-b:user", { isTenantOwner: false, roleIds: [] });
    expect(await resolve([], "tenant-b")).toEqual(new Set());
    expect(await resolve([], "tenant-c")).toEqual(new Set());
    expect(await resolve([])).toEqual(new Set(["read", "write"]));
    expect(harness.getModel).toHaveBeenCalledWith(
      TenantMemberModel,
      "tenant-b",
    );
  });

  it.each([true, false])(
    "preserves the platform wildcard (tenant owner: %s)",
    async (isTenantOwner) => {
      harness.members.set("tenant-a:user", { isTenantOwner, roleIds: [] });
      expect(await resolve(["*", "read", "excluded"])).toEqual(
        new Set(["*", "read"]),
      );
      expect(harness.getModel).not.toHaveBeenCalledWith(
        TenantMemberModel,
        "tenant-a",
      );
    },
  );

  it("never grants a tenant wildcard, even if a plan contains one", async () => {
    plans.set("child", plan("child", ["*", "write"], null));
    expect(await resolve([])).toEqual(new Set(["write"]));
  });

  it("removes every explicit grant for an empty plan without mutating input", async () => {
    plans.set("child", plan("child", [], null));
    const current = new Set(["excluded"]);
    const registration = harness.register.mock.calls[0][0];
    expect(await registration.resolver("user", "tenant-a", current)).toEqual(
      new Set(),
    );
    expect(current).toEqual(new Set(["excluded"]));
  });

  it.each([undefined, {}, { planId: "missing" }])(
    "preserves incoming permissions without a resolvable plan: %j",
    async (subscription) => {
      harness.subscription = subscription;
      const current = new Set(["existing"]);
      const registration = harness.register.mock.calls[0][0];
      expect(await registration.resolver("user", "tenant-a", current)).toBe(
        current,
      );
      expect(await resolve([])).toEqual(new Set());
      expect(harness.getModel).not.toHaveBeenCalledWith(
        TenantMemberModel,
        "tenant-a",
      );
    },
  );

  it("retains the pipeline registration contract before downstream projections", () => {
    expect(harness.register).toHaveBeenCalledWith({
      id: "dms-saas.plan-intersection",
      order: 100,
      resolver: expect.any(Function),
    });
  });
});
