import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TenantBillingInfoModel, TenantSubscriptionModel } from "../src/db";
import { manuallyUpgradeWorkspaceCommand } from "../src/operator-actions/commands";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { operatorActionFingerprint } from "../src/operator-actions/journal";
import { insertTenant } from "./helpers/workspaces";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("operator-manual-upgrade-retry");
const stripe = useSuiteStripe();

const OPERATION_ID = "upgrade-operation-123";
const ACTOR = { id: "owner-123", email: "owner@example.com" };

beforeAll(async () => {
  await insertPlan({
    _id: "growth-plan",
    name: "Growth",
    price: 49,
    paymentProviderRefs: { stripePriceId: "price_growth" },
  });
});

describe("manual upgrade retry", () => {
  it("does not infer safe cleanup replay from an already changed plan", async () => {
    const tenantId = randomUUID();
    await insertTenant(tenantId);
    await GetModel(TenantBillingInfoModel, tenantId).insert({
      _id: tenantId,
      customerType: "business",
    });
    await GetModel(TenantSubscriptionModel, tenantId).insert({
      _id: "subscription-123",
      planId: "growth-plan",
      status: "active",
      stripeSubscriptionId: "sub_123",
      domainTransition: {
        operationId: OPERATION_ID,
        kind: "change_plan",
        targetPlanId: "growth-plan",
        requestedAt: new Date("2026-08-29T12:00:00.000Z"),
      },
    });
    const command = {
      tenantId,
      operationId: OPERATION_ID,
      actor: ACTOR,
      targetPlanId: "growth-plan",
    };
    const operations = GetModel(OperatorActionModel);
    await operations.insert({
      _id: OPERATION_ID,
      tenantId,
      actorId: ACTOR.id,
      actorEmail: ACTOR.email,
      action: "subscription.upgrade",
      status: "failed",
      requestFingerprint: operatorActionFingerprint({
        ...command,
        action: "subscription.upgrade",
        details: { targetPlanId: command.targetPlanId },
      }),
      details: { targetPlanId: command.targetPlanId },
      attemptCount: 1,
      revision: randomUUID(),
      lastErrorCode: null,
      effectiveAt: null,
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      updatedAt: new Date("2026-08-29T12:00:00.000Z"),
    });
    const retrieve = vi.spyOn(stripe.write.subscriptions, "retrieve");
    const update = vi.spyOn(stripe.write.subscriptions, "update");

    await expect(
      manuallyUpgradeWorkspaceCommand(command),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.operator.plan_already_applied",
    });

    expect(retrieve).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    await expect(operations.get(OPERATION_ID)).resolves.toMatchObject({
      status: "reconciliation_required",
      attemptCount: 2,
    });
    await expect(
      GetModel(TenantSubscriptionModel, tenantId).findOne(),
    ).resolves.toMatchObject({
      planId: "growth-plan",
      domainTransition: { operationId: OPERATION_ID },
    });
  });
});
