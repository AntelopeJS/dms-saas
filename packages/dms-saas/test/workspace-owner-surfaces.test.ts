import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, TenantSubscription } from "../src/db";

interface MemberFake {
  _id: string;
  userId: string;
  isTenantOwner: boolean;
}

interface MembershipFake {
  tenantId: string;
  member: MemberFake;
}

interface InvoiceFake {
  _id: string;
  number: string;
}

const store = vi.hoisted(() => ({
  plans: new Map<string, Plan>(),
  tenants: new Map<string, { _id: string; name: string; createdAt: Date }>(),
  subscriptions: new Map<string, TenantSubscription>(),
  members: new Map<string, MemberFake[]>(),
  users: new Map<string, { _id: string; name: string; email: string }>(),
  invoices: new Map<string, InvoiceFake[]>(),
  openInvoices: new Map<string, InvoiceFake>(),
  memberships: [] as MembershipFake[],
  byFingerprint: [] as TenantSubscription[],
  maxFreeWorkspacesPerCard: undefined as number | undefined,
  usedTrial: false,
}));

const MODEL_FAKES: Record<string, (tenantId?: string) => unknown> = {
  PlanModel: () => ({
    get: async (id: string) => store.plans.get(id),
    findPubliclyVisible: async () => [...store.plans.values()],
  }),
  TenantModel: () => ({
    get: async (id: string) => store.tenants.get(id),
    getMany: async (ids: string[]) =>
      ids.flatMap((id) => {
        const tenant = store.tenants.get(id);
        return tenant ? [tenant] : [];
      }),
  }),
  TenantSubscriptionModel: (tenantId) => ({
    findOne: async () => store.subscriptions.get(tenantId ?? ""),
    findByCardFingerprint: async () => store.byFingerprint,
  }),
  TenantMemberModel: (tenantId) => ({
    listAll: async () => store.members.get(tenantId ?? "") ?? [],
    listByUserWithTenantIds: async (userId: string) =>
      store.memberships.filter(
        (membership) => membership.member.userId === userId,
      ),
  }),
  UserModel: () => ({ get: async (id: string) => store.users.get(id) }),
  InvoiceModel: (tenantId) => ({
    getAllInvoices: async () => store.invoices.get(tenantId ?? "") ?? [],
    findLatestOpen: async () => store.openInvoices.get(tenantId ?? ""),
  }),
  BillingSettingsModel: () => ({
    get: async () =>
      store.maxFreeWorkspacesPerCard === undefined
        ? undefined
        : { maxFreeWorkspacesPerCard: store.maxFreeWorkspacesPerCard },
  }),
  TenantBillingInfoModel: () => ({ findOne: async () => undefined }),
  TrialConsumptionModel: () => ({
    existsForIdentity: async () => store.usedTrial,
  }),
};

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: (model: { name: string }, tenantId?: string) =>
      MODEL_FAKES[model.name](tenantId),
  };
});

vi.mock("../src/plans", () => ({
  getSeatUsage: async (tenantId: string) => ({
    members: (store.members.get(tenantId) ?? []).length,
    pendingInvites: 2,
    occupied: (store.members.get(tenantId) ?? []).length + 2,
    platformSupport: [],
  }),
}));

vi.mock("../src/workspaces/deletion", () => ({
  resolveDataRetentionDays: async () => 30,
}));

const { assertCardMayBackFreeWorkspace, listFreeWorkspacesBackedByCard } =
  await import("../src/workspaces/free-workspaces-per-card");
const { buildWorkspaceCreateOptions, cardRequirementOf } =
  await import("../src/workspaces/self-serve-creation");
const { listMyWorkspaces } = await import("../src/workspaces/my-workspaces");
const { buildWorkspaceOverview } =
  await import("../src/workspaces/workspace-overview");

