import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { countDaysUntil } from "../frontend-vue/app/composables/useDaysLeft";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BillingSettings,
  type Invoice,
  InvoiceModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import { workspaceInitials } from "../frontend-vue/app/build/public/access";
import {
  buildAccessTimeline,
  resolveAccessBlockReason,
  resolveDataDeletionAt,
  selectOtherWorkspaces,
  toAccessTimelineRules,
} from "../src/routes/tenant/workspace-access";
import {
  addTenantMember,
  createUser,
  tenantRequest,
  useDmsAuth,
} from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { callRoute } from "./helpers/routes";

useMongoDatabase("workspace-access");
useDmsAuth();

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

let OWNER: User;
let MEMBER: User;
let currentTenant = "";
let acmeTenant = "";

/** Stores a workspace with the name and subscription given, its members and who is in. */
async function insertWorkspace(
  tenantId: string,
  name: string,
  subscriptionFields?: TenantSubscription,
): Promise<void> {
  const now = new Date();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name,
    createdAt: now,
    updatedAt: now,
  });
  if (subscriptionFields)
    await GetModel(TenantSubscriptionModel, tenantId).insert({
      ...subscriptionFields,
      _id: tenantId,
    });
}

beforeAll(async () => {
  await insertPlan({ _id: "plan-business", name: "Business" });
});

/** Stores the subscription of the blocked workspace. */
async function subscribeCurrent(row: TenantSubscription): Promise<void> {
  await GetModel(TenantSubscriptionModel, currentTenant).insert({
    ...row,
    _id: currentTenant,
  });
}

/** Serves `GET /api/saas/workspace-access` of the blocked workspace to a user. */
async function getWorkspaceAccess(user: User) {
  return callRoute(
    "get",
    "/api/saas/workspace-access/",
    await tenantRequest(user, currentTenant),
  );
}

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
  beforeEach(async () => {
    OWNER = await createUser({
      email: "peter@initech.test",
      name: "Peter Gibbons",
    });
    MEMBER = await createUser({ email: "milton@initech.test", name: "Milton" });
    currentTenant = randomUUID();
    acmeTenant = randomUUID();
    const goneTenant = randomUUID();
    await insertWorkspace(currentTenant, "Initech");
    await insertWorkspace(
      acmeTenant,
      "Acme",
      subscription({ status: "active" }),
    );
    await insertWorkspace(
      goneTenant,
      "Gone",
      subscription({ status: "cancelled" }),
    );
    await addTenantMember(currentTenant, OWNER, true);
    await addTenantMember(currentTenant, MEMBER);
    await addTenantMember(acmeTenant, OWNER);
    await addTenantMember(goneTenant, OWNER, true);
    await GetModel(InvoiceModel, currentTenant).insert({
      ...INVOICE,
      _id: randomUUID(),
      documentType: "invoice",
      stripeInvoiceId: "in_1",
      status: "open",
    });
  });

  it("gives the workspace owner the invoice to pay and the Stripe portal", async () => {
    await subscribeCurrent(subscription({}));

    const access = await getWorkspaceAccess(OWNER);

    expect(access).toMatchObject({
      blocked: true,
      reason: "suspended",
      isTenantOwner: true,
      canManageInStripe: true,
      workspace: {
        name: "Initech",
        planId: "plan-business",
        planName: "Business",
        memberCount: 2,
      },
      unpaidInvoice: { number: "INV-2026-0911", amount: 49000 },
      dataDeletionAt: null,
    });
    expect(access.timeline[0]?.kind).toBe("invoice_issued");
    expect(access.otherWorkspaces).toEqual([
      {
        _id: acmeTenant,
        name: "Acme",
        planName: "Business",
        status: "active",
        isTenantOwner: false,
      },
    ]);
  });

  it("tells a member whom to ask, without the invoice", async () => {
    await subscribeCurrent(subscription({}));

    const access = await getWorkspaceAccess(MEMBER);

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

  describe("a workspace an owner deleted", () => {
    const deletedAt = new Date(NOW.getTime() - 2 * DAY);

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(deletedAt);
      await subscribeCurrent(
        subscription({
          status: "cancelled",
          deletionRequestedAt: deletedAt,
          deletionRequestedBy: OWNER._id,
        }),
      );
      vi.useRealTimers();
    });

    it("tells the owner they deleted it, restorable until its data goes", async () => {
      const access = await getWorkspaceAccess(OWNER);

      expect(access).toMatchObject({
        reason: "deleted",
        deletion: { at: deletedAt, isByCaller: true, byName: null },
        dataDeletionAt: new Date(deletedAt.getTime() + 30 * DAY),
      });
      expect(access.timeline.map((entry) => entry.kind)).toEqual([
        "deleted",
        "data_deleted",
      ]);
    });

    it("names the owner who deleted it to a member", async () => {
      const access = await getWorkspaceAccess(MEMBER);

      expect(access.deletion).toMatchObject({
        isByCaller: false,
        byName: "Peter Gibbons",
      });
    });

    it("still reads a subscription cancelled otherwise as cancelled", () => {
      expect(
        resolveAccessBlockReason(subscription({ status: "cancelled" }), NOW),
      ).toBe("cancelled");
    });
  });

  it("answers unblocked so the screen can send the caller back in", async () => {
    await subscribeCurrent(subscription({ status: "active" }));

    const access = await getWorkspaceAccess(OWNER);

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
      countDaysUntil(new Date(NOW.getTime() + 25.5 * DAY).toISOString(), NOW),
    ).toBe(26);
    expect(
      countDaysUntil(new Date(NOW.getTime() - DAY).toISOString(), NOW),
    ).toBe(0);
  });
});
