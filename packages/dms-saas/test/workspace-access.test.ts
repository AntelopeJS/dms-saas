import type { RequestContext } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BillingSettings,
  Invoice,
  Plan,
  TenantSubscription,
} from "../src/db";
import {
  daysUntil,
  workspaceInitials,
} from "../frontend-vue/app/build/public/access";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const DAY = 86_400_000;
const CURRENT_TENANT = "tenant-blocked";
const RULES = { autoSuspendDelayDays: 14, dataRetentionDays: 30 };

function subscription(
  overrides: Partial<TenantSubscription>,
): TenantSubscription {
  return {
    _id: "sub",
    planId: "plan-business",
    status: "suspended",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    pastDueSince: new Date(NOW.getTime() - 20 * DAY),
    freeUntil: null,
    isComplimentary: false,
    deletionStartedAt: null,
    createdAt: new Date(NOW.getTime() - 100 * DAY),
    updatedAt: new Date(NOW.getTime() - 5 * DAY),
    ...overrides,
  } as TenantSubscription;
}

const INVOICE = {
  number: "INV-2026-0911",
  amount: 49000,
  total: 49000,
  currency: "eur",
  hostedInvoiceUrl: "https://invoice.stripe.com/i/1",
  issuedAt: new Date(NOW.getTime() - 30 * DAY),
} as Invoice;

const state = vi.hoisted(() => ({
  subscriptions: new Map<string, TenantSubscription | undefined>(),
  members: new Map<string, unknown[]>(),
  memberships: [] as unknown[],
  openInvoice: undefined as Invoice | undefined,
  settings: undefined as BillingSettings | undefined,
}));

vi.mock(
  "@antelopejs/interface-database-decorators",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >()),
    GetModel: (model: { name: string }, instance?: unknown) =>
      ({
        TenantSubscriptionModel: {
          findOne: async () => state.subscriptions.get(String(instance)),
        },
        TenantMemberModel: {
          listAll: async () => state.members.get(String(instance)) ?? [],
          listByUserWithTenantIds: async () => state.memberships,
        },
        BillingSettingsModel: { get: async () => state.settings },
        InvoiceModel: { findLatestOpen: async () => state.openInvoice },
      })[model.name],
  }),
);
vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => CURRENT_TENANT,
}));

const {
  buildAccessTimeline,
  resolveAccessBlockReason,
  resolveDataDeletionAt,
  SaasWorkspaceAccessController,
  selectOtherWorkspaces,
  toAccessTimelineRules,
} = await import("../src/routes/tenant/workspace-access");

const OWNER = { _id: "user-owner", email: "peter@initech.test" } as User;
const MEMBER = { _id: "user-member", email: "milton@initech.test" } as User;
const USERS = new Map([
  [OWNER._id, { ...OWNER, name: "Peter Gibbons" }],
  [MEMBER._id, { ...MEMBER, name: "Milton" }],
]);
const TENANTS = new Map([
  [CURRENT_TENANT, { _id: CURRENT_TENANT, name: "Initech" }],
  ["tenant-acme", { _id: "tenant-acme", name: "Acme" }],
  ["tenant-gone", { _id: "tenant-gone", name: "Gone" }],
]);
const PLANS = new Map([
  ["plan-business", { _id: "plan-business", name: "Business" } as Plan],
]);

function controller() {
  const instance = new SaasWorkspaceAccessController();
  Object.assign(instance, {
    tenantModel: { get: async (id: string) => TENANTS.get(id) },
    planModel: { get: async (id: string) => PLANS.get(id) },
    userModel: { get: async (id: string) => USERS.get(id) },
  });
  return instance;
}

beforeEach(() => {
  state.subscriptions = new Map([
    [CURRENT_TENANT, subscription({})],
    ["tenant-acme", subscription({ status: "active" })],
    ["tenant-gone", subscription({ status: "cancelled" })],
  ]);
  state.members = new Map([
    [
      CURRENT_TENANT,
      [
        { userId: OWNER._id, isTenantOwner: true },
        { userId: MEMBER._id, isTenantOwner: false },
      ],
    ],
  ]);
  state.memberships = [
    { tenantId: CURRENT_TENANT, member: { isTenantOwner: true } },
    { tenantId: "tenant-acme", member: { isTenantOwner: false } },
    { tenantId: "tenant-gone", member: { isTenantOwner: true } },
  ];
  state.openInvoice = INVOICE;
  state.settings = undefined;
});

describe("resolveAccessBlockReason", () => {
  it("reads the blocking statuses as they are", () => {
    expect(resolveAccessBlockReason(subscription({}), NOW)).toBe("suspended");
    expect(
      resolveAccessBlockReason(subscription({ status: "pending_payment" })),
    ).toBe("pending_payment");
    expect(
      resolveAccessBlockReason(subscription({ status: "cancelled" })),
    ).toBe("cancelled");
  });

  it("tells an ended complimentary access from a failed payment", () => {
    const endedGift = subscription({
      isComplimentary: true,
      stripeSubscriptionId: null,
      freeUntil: new Date(NOW.getTime() - 20 * DAY),
    });

    expect(resolveAccessBlockReason(endedGift, NOW)).toBe(
      "complimentary_expired",
    );
  });

  it("is null for a workspace that is not blocked", () => {
    expect(resolveAccessBlockReason(subscription({ status: "past_due" }))).toBe(
      null,
    );
    expect(resolveAccessBlockReason(undefined)).toBeNull();
  });
});

