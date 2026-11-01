import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { describe, expect, it } from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import {
  WORKSPACE_NAME,
  adminController,
  createInvitedWorkspace,
  insertPaidPlan,
  insertPlan,
  operator,
  subscriptionOf,
  useBackOffice,
} from "./helpers/operator-workspaces";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("operator-workspace-access");
useBackOffice();

const DAY_MS = 86_400_000;

describe("access model of a workspace created by an operator", () => {
  it("leaves the workspace waiting for its owner's first payment on the chosen plan", async () => {
    const planId = await insertPaidPlan();

    const created = await adminController().createWorkspace(operator, {
      name: WORKSPACE_NAME,
      ownerEmail: `${randomUUID()}@example.test`,
      planId,
      access: "owner_pays",
    });

    expect(created.access).toBe("owner_pays");
    expect(await subscriptionOf(created.tenantId)).toMatchObject({
      planId,
      status: "pending_payment",
      isComplimentary: false,
      freeUntil: null,
      stripeSubscriptionId: null,
    });
  });

  it("refuses to let an owner pay for a plan Stripe does not bill", async () => {
    await expect(
      adminController().createWorkspace(operator, {
        name: WORKSPACE_NAME,
        ownerEmail: `${randomUUID()}@example.test`,
        planId: await insertPlan(),
        access: "owner_pays",
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.workspace_create.owner_pays_needs_paid_plan",
    });
  });

  it("grants complimentary access until the chosen date", async () => {
    const freeUntil = new Date(Date.now() + 30 * DAY_MS);

    const created = await adminController().createWorkspace(operator, {
      name: WORKSPACE_NAME,
      ownerEmail: `${randomUUID()}@example.test`,
      planId: await insertPaidPlan(),
      access: "complimentary",
      freeUntil: freeUntil.toISOString(),
    });

    expect(await subscriptionOf(created.tenantId)).toMatchObject({
      status: "active",
      isComplimentary: true,
      freeUntil,
    });
  });

  it("requires the operator to choose the access model", async () => {
    await expect(
      adminController().createWorkspace(operator, {
        name: WORKSPACE_NAME,
        ownerEmail: `${randomUUID()}@example.test`,
        planId: await insertPlan(),
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.workspace_create.access",
    });
  });
});

describe("owner e-mail lookup", () => {
  it("names an existing account and the workspaces it belongs to", async () => {
    const email = `${randomUUID()}@example.test`;
    await GetModel(UserModel).insert({
      _id: randomUUID(),
      email,
      name: "Nina Sharp",
      language: "en",
    });

    await expect(
      adminController().lookUpOwnerEmail(operator, email.toUpperCase()),
    ).resolves.toEqual({ kind: "existing", name: "Nina Sharp", workspaces: 0 });
  });

  it("announces an invitation for a new e-mail", async () => {
    await expect(
      adminController().lookUpOwnerEmail(
        operator,
        `${randomUUID()}@example.test`,
      ),
    ).resolves.toEqual({ kind: "new", invitationDays: 7 });
  });
});

describe("complimentary access over a paid subscription", () => {
  it("is refused until the operator acknowledges the cancellation", async () => {
    const { tenantId } = await createInvitedWorkspace();
    const subscription = await subscriptionOf(tenantId);
    await GetModel(TenantSubscriptionModel, tenantId).update(
      subscription!._id,
      { stripeSubscriptionId: "sub_paid", isComplimentary: false },
    );

    await expect(
      adminController().grantFreeAccess(operator, tenantId, {
        planId: await insertPaidPlan(),
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.workspace.cancellation_not_acknowledged",
    });
  });
});

describe("complimentary access to a workspace without a customer type", () => {
  async function insertBusinessPlan(): Promise<string> {
    const planId = randomUUID();
    await GetModel(PlanModel).insert({
      _id: planId,
      name: "Team",
      price: 49,
      currency: "eur",
      interval: "month",
      billingMode: "flat",
      audience: "business",
      isActive: true,
      isDeleted: false,
    });
    return planId;
  }

  async function currentPlanIdOf(tenantId: string): Promise<string> {
    const subscription = await subscriptionOf(tenantId);
    if (!subscription) throw new Error("Expected a subscription");
    return subscription.planId;
  }

  it("offers every plan, the one it is on included", async () => {
    const { tenantId } = await createInvitedWorkspace();
    const businessPlanId = await insertBusinessPlan();

    const impact = await adminController().getComplimentaryImpact(
      operator,
      tenantId,
    );

    const offeredIds = impact.plans.map((plan) => plan.id);
    expect(offeredIds).toContain(impact.currentPlanId);
    expect(offeredIds).toContain(businessPlanId);
  });

  it("still names the plan it is on once that plan is no longer sold", async () => {
    const { tenantId } = await createInvitedWorkspace();
    const planId = await currentPlanIdOf(tenantId);
    await GetModel(PlanModel).update(planId, { isActive: false });

    const impact = await adminController().getComplimentaryImpact(
      operator,
      tenantId,
    );

    expect(impact.plans.map((plan) => plan.id)).toContain(planId);
    await expect(
      adminController().grantFreeAccess(operator, tenantId, { planId }),
    ).resolves.toMatchObject({ planId });
  });

  it("grants a plan sold to a single audience", async () => {
    const { tenantId } = await createInvitedWorkspace();
    const planId = await insertBusinessPlan();

    await expect(
      adminController().grantFreeAccess(operator, tenantId, { planId }),
    ).resolves.toMatchObject({ planId });
  });
});
