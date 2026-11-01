import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import Stripe from "stripe";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type Plan,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import {
  assertBalanceCreditWithinCeiling,
  balanceCreditCeilingMinor,
} from "../src/operator-actions/previews";
import { SaasWorkspaceOperatorActionsController } from "../src/routes/platformOwner/workspace-operator-actions";
import {
  awaitsFirstPayment,
  canStartFirstPaidSubscription,
} from "../src/workspaces/first-payment";
import type { WorkspaceOperatorView } from "../src/workspaces/operator-view";
import { createUser } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { implementNotifications } from "./helpers/notifications";
import {
  PLACEHOLDER_SECRET_KEY,
  reinitSuiteStripe,
} from "./helpers/suite-stripe-keys";
import { insertPlan } from "./helpers/plans";
import { SUITE_STRIPE_KEYS, useSuiteStripe } from "./helpers/stripe";
import { seatMembers } from "./helpers/workspaces";
import { httpRefusal } from "./helpers/refusal";

useMongoDatabase("workspace-operator-guards");
const stripe = useSuiteStripe();
implementNotifications();

let OPERATOR: User;
let TENANT_ID = "";
const WORKSPACE_NAME = "Northwind Traders";
let OPERATION_ID = "";
const BILLED_PLAN_ID = "plan_business";

const SEAT_PLAN = fromPartial<Plan>({
  _id: "plan_business",
  price: 49,
  currency: "eur",
  interval: "month",
  billingMode: "seat",
  maxMembers: 25,
});

function view(
  overrides: Partial<WorkspaceOperatorView> = {},
): WorkspaceOperatorView {
  return fromPartial<WorkspaceOperatorView>({
    plan: SEAT_PLAN,
    subscription: fromPartial<TenantSubscription>({ isComplimentary: false }),
    seats: {
      members: 22,
      pendingInvites: 1,
      occupied: 23,
      platformSupport: [],
    },
    ...overrides,
  });
}

function operatorController(): SaasWorkspaceOperatorActionsController {
  const controller = new SaasWorkspaceOperatorActionsController();
  controller.tenantModel = GetModel(TenantModel);
  return controller;
}

/** Stores a workspace paying a seat plan through Stripe, 23 seats taken. */
async function seedBilledWorkspace(): Promise<void> {
  await GetModel(TenantSubscriptionModel, TENANT_ID).insert({
    _id: TENANT_ID,
    planId: BILLED_PLAN_ID,
    status: "active",
    isComplimentary: false,
    paidUsagePeriods: [],
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    currentPeriodEnd: new Date("2026-10-31T00:00:00Z"),
  });
  await GetModel(TenantBillingInfoModel, TENANT_ID).insert({
    _id: TENANT_ID,
    customerType: "business",
    updatedAt: new Date(),
  });
  await seatMembers(TENANT_ID, 23);
}

beforeAll(async () => {
  OPERATOR = await createUser({ owner: true, email: "op@ops.test" });
  await insertPlan({
    _id: BILLED_PLAN_ID,
    price: 49,
    billingMode: "seat",
    maxMembers: 25,
    paymentProviderRefs: { stripePriceId: "price_business" },
  });
  await insertPlan({
    _id: "plan_pro",
    price: 99,
    billingMode: "seat",
    maxMembers: 50,
    paymentProviderRefs: { stripePriceId: "price_pro" },
  });
});

beforeEach(async () => {
  TENANT_ID = randomUUID();
  OPERATION_ID = `operation-${randomUUID()}`;
  const now = new Date();
  await GetModel(TenantModel).insert({
    _id: TENANT_ID,
    name: WORKSPACE_NAME,
    createdAt: now,
    updatedAt: now,
  });
});

describe("Stripe credit ceiling", () => {
  it("allows up to a year of what the plan bills at the current seats", () => {
    expect(balanceCreditCeilingMinor(view())).toBe(4_900 * 23 * 12);
  });

  it("allows nothing on a workspace billed nothing", () => {
    expect(balanceCreditCeilingMinor(view({ plan: null }))).toBe(0);
    expect(
      balanceCreditCeilingMinor(
        view({
          subscription: fromPartial<TenantSubscription>({
            isComplimentary: true,
          }),
        }),
      ),
    ).toBe(0);
  });

  it("refuses a credit above the ceiling, and any on a workspace billed nothing", () => {
    expect(() =>
      assertBalanceCreditWithinCeiling(view(), 4_900 * 23 * 12),
    ).not.toThrow();
    expect(() =>
      assertBalanceCreditWithinCeiling(view(), 4_900 * 23 * 12 + 1),
    ).toThrow(
      expect.objectContaining({
        body: "saas.errors.operator.credit_over_ceiling",
      }),
    );
    expect(() =>
      assertBalanceCreditWithinCeiling(view({ plan: null }), 100),
    ).toThrow(
      expect.objectContaining({
        body: "saas.errors.operator.credit_not_billed",
      }),
    );
  });

  it("is enforced by the credit route before Stripe is called", async () => {
    await seedBilledWorkspace();
    const credit = vi.spyOn(stripe.write.customers, "createBalanceTransaction");

    const error = await httpRefusal(
      operatorController().grantCredit(OPERATOR, TENANT_ID, {
        operationId: OPERATION_ID,
        amountCents: 10_000_000,
        reason: "Goodwill",
      }),
    );

    expect(error).toBeInstanceOf(HTTPResult);
    expect(error).toMatchObject({
      status: 400,
      body: "saas.errors.operator.credit_over_ceiling",
    });
    expect(credit).not.toHaveBeenCalled();
    await expect(
      GetModel(OperatorActionModel).get(OPERATION_ID),
    ).resolves.toBeUndefined();
  });
});

