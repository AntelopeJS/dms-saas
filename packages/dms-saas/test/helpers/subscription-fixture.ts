import { randomUUID } from "node:crypto";
import { Schema } from "@antelopejs/interface-database";
import {
  type DeepPartial,
  GetModel,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { type TenantSubscription, TenantSubscriptionModel } from "../../src/db";
import { addTenantMember, createUser } from "./dms";

/** The cutoff the cron fixtures decide against. */
export const CUTOFF = new Date("2026-09-14T00:00:00Z");
/** A day before {@link CUTOFF}: past it by every cron's rule. */
export const BEFORE = new Date("2026-09-13T00:00:00Z");

/**
 * A workspace of its own with an owner and a complimentary subscription that
 * ended before the cutoff, overridden by `patch`.
 */
export async function subscriptionFixture(
  patch: DeepPartial<TenantSubscription> = {},
) {
  const tenantId = randomUUID();
  await Schema.get(TENANT_SCHEMA_NAME)!.createInstance(tenantId).run();
  const owner = await createUser();
  await addTenantMember(tenantId, owner, true);
  const model = GetModel(TenantSubscriptionModel, tenantId);
  const [id] = await model.insert({
    status: "active",
    freeUntil: BEFORE,
    stripeSubscriptionId: null,
    deletionStartedAt: null,
    domainTransition: null,
    cronNotification: null,
    ...patch,
  });
  return { tenantId, ownerId: owner._id, model, id };
}
