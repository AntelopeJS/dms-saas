import { randomUUID } from "node:crypto";
import { fromPartial } from "@total-typescript/shoehorn";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Plan } from "@antelopejs/interface-dms-saas/db/tables/plans.table";
import { registerPlanPermissionsResolver } from "../src/auth/plan-permissions-resolver";
import {
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import { useMongoDatabase } from "./helpers/mongo";
import {
  implementPermissionsResolvers,
  registeredResolver,
} from "./helpers/permissions-resolvers";

useMongoDatabase("plan-permissions-resolver");
const registered = implementPermissionsResolvers();

interface MemberFixture {
  isTenantOwner: boolean;
  roleIds: string[];
}

/** The workspaces of the current test, each in a tenant of its own. */
const tenants = { a: "", b: "", c: "" };

function plan(id: string, permissions: string[], parent: string | null): Plan {
  return fromPartial<Plan>({
    _id: id,
    permissions,
    features: [],
    inheritsFromPlanId: parent,
  });
}

/** Stores `entry` in the catalogue, in place of a plan with its id. */
async function publishPlan(entry: Plan): Promise<void> {
  await GetModel(PlanModel).delete(entry._id);
  await GetModel(PlanModel).insert(entry);
}

/** Makes `userId` a member of the workspace, in place of any membership it had. */
async function setMember(
  tenantId: string,
  userId: string,
  member: MemberFixture,
): Promise<void> {
  const members = GetModel(TenantMemberModel, tenantId);
  const existing = await members.getByUser(userId);
  if (existing) await members.delete(existing._id);
  await members.insert({
    _id: randomUUID(),
    userId,
    joinedAt: new Date(),
    invitedBy: null,
    ...member,
  });
}

/** Gives the workspace `subscription`, or no subscription when undefined. */
async function subscribe(
  tenantId: string,
  subscription: Partial<TenantSubscription> | undefined,
): Promise<void> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  await model.delete(tenantId);
  if (subscription) await model.insert({ ...subscription, _id: tenantId });
}

/** Watches the workspace's membership reads. */
function membershipReads(tenantId: string) {
  return vi.spyOn(GetModel(TenantMemberModel, tenantId), "getByUser");
}

function planIntersection() {
  return registeredResolver(registered, "dms-saas.plan-intersection");
}

function resolve(current: string[], tenantId = tenants.a) {
  return planIntersection().resolver("user", tenantId, new Set(current), {});
}

beforeAll(() => {
  registerPlanPermissionsResolver();
});