describe("toAccessTimelineRules", () => {
  it("applies the defaults of settings never saved", () => {
    expect(toAccessTimelineRules(undefined)).toEqual(RULES);
  });

  it("drops the suspension date when automatic suspension is off", () => {
    expect(
      toAccessTimelineRules({
        autoSuspendEnabled: false,
        dataRetentionDaysAfterCancellation: 60,
      } as BillingSettings),
    ).toEqual({ autoSuspendDelayDays: null, dataRetentionDays: 60 });
  });
});

describe("buildAccessTimeline", () => {
  it("tells a suspension from the invoice to the suspension", () => {
    const timeline = buildAccessTimeline(
      "suspended",
      subscription({}),
      RULES,
      INVOICE,
      NOW,
    );

    expect(timeline.map((entry) => entry.kind)).toEqual([
      "invoice_issued",
      "payment_failed",
      "suspended",
    ]);
    expect(timeline[2]?.at).toEqual(new Date(NOW.getTime() - 6 * DAY));
    expect(timeline.every((entry) => !entry.isUpcoming)).toBe(true);
  });

  it("leaves the invoice out when the caller may not see it", () => {
    const timeline = buildAccessTimeline(
      "suspended",
      subscription({}),
      RULES,
      undefined,
      NOW,
    );

    expect(timeline.map((entry) => entry.kind)).toEqual([
      "payment_failed",
      "suspended",
    ]);
  });

  it("gives a cancelled workspace its deletion deadline", () => {
    const timeline = buildAccessTimeline(
      "cancelled",
      subscription({ status: "cancelled" }),
      RULES,
      undefined,
      NOW,
    );

    expect(timeline).toEqual([
      {
        kind: "cancelled",
        at: new Date(NOW.getTime() - 5 * DAY),
        isUpcoming: false,
      },
      {
        kind: "data_deleted",
        at: new Date(NOW.getTime() + 25 * DAY),
        isUpcoming: true,
      },
    ]);
  });
});

describe("resolveDataDeletionAt", () => {
  it("only schedules deletion for a cancelled workspace", () => {
    expect(
      resolveDataDeletionAt(subscription({ status: "cancelled" }), RULES),
    ).toEqual(new Date(NOW.getTime() + 25 * DAY));
    expect(resolveDataDeletionAt(subscription({}), RULES)).toBeNull();
  });
});

describe("selectOtherWorkspaces", () => {
  it("leaves out the blocked workspace and the cancelled ones", () => {
    const rows = [
      { _id: CURRENT_TENANT, status: "suspended" },
      { _id: "a", status: "active" },
      { _id: "b", status: "cancelled" },
      { _id: "c", status: null },
    ].map((row) => ({
      ...row,
      name: row._id,
      planName: null,
      isTenantOwner: false,
    })) as Parameters<typeof selectOtherWorkspaces>[0];

    expect(
      selectOtherWorkspaces(rows, CURRENT_TENANT).map((row) => row._id),
    ).toEqual(["a", "c"]);
  });
});

describe("GET /api/saas/workspace-access", () => {
  it("gives the workspace owner the invoice to pay and the Stripe portal", async () => {
    const access = await controller().getWorkspaceAccess(
      {} as RequestContext,
      OWNER,
    );

    expect(access).toMatchObject({
      blocked: true,
      reason: "suspended",
      isTenantOwner: true,
      canManageInStripe: true,
      workspace: { name: "Initech", planName: "Business", memberCount: 2 },
      unpaidInvoice: { number: "INV-2026-0911", amount: 49000 },
      dataDeletionAt: null,
    });
    expect(access.timeline[0]?.kind).toBe("invoice_issued");
    expect(access.otherWorkspaces).toEqual([
      {
        _id: "tenant-acme",
        name: "Acme",
        planName: "Business",
        status: "active",
        isTenantOwner: false,
      },
    ]);
  });

  it("tells a member whom to ask, without the invoice", async () => {
    const access = await controller().getWorkspaceAccess(
      {} as RequestContext,
      MEMBER,
    );

    expect(access.isTenantOwner).toBe(false);
    expect(access.unpaidInvoice).toBeNull();
    expect(access.canManageInStripe).toBe(false);
    expect(access.owners).toEqual([
      { name: "Peter Gibbons", email: "peter@initech.test" },
    ]);
    expect(access.timeline.map((entry) => entry.kind)).not.toContain(
      "invoice_issued",
    );
  });

  it("answers unblocked so the screen can send the caller back in", async () => {
    state.subscriptions.set(CURRENT_TENANT, subscription({ status: "active" }));

    const access = await controller().getWorkspaceAccess(
      {} as RequestContext,
      OWNER,
    );

    expect(access).toMatchObject({
      blocked: false,
      reason: null,
      unpaidInvoice: null,
      timeline: [],
    });
  });
});

describe("restricted screen helpers", () => {
  it("draws two-letter workspace tiles", () => {
    expect(workspaceInitials("Northwind Traders")).toBe("NT");
    expect(workspaceInitials("acme")).toBe("AC");
    expect(workspaceInitials("")).toBe("");
  });

  it("counts whole days left, never below zero", () => {
    expect(
      daysUntil(new Date(NOW.getTime() + 25.5 * DAY).toISOString(), NOW),
    ).toBe(26);
    expect(daysUntil(new Date(NOW.getTime() - DAY).toISOString(), NOW)).toBe(0);
  });
});
