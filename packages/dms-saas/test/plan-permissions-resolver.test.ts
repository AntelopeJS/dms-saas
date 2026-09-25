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
  registered: [] as string[],
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
vi.mock("@antelopejs/interface-dms/permissions", () => ({
  GetPermissions: async () => permissionTree(harness.registered),
}));
vi.mock("../src/db", async () => ({
  PlanModel: (
    await import("@antelopejs/interface-dms-saas/db/models/plans.model")
  ).PlanModel,
  TenantSubscriptionModel: class TenantSubscriptionModel {},
}));

import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import type { PermissionTree } from "@antelopejs/interface-dms/permissions";
import { registerPlanPermissionsResolver } from "../src/auth/plan-permissions-resolver";
import { setRuntimeConfig } from "../src/config/runtime";
import { PlanModel, TenantSubscriptionModel } from "../src/db";

const STRIPE_CONFIG = {
  secretKey: "sk_test",
  webhookSecret: "whsec_test",
  publishableKey: "pk_test",
};

const NAVIGATION = ["settings", "settings.user", "settings.workspace"];
const PERSONAL_PAGES = [
  "settings.user.profile",
  "settings.user.notifications",
  "settings.user.appearance",
  "settings.user.shortcuts",
];
const EXEMPT = [...NAVIGATION, ...PERSONAL_PAGES];

const MEMBERS_PAGE = "settings.user.members";
const MEMBERS_TABLE_VIEW = "settings.user.members.table.view";
const MEMBERS_TABLE_ADD = "settings.user.members.table.add";
const PROFILE_FORM = "settings.user.profile.profileComponent";
const ROLES_PAGE = "settings.user.roles";
const ROLES_TABLE = "settings.user.roles.table";
const BILLING_PLAN_CARD = "settings.workspace.billing.planCard";

function permissionTree(ids: string[]): Record<string, PermissionTree> {
  const tree: Record<string, PermissionTree> = {};
  for (const id of ids) {
    let level = tree;
    const parts = id.split(".");
    parts.forEach((part, index) => {
      level[part] ??= { children: {} };
      if (index === parts.length - 1) {
        level[part].data = { id, title: id };
      }
      level = level[part].children;
    });
  }
  return tree;
}

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