beforeEach(async () => {
  tenants.a = randomUUID();
  tenants.b = randomUUID();
  tenants.c = randomUUID();
  await publishPlan(plan("parent", ["read"], null));
  await publishPlan(plan("child", ["write"], "parent"));
  await subscribe(tenants.a, { planId: "child" });
  await setMember(tenants.a, "user", { isTenantOwner: true, roleIds: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plan permissions policy", () => {
  it.each([{ grants: [] }, { grants: ["read", "excluded"] }])(
    "grants the inherited plan to an owner with incoming grants $grants",
    async ({ grants }) => {
      await setMember(tenants.a, "user", {
        isTenantOwner: true,
        roleIds: grants.length ? ["owner-role"] : [],
      });
      expect(await resolve(grants)).toEqual(new Set(["read", "write"]));
    },
  );

  it("intersects non-owner grants without granting missing plan permissions", async () => {
    await setMember(tenants.a, "user", {
      isTenantOwner: false,
      roleIds: ["editor"],
    });
    expect(await resolve(["read", "excluded"])).toEqual(new Set(["read"]));
    expect(await resolve([])).toEqual(new Set());
  });

  it("does not reuse ownership from another tenant or grant absent members", async () => {
    await subscribe(tenants.b, { planId: "child" });
    await subscribe(tenants.c, { planId: "child" });
    await setMember(tenants.b, "user", { isTenantOwner: false, roleIds: [] });
    const tenantBReads = membershipReads(tenants.b);
    expect(await resolve([], tenants.b)).toEqual(new Set());
    expect(await resolve([], tenants.c)).toEqual(new Set());
    expect(await resolve([])).toEqual(new Set(["read", "write"]));
    expect(tenantBReads).toHaveBeenCalledWith("user");
  });

  it.each([true, false])(
    "preserves the platform wildcard (tenant owner: %s)",
    async (isTenantOwner) => {
      await setMember(tenants.a, "user", { isTenantOwner, roleIds: [] });
      const reads = membershipReads(tenants.a);
      expect(await resolve(["*", "read", "excluded"])).toEqual(
        new Set(["*", "read"]),
      );
      expect(reads).not.toHaveBeenCalled();
    },
  );

  it("never grants a tenant wildcard, even if a plan contains one", async () => {
    await publishPlan(plan("child", ["*", "write"], null));
    expect(await resolve([])).toEqual(new Set(["write"]));
  });

  it("removes every explicit grant for an empty plan without mutating input", async () => {
    await publishPlan(plan("child", [], null));
    const current = new Set(["excluded"]);
    expect(
      await planIntersection().resolver("user", tenants.a, current, {}),
    ).toEqual(new Set());
    expect(current).toEqual(new Set(["excluded"]));
  });

  it.each([undefined, {}, { planId: "missing" }])(
    "preserves incoming permissions without a resolvable plan: %j",
    async (subscription) => {
      await subscribe(tenants.a, subscription);
      const reads = membershipReads(tenants.a);
      const current = new Set(["existing"]);
      expect(
        await planIntersection().resolver("user", tenants.a, current, {}),
      ).toBe(current);
      expect(await resolve([])).toEqual(new Set());
      expect(reads).not.toHaveBeenCalled();
    },
  );

  describe("in a role preview", () => {
    function preview(rolePermissions: string[]) {
      return planIntersection().resolver(
        "preview-user",
        tenants.a,
        new Set(rolePermissions),
        {
          preview: { rolePermissions: new Set(rolePermissions) },
        },
      );
    }

    it("returns the role unchanged without a plan", async () => {
      await subscribe(tenants.a, undefined);
      expect(await preview(["read", "excluded"])).toEqual(
        new Set(["read", "excluded"]),
      );
    });

    it("keeps the role when the plan is wider", async () => {
      expect(await preview(["read"])).toEqual(new Set(["read"]));
    });

    it("caps the role to a narrower plan", async () => {
      expect(await preview(["read", "write", "excluded"])).toEqual(
        new Set(["read", "write"]),
      );
    });

    it("never takes the owner grant, even for an owner's id", async () => {
      await setMember(tenants.a, "preview-user", {
        isTenantOwner: true,
        roleIds: [],
      });
      const reads = membershipReads(tenants.a);
      expect(await preview([])).toEqual(new Set());
      expect(reads).not.toHaveBeenCalled();
    });

    it("keeps the wildcard of a wildcard role", async () => {
      expect(await preview(["*"])).toEqual(new Set(["*"]));
    });

    it("drops a wildcard the role does not hold", async () => {
      expect(
        await planIntersection().resolver(
          "preview-user",
          tenants.a,
          new Set(["*", "read"]),
          {
            preview: { rolePermissions: new Set(["read"]) },
          },
        ),
      ).toEqual(new Set(["read"]));
    });

    it("leaves real calls with an empty context unchanged", async () => {
      expect(
        await planIntersection().resolver(
          "user",
          tenants.a,
          new Set(["read"]),
          {},
        ),
      ).toEqual(new Set(["read", "write"]));
    });
  });

  it("retains the pipeline registration contract before downstream projections", () => {
    expect(registered).toHaveLength(1);
    const { resolver, ...info } = planIntersection();
    expect(info).toEqual({ id: "dms-saas.plan-intersection", order: 100 });
    expect(resolver).toBeTypeOf("function");
  });
});