const FREE = plan({ _id: "free", name: "Free", price: 0, order: 0 });
const PRO = plan({
  _id: "pro",
  name: "Pro",
  price: 2900,
  order: 2,
  trialDays: 14,
  maxMembers: 5,
});
const BUSINESS = plan({
  _id: "business",
  name: "Business",
  price: 4900,
  order: 3,
  audience: "business",
});
const NOW = new Date("2026-10-01T00:00:00.000Z");
const DAY_MS = 86_400_000;
const user = { _id: "camille", email: "camille@acme.test" } as User;

function plan(overrides: Partial<Plan>): Plan {
  return {
    audience: "any",
    trialDays: 0,
    maxMembers: -1,
    interval: "month",
    billingMode: "flat",
    currency: "eur",
    description: "",
    isComplimentary: false,
    ...overrides,
  } as Plan;
}

function subscription(
  tenantId: string,
  overrides: Partial<TenantSubscription>,
): TenantSubscription {
  return {
    _id: tenantId,
    _instance: tenantId,
    status: "active",
    planId: FREE._id,
    isComplimentary: false,
    stripeSubscriptionId: null,
    cardFingerprint: null,
    currentPeriodEnd: null,
    ...overrides,
  } as unknown as TenantSubscription;
}

function addWorkspace(
  tenantId: string,
  name: string,
  members: MemberFake[],
  sub?: Partial<TenantSubscription>,
): void {
  store.tenants.set(tenantId, { _id: tenantId, name, createdAt: NOW });
  store.members.set(tenantId, members);
  members.forEach((member) => store.memberships.push({ tenantId, member }));
  if (sub) store.subscriptions.set(tenantId, subscription(tenantId, sub));
}

function owner(userId: string): MemberFake {
  return { _id: `m-${userId}`, userId, isTenantOwner: true };
}

function member(userId: string): MemberFake {
  return { _id: `m-${userId}`, userId, isTenantOwner: false };
}

beforeEach(() => {
  store.plans = new Map([FREE, PRO, BUSINESS].map((p) => [p._id, p]));
  store.tenants.clear();
  store.subscriptions.clear();
  store.members.clear();
  store.invoices.clear();
  store.openInvoices.clear();
  store.memberships = [];
  store.byFingerprint = [];
  store.maxFreeWorkspacesPerCard = undefined;
  store.usedTrial = false;
  store.users = new Map([
    ["camille", { _id: "camille", name: "Camille Laurent", email: "c@a.test" }],
    ["ines", { _id: "ines", name: "Inès Roy", email: "i@s.test" }],
  ]);
});

describe("free workspaces per card", () => {
  it("counts the live free workspaces a card backs, not paid or complimentary ones", async () => {
    store.byFingerprint = [
      subscription("acme", { planId: FREE._id }),
      subscription("globex", { planId: FREE._id, isComplimentary: true }),
      subscription("initech", { planId: PRO._id }),
    ];

    await expect(listFreeWorkspacesBackedByCard("fp")).resolves.toEqual([
      "acme",
    ]);
  });

  it("refuses the card once it backs as many free workspaces as allowed", async () => {
    store.byFingerprint = [subscription("acme", { planId: FREE._id })];

    await expect(assertCardMayBackFreeWorkspace("fp", 1)).rejects.toMatchObject(
      { status: 409, body: "saas.errors.workspace.free_card_limit_reached" },
    );
    await expect(assertCardMayBackFreeWorkspace("fp", 2)).resolves.toBe(
      undefined,
    );
  });

  it("asks a card of a free plan only while the rule is on", () => {
    expect(cardRequirementOf(FREE, 1)).toBe("verification");
    expect(cardRequirementOf(FREE, 0)).toBe("none");
    expect(cardRequirementOf(PRO, 0)).toBe("payment");
  });
});

