import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { RoleModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import {
  type Plan,
  type TenantSubscription,
  TenantBillingStateModel,
} from "../src/db";
import { finalizeImmediateChange } from "../src/plan-changes/immediate";
import { addTenantMember } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("immediate-plan-change-finalization");
const stripe = useSuiteStripe();

const plan = fromPartial<Plan>({
  _id: "growth-plan",
  name: "Growth",
  billingMode: "seat",
  permissions: ["billing.plan"],
  features: [],
  inheritsFromPlanId: null,
});

const subscription = fromPartial<TenantSubscription>({
  _id: "subscription-123",
  stripeSubscriptionId: "sub_123",
});

/** A workspace of one member whose role holds a permission the plan drops. */
async function workspaceOnAWiderPlan(): Promise<string> {
  const tenantId = randomUUID();
  await addTenantMember(tenantId, fromPartial<User>({ _id: randomUUID() }));
  await GetModel(RoleModel, tenantId).insert({
    _id: `${tenantId}:member`,
    name: "Member",
    description: "",
    permissions: ["billing.plan", "reports.export"],
  });
  return tenantId;
}

/** What the workspace holds at a point of the finalization. */
async function progress(tenantId: string) {
  const [role] = await GetModel(RoleModel, tenantId).getAll();
  const billing = await GetModel(TenantBillingStateModel).findByTenant(
    tenantId,
  );
  return { permissions: role?.permissions, isBillingPublished: !!billing };
}

describe("immediate plan change finalization", () => {
  it("retries permission cleanup before seat and billing synchronization", async () => {
    const tenantId = await workspaceOnAWiderPlan();
    const retrieve = vi
      .spyOn(stripe.write.subscriptions, "retrieve")
      .mockResolvedValue(
        fromPartial({ items: { data: [{ id: "si_seats" }] } }),
      );
    const atSeatSync: Awaited<ReturnType<typeof progress>>[] = [];
    const update = vi
      .spyOn(stripe.write.subscriptions, "update")
      .mockImplementation(async () => {
        atSeatSync.push(await progress(tenantId));
        return fromPartial({});
      });

    await finalizeImmediateChange(tenantId, subscription, plan);

    expect(retrieve).toHaveBeenCalledWith("sub_123");
    expect(update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({ items: [{ id: "si_seats", quantity: 1 }] }),
      {
        idempotencyKey: `seat-sync:change-plan:${tenantId}:subscription-123:growth-plan`,
      },
    );
    expect(atSeatSync).toEqual([
      { permissions: ["billing.plan"], isBillingPublished: false },
    ]);
    await expect(progress(tenantId)).resolves.toEqual({
      permissions: ["billing.plan"],
      isBillingPublished: true,
    });
  });
});