describe("typed confirmation of a suspension", () => {
  /** Stripe pausing the workspace's subscription collection, as a suspension asks. */
  function stubSuspensionStripe() {
    return vi
      .spyOn(stripe.write.subscriptions, "update")
      .mockResolvedValue(fromPartial({}));
  }

  beforeEach(seedBilledWorkspace);

  it("refuses a suspension whose typed name does not match the workspace", async () => {
    const pause = stubSuspensionStripe();
    const error = await httpRefusal(
      operatorController().suspend(OPERATOR, TENANT_ID, {
        operationId: OPERATION_ID,
        confirmName: "Northwind",
      }),
    );

    expect(error).toMatchObject({
      status: 400,
      body: "saas.errors.workspace.confirmation_mismatch",
    });
    await expect(
      GetModel(OperatorActionModel).get(OPERATION_ID),
    ).resolves.toBeUndefined();
    await expect(
      GetModel(TenantSubscriptionModel, TENANT_ID).findOne(),
    ).resolves.toMatchObject({ status: "active" });
    expect(pause).not.toHaveBeenCalled();
  });

  it("suspends once the workspace name is typed", async () => {
    const pause = stubSuspensionStripe();

    await operatorController().suspend(OPERATOR, TENANT_ID, {
      operationId: OPERATION_ID,
      confirmName: ` ${WORKSPACE_NAME} `,
    });

    await expect(
      GetModel(OperatorActionModel).get(OPERATION_ID),
    ).resolves.toMatchObject({
      tenantId: TENANT_ID,
      action: "workspace.suspend",
      status: "succeeded",
      actorId: OPERATOR._id,
      actorEmail: OPERATOR.email,
    });
    await expect(
      GetModel(TenantSubscriptionModel, TENANT_ID).findOne(),
    ).resolves.toMatchObject({ status: "suspended" });
    expect(pause).toHaveBeenCalledWith(
      "sub_1",
      { pause_collection: { behavior: "void" } },
      { idempotencyKey: `operator-suspend:${OPERATION_ID}` },
    );
  });
});

describe("first payment of a workspace its owner pays", () => {
  const pending = fromPartial<TenantSubscription>({
    status: "pending_payment",
    stripeSubscriptionId: null,
    isComplimentary: false,
    deletionStartedAt: null,
  });

  it("lets the owner of a workspace waiting for its first payment reach checkout", () => {
    expect(awaitsFirstPayment(pending)).toBe(true);
    expect(canStartFirstPaidSubscription(pending)).toBe(true);
  });

  it("does not open checkout for a workspace already billed by Stripe or being deleted", () => {
    expect(
      awaitsFirstPayment({ ...pending, stripeSubscriptionId: "sub_1" }),
    ).toBe(false);
    expect(
      awaitsFirstPayment({ ...pending, deletionStartedAt: new Date() }),
    ).toBe(false);
    expect(awaitsFirstPayment({ ...pending, status: "suspended" })).toBe(false);
    expect(canStartFirstPaidSubscription(undefined)).toBe(false);
  });

  it("still lets an expired gift pick its first paid plan", () => {
    expect(
      canStartFirstPaidSubscription({
        ...pending,
        status: "active",
        isComplimentary: true,
        freeUntil: new Date(Date.now() - 1_000),
      }),
    ).toBe(true);
  });
});

describe("operator actions without a usable Stripe", () => {
  const NOT_CONFIGURED = {
    status: 503,
    body: "saas.errors.stripe.not_configured",
  };

  beforeEach(async () => {
    reinitSuiteStripe(stripe, PLACEHOLDER_SECRET_KEY);
    await seedBilledWorkspace();
  });

  afterEach(() => {
    reinitSuiteStripe(stripe, SUITE_STRIPE_KEYS.secretKey);
  });

  it("refuses to price an upgrade before Stripe is called", async () => {
    const retrieve = vi.spyOn(stripe.write.subscriptions, "retrieve");

    await expect(
      operatorController().getUpgradePreview(OPERATOR, TENANT_ID, "plan_pro"),
    ).rejects.toMatchObject(NOT_CONFIGURED);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("answers a handled 503 when Stripe refuses the key on an upgrade preview", async () => {
    reinitSuiteStripe(stripe, SUITE_STRIPE_KEYS.secretKey);
    vi.spyOn(stripe.write.subscriptions, "retrieve").mockRejectedValueOnce(
      new Stripe.errors.StripeAuthenticationError({
        message: "Invalid API Key provided: sk_test_*******lder",
        type: "authentication_error",
      }),
    );

    await expect(
      operatorController().getUpgradePreview(OPERATOR, TENANT_ID, "plan_pro"),
    ).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.stripe.unavailable",
    });
  });

  it("refuses an upgrade before the journal records an attempt", async () => {
    await expect(
      operatorController().upgrade(OPERATOR, TENANT_ID, {
        operationId: OPERATION_ID,
        planId: "plan_pro",
      }),
    ).rejects.toMatchObject(NOT_CONFIGURED);
    await expect(
      GetModel(OperatorActionModel).get(OPERATION_ID),
    ).resolves.toBeUndefined();
  });

  it("refuses a balance credit before the journal records an attempt", async () => {
    await expect(
      operatorController().grantCredit(OPERATOR, TENANT_ID, {
        operationId: OPERATION_ID,
        amountCents: 1_000,
        reason: "Goodwill",
      }),
    ).rejects.toMatchObject(NOT_CONFIGURED);
    await expect(
      GetModel(OperatorActionModel).get(OPERATION_ID),
    ).resolves.toBeUndefined();
  });
});