function setMember(isTenantOwner: boolean, tenantId = "tenant-a"): void {
  harness.members.set(`${tenantId}:user`, { isTenantOwner, roleIds: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  setRuntimeConfig({ stripe: STRIPE_CONFIG });
  harness.registered = [];
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
      expect(await resolve(grants)).toEqual(
        new Set(["read", "write", ...EXEMPT]),
      );
    },
  );

  it("intersects non-owner grants without granting missing plan permissions", async () => {
    setMember(false);
    expect(await resolve(["read", "excluded"])).toEqual(
      new Set(["read", ...EXEMPT]),
    );
    expect(await resolve([])).toEqual(new Set(EXEMPT));
  });

  it("does not reuse ownership from another tenant or grant absent members", async () => {
    setMember(false, "tenant-b");
    expect(await resolve([], "tenant-b")).toEqual(new Set(EXEMPT));
    expect(await resolve(["read"], "tenant-c")).toEqual(new Set(["read"]));
    expect(await resolve([])).toEqual(new Set(["read", "write", ...EXEMPT]));
    expect(harness.getModel).toHaveBeenCalledWith(
      TenantMemberModel,
      "tenant-b",
    );
  });

  it.each([true, false])(
    "preserves the platform wildcard (tenant owner: %s)",
    async (isTenantOwner) => {
      setMember(isTenantOwner);
      expect(await resolve(["*", "read", "excluded"])).toEqual(
        new Set(["*", "read"]),
      );
      expect(harness.getModel).not.toHaveBeenCalledWith(
        TenantMemberModel,
        "tenant-a",
      );
    },
  );

  it("grants a wildcard plan's owner every registered permission, never the wildcard", async () => {
    plans.set("child", plan("child", ["*", "write"], null));
    harness.registered = [MEMBERS_TABLE_VIEW, ROLES_TABLE];
    expect(await resolve([])).toEqual(
      new Set(["write", MEMBERS_TABLE_VIEW, ROLES_TABLE, ...EXEMPT]),
    );
  });

  it("removes every explicit grant for an empty plan without mutating input", async () => {
    plans.set("child", plan("child", [], null));
    const current = new Set(["excluded"]);
    const registration = harness.register.mock.calls[0][0];
    expect(await registration.resolver("user", "tenant-a", current)).toEqual(
      new Set(EXEMPT),
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

describe("plan permissions reach what their pages hold", () => {
  beforeEach(() => {
    plans.set(
      "child",
      plan("child", [MEMBERS_PAGE, "settings.workspace.billing"], null),
    );
    harness.registered = [
      ...NAVIGATION,
      MEMBERS_PAGE,
      "settings.user.members.table",
      MEMBERS_TABLE_VIEW,
      MEMBERS_TABLE_ADD,
      "settings.user.profile",
      PROFILE_FORM,
      ROLES_PAGE,
      ROLES_TABLE,
      "settings.workspace.billing",
      BILLING_PLAN_CARD,
      "settings.workspace.billingextra",
    ];
  });

  it("grants an owner the components and actions of every plan page", async () => {
    setMember(true);
    const permissions = await resolve([]);
    for (const id of [
      MEMBERS_TABLE_VIEW,
      MEMBERS_TABLE_ADD,
      BILLING_PLAN_CARD,
    ]) {
      expect(permissions.has(id)).toBe(true);
    }
  });

  it("keeps an owner away from pages the plan leaves out", async () => {
    setMember(true);
    const permissions = await resolve([ROLES_PAGE]);
    expect(permissions.has(ROLES_PAGE)).toBe(false);
    expect(permissions.has(ROLES_TABLE)).toBe(false);
  });

  it("matches descendants by whole id segment, not by prefix", async () => {
    setMember(true);
    expect((await resolve([])).has("settings.workspace.billingextra")).toBe(
      false,
    );
  });

  it("keeps a member's component grants under a plan page and drops the rest", async () => {
    setMember(false);
    const permissions = await resolve([MEMBERS_TABLE_VIEW, ROLES_TABLE]);
    expect(permissions.has(MEMBERS_TABLE_VIEW)).toBe(true);
    expect(permissions.has(ROLES_TABLE)).toBe(false);
    expect(permissions.has(MEMBERS_TABLE_ADD)).toBe(false);
  });

  it.each([true, false])(
    "gives every member their personal pages with their components (tenant owner: %s)",
    async (isTenantOwner) => {
      setMember(isTenantOwner);
      const permissions = await resolve([]);
      for (const id of ["settings", "settings.user.profile", PROFILE_FORM]) {
        expect(permissions.has(id)).toBe(true);
      }
    },
  );

  it("grants navigation entries on their own, not what they hold", async () => {
    setMember(false);
    const permissions = await resolve(["settings.workspace.secret"]);
    expect(permissions.has("settings.workspace")).toBe(true);
    expect(permissions.has("settings.workspace.secret")).toBe(false);
    expect(permissions.has(BILLING_PLAN_CARD)).toBe(false);
  });

  it("follows the configured exemptions instead of the defaults", async () => {
    setRuntimeConfig({
      stripe: STRIPE_CONFIG,
      planExemptPermissions: { personalPages: [ROLES_PAGE], navigation: [] },
    });
    setMember(false);
    const permissions = await resolve([]);
    expect(permissions).toEqual(new Set([ROLES_PAGE, ROLES_TABLE]));
  });

  it("refuses a malformed exemption list", () => {
    expect(() =>
      setRuntimeConfig({
        stripe: STRIPE_CONFIG,
        planExemptPermissions: { navigation: [""] },
      }),
    ).toThrow("planExemptPermissions.navigation");
  });
});