describe("workspace creation options", () => {
  it("offers the plans of the caller's audience, in catalogue order, with their card rule", async () => {
    const options = await buildWorkspaceCreateOptions(user);

    expect(options.plans.map((option) => option._id)).toEqual(["free", "pro"]);
    expect(options.plans.map((option) => option.cardRequirement)).toEqual([
      "verification",
      "payment",
    ]);
    expect(options.plans[1]?.trialDays).toBe(14);
  });

  it("offers no trial to an e-mail that already used one", async () => {
    store.usedTrial = true;

    const options = await buildWorkspaceCreateOptions(user);

    expect(options.plans.find((o) => o._id === PRO._id)?.trialDays).toBe(0);
  });

  it("names the caller's own free workspaces that already rest on a card", async () => {
    store.maxFreeWorkspacesPerCard = 1;
    addWorkspace("acme", "acme", [owner("camille")], { cardFingerprint: "fp" });
    addWorkspace("nocard", "No card", [owner("camille")], {});
    addWorkspace("theirs", "Theirs", [member("camille")], {
      cardFingerprint: "fp2",
    });

    const options = await buildWorkspaceCreateOptions(user);

    expect(options.freePerCard).toEqual({ limit: 1, usedBy: ["acme"] });
  });

  it("drops the rule when the billing rules turn it off", async () => {
    store.maxFreeWorkspacesPerCard = 0;

    const options = await buildWorkspaceCreateOptions(user);

    expect(options.freePerCard).toBeNull();
    expect(options.plans[0]?.cardRequirement).toBe("none");
  });
});

describe("my workspaces", () => {
  it("lists the live workspaces, current first, with plan, state and owner", async () => {
    addWorkspace("zeta", "Zeta", [owner("ines"), member("camille")], {
      planId: PRO._id,
      status: "past_due",
      stripeSubscriptionId: "sub_1",
    });
    addWorkspace("acme", "acme", [owner("camille")], { planId: FREE._id });
    addWorkspace("gone", "Gone", [owner("camille")], { status: "cancelled" });

    const rows = await listMyWorkspaces("camille", "zeta");

    expect(rows.map((row) => row._id)).toEqual(["zeta", "acme"]);
    expect(rows[0]).toMatchObject({
      planName: "Pro",
      status: "past_due",
      ownerName: "Inès Roy",
      isOwner: false,
      isCurrent: true,
      membersCount: 2,
    });
    expect(rows[1]).toMatchObject({ status: "free", isOwner: true });
  });
});

describe("workspace overview", () => {
  it("states the seats, the plan, the owners and what deleting does", async () => {
    addWorkspace("acme", "acme", [owner("camille"), member("ines")], {
      planId: PRO._id,
      status: "past_due",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: NOW,
    });
    addWorkspace("north", "Northwind", [owner("camille")], {});
    store.invoices.set("acme", [
      { _id: "i1", number: "INV-1" },
      { _id: "i2", number: "INV-2" },
    ]);
    store.openInvoices.set("acme", { _id: "i2", number: "INV-2" });

    const overview = await buildWorkspaceOverview("acme", "camille", NOW);

    expect(overview.seats).toEqual({
      members: 2,
      pendingInvites: 2,
      occupied: 4,
      maxMembers: 5,
    });
    expect(overview.plan).toMatchObject({ name: "Pro", status: "past_due" });
    expect(overview.owners).toEqual([
      {
        userId: "camille",
        name: "Camille Laurent",
        email: "c@a.test",
        isCaller: true,
      },
    ]);
    expect(overview.invoicesCount).toBe(2);
    expect(overview.unpaidInvoiceNumber).toBe("INV-2");
    expect(overview.destroyedAt).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
    expect(overview.nextWorkspace).toEqual({ _id: "north", name: "Northwind" });
  });

  it("reads unlimited seats as no ceiling", async () => {
    addWorkspace("acme", "acme", [owner("camille")], { planId: FREE._id });

    const overview = await buildWorkspaceOverview("acme", "camille", NOW);

    expect(overview.seats.maxMembers).toBeNull();
    expect(overview.nextWorkspace).toBeNull();
  });

  it("refuses an unknown workspace", async () => {
    await expect(
      buildWorkspaceOverview("missing", "camille", NOW),
    ).rejects.toMatchObject({ status: 404 });
  });
});
