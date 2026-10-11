import { HTTPResult } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, TenantSubscription } from "../src/db";

const subscriptionModel = vi.hoisted(() => ({ findOne: vi.fn() }));
const commands = vi.hoisted(() => ({
  suspendWorkspaceCommand: vi.fn(async () => ({ status: "succeeded" })),
  grantBalanceCreditCommand: vi.fn(async () => ({ status: "succeeded" })),
}));
const operatorView = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...original,
    Model: () => (): void => undefined,
    GetModel: () => subscriptionModel,
  };
});

vi.mock("../src/operator-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/operator-actions")>()),
  ...commands,
  operatorActorOf: (user: User) => ({ id: user._id, email: user.email }),
}));

vi.mock("../src/workspaces/operator-view", () => ({
  loadWorkspaceOperatorView: operatorView.load,
}));

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

const OPERATOR = { _id: "op", email: "op@ops.test" } as User;
const TENANT_ID = "tenant-1";
const WORKSPACE_NAME = "Northwind Traders";
const OPERATION_ID = "operation-12345678";

const SEAT_PLAN = {
  _id: "plan_business",
  price: 49,
  currency: "eur",
  interval: "month",
  billingMode: "seat",
  maxMembers: 25,
} as Plan;

function view(
  overrides: Partial<WorkspaceOperatorView> = {},
): WorkspaceOperatorView {
  return {
    plan: SEAT_PLAN,
    subscription: { isComplimentary: false } as TenantSubscription,
    seats: {
      members: 22,
      pendingInvites: 1,
      occupied: 23,
      platformSupport: [],
    },
    ...overrides,
  } as WorkspaceOperatorView;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function operatorController(): SaasWorkspaceOperatorActionsController {
  const controller = new SaasWorkspaceOperatorActionsController();
  controller.tenantModel = {
    get: async (id: string) =>
      id === TENANT_ID ? { _id: id, name: WORKSPACE_NAME } : undefined,
  } as unknown as SaasWorkspaceOperatorActionsController["tenantModel"];
  return controller;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Stripe credit ceiling", () => {
  it("allows up to a year of what the plan bills at the current seats", () => {
    expect(balanceCreditCeilingMinor(view())).toBe(4_900 * 23 * 12);
  });

  it("allows nothing on a workspace billed nothing", () => {
    expect(balanceCreditCeilingMinor(view({ plan: null }))).toBe(0);
    expect(
      balanceCreditCeilingMinor(
        view({ subscription: { isComplimentary: true } as TenantSubscription }),
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
    operatorView.load.mockResolvedValue(view());

    const error = await rejection(
      operatorController().grantCredit(OPERATOR, TENANT_ID, {
        operationId: OPERATION_ID,
        amountCents: 10_000_000,
        reason: "Goodwill",
      }),
    );

    expect(error).toBeInstanceOf(HTTPResult);
    expect(error).toMatchObject({ status: 400 });
    expect(commands.grantBalanceCreditCommand).not.toHaveBeenCalled();
  });
});

describe("typed confirmation of a suspension", () => {
  it("refuses a suspension whose typed name does not match the workspace", async () => {
    const error = await rejection(
      operatorController().suspend(OPERATOR, TENANT_ID, {
        operationId: OPERATION_ID,
        confirmName: "Northwind",
      }),
    );

    expect(error).toMatchObject({
      status: 400,
      body: "saas.errors.workspace.confirmation_mismatch",
    });
    expect(commands.suspendWorkspaceCommand).not.toHaveBeenCalled();
  });

  it("suspends once the workspace name is typed", async () => {
    await operatorController().suspend(OPERATOR, TENANT_ID, {
      operationId: OPERATION_ID,
      confirmName: ` ${WORKSPACE_NAME} `,
    });

    expect(commands.suspendWorkspaceCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        operationId: OPERATION_ID,
      }),
    );
  });
});

describe("first payment of a workspace its owner pays", () => {
  const pending = {
    status: "pending_payment",
    stripeSubscriptionId: null,
    isComplimentary: false,
    deletionStartedAt: null,
  } as TenantSubscription;

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
