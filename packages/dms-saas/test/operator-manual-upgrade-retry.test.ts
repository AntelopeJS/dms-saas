import { beforeEach, describe, expect, it, vi } from "vitest";

interface NamedModel {
  name: string;
}

interface RunningAction {
  _id: string;
  tenantId: string;
  details: Record<string, unknown>;
  attemptCount: number;
  createdAt: Date;
  effectiveAt: Date | null;
  status: string;
}

interface ActionOutcome {
  details: Record<string, unknown>;
  effectiveAt: Date;
}

type ActionEffect = (action: RunningAction) => Promise<ActionOutcome>;

const harness = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  applyImmediateChange: vi.fn(),
  finalizeImmediateChange: vi.fn(),
}));

vi.mock("@antelopejs/interface-database-decorators", () => ({
  GetModel: (model: NamedModel): unknown => harness.models.get(model.name),
}));

vi.mock("../src/db", () => ({
  PlanModel: class PlanModel {},
  TenantBillingInfoModel: class TenantBillingInfoModel {},
  TenantSubscriptionModel: class TenantSubscriptionModel {},
}));

vi.mock("../src/plans", () => ({ isDowngrade: vi.fn(() => false) }));
vi.mock("../src/plans/seat-capacity", () => ({
  countOccupiedSeats: vi.fn(async () => 1),
  fitsWithinSeatLimit: vi.fn(() => true),
}));
vi.mock("../src/routes/tenant/tenant-plan-ops", () => ({
  applyImmediateChange: harness.applyImmediateChange,
  assertSeatLimit: vi.fn(),
  finalizeImmediateChange: harness.finalizeImmediateChange,
  isPaidPlan: vi.fn(() => true),
  loadAndValidateTargetPlan: vi.fn(async (_model, planId: string) => ({
    _id: planId,
    name: "Growth",
  })),
}));
vi.mock("../src/stripe/client", () => ({ getStripeClient: vi.fn() }));
vi.mock("../src/utils", () => ({ stripeSecondsToDate: vi.fn() }));
vi.mock("../src/workspaces/suspension", () => ({
  applyWorkspaceReactivation: vi.fn(),
  applyWorkspaceSuspension: vi.fn(),
}));
vi.mock("../src/operator-actions/journal", () => ({
  checkpointOperatorActionDetails: vi.fn(),
  executeOperatorAction: async (_request: unknown, effect: ActionEffect) => {
    const running: RunningAction = {
      _id: "upgrade-operation-123",
      tenantId: "tenant-123",
      details: {
        previousPlanId: "starter-plan",
        previousPlanName: "Starter",
        targetPlanId: "growth-plan",
        targetPlanName: "Growth",
      },
      attemptCount: 2,
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
      effectiveAt: null,
      status: "running",
    };
    const outcome = await effect(running);
    return { ...running, ...outcome, status: "succeeded" };
  },
  toOperatorCommandResult: (action: RunningAction) => ({
    operationId: action._id,
    status: action.status,
    effectiveAt: action.effectiveAt,
  }),
}));

import { manuallyUpgradeWorkspaceCommand } from "../src/operator-actions/commands";

const subscription = {
  _id: "subscription-123",
  planId: "growth-plan",
  status: "active",
  stripeSubscriptionId: "sub_123",
  domainTransition: { operationId: "upgrade-operation-123" },
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.models.clear();
  harness.models.set("TenantSubscriptionModel", {
    findOne: async () => subscription,
  });
  harness.models.set("PlanModel", {
    get: async () => ({ _id: "growth-plan", name: "Growth" }),
  });
  harness.models.set("TenantBillingInfoModel", {
    findOne: async () => ({ customerType: "business" }),
  });
});

describe("manual upgrade retry", () => {
  it("does not infer safe cleanup replay from an already changed plan", async () => {
    await expect(
      manuallyUpgradeWorkspaceCommand({
        tenantId: "tenant-123",
        operationId: "upgrade-operation-123",
        actor: { id: "owner-123", email: "owner@example.com" },
        targetPlanId: "growth-plan",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(harness.applyImmediateChange).not.toHaveBeenCalled();
    expect(harness.finalizeImmediateChange).not.toHaveBeenCalled();
  });
});
