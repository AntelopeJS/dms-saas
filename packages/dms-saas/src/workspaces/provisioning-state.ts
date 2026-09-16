import { randomUUID } from "node:crypto";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { Plan } from "../db";
import { CardCapacityModel, cardCapacityId } from "./db/card-capacity.model";
import { ProvisioningAttemptModel } from "./db/provisioning-attempt.model";
import type { ProvisioningAttemptState } from "./db/provisioning-attempt.table";
import { TrialIdentityModel, trialIdentityId } from "./db/trial-identity.model";
import {
  findFreeWorkspaceIdsBackedByCard,
  isFreePlan,
  resolveMaxFreeWorkspacesPerCard,
} from "./free-workspace-guard";
import type {
  WorkspaceProvisioningHandles,
  WorkspaceProvisioningInput,
} from "./provisioning";

const HTTP_CONFLICT = 409;

/** Persist recovery identity before any capacity or payment-provider mutation. */
export async function beginProvisioningAttempt(
  input: WorkspaceProvisioningInput,
  plan: Plan,
): Promise<void> {
  const tenantId = randomUUID();
  const fingerprint = input.card.fingerprint;
  const capacityId =
    fingerprint && isFreePlan(plan) ? cardCapacityId(fingerprint) : null;
  input.handles.tenantId = tenantId;
  input.handles.mustPreserveWorkspace = true;
  await GetModel(ProvisioningAttemptModel).insert({
    _id: tenantId,
    revision: randomUUID(),
    capacityId,
    planId: plan._id,
    userId: input.userId,
    state: "preparing",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    trialConsumptionId: null,
    trialIdentityIds: [],
    lastError: null,
  });
  if (capacityId && fingerprint) {
    const admitted = await GetModel(CardCapacityModel).reserve(
      capacityId,
      tenantId,
      await resolveMaxFreeWorkspacesPerCard(),
      () => findFreeWorkspaceIdsBackedByCard(fingerprint),
    );
    if (!admitted) {
      await recordProvisioningState(input.handles, "cancelled");
      input.handles.mustPreserveWorkspace = false;
    }
    assert(admitted, HTTP_CONFLICT, "saas.errors.workspace.free_limit_reached");
  }
  input.handles.mustPreserveWorkspace = false;
}

/** Save only known recovery handles, never opaque hook extras or billing profiles. */
export async function recordProvisioningState(
  handles: WorkspaceProvisioningHandles,
  state: ProvisioningAttemptState = "preparing",
): Promise<void> {
  if (!handles.tenantId) throw new Error("Provisioning identity is missing");
  const model = GetModel(ProvisioningAttemptModel);
  const current = await model.get(handles.tenantId);
  if (!current) throw new Error("Provisioning attempt is missing");
  await model.advance(current, {
    state,
    stripeCustomerId: handles.stripeCustomerId ?? null,
    stripeSubscriptionId: handles.stripeSubscriptionId ?? null,
    trialConsumptionId: handles.trialConsumptionId ?? null,
    trialIdentityIds: handles.trialIdentityIds ?? [],
  });
  if (state === "committed" && current.capacityId)
    await GetModel(CardCapacityModel).confirm(current.capacityId, current._id);
  if (state === "cancelled") {
    if (current.capacityId)
      await GetModel(CardCapacityModel).releaseCancelled(
        current.capacityId,
        current._id,
      );
    for (const id of current.trialIdentityIds)
      await GetModel(TrialIdentityModel).releaseUnused(id, current._id);
  }
}

/** Reserve both identities before a trial effect; a losing second reservation releases only unused work. */
export async function reserveTrialIdentities(
  handles: WorkspaceProvisioningHandles,
  emailHash: string,
  fingerprint: string | null,
): Promise<boolean> {
  if (!handles.tenantId) throw new Error("Provisioning identity is missing");
  const model = GetModel(TrialIdentityModel);
  const ids = [trialIdentityId("email", emailHash)];
  if (fingerprint) ids.push(trialIdentityId("card", fingerprint));
  handles.trialIdentityIds = ids;
  handles.mustPreserveWorkspace = true;
  await recordProvisioningState(handles);
  const reserved: string[] = [];
  for (const id of ids) {
    if (!(await model.reserve(id, handles.tenantId))) {
      for (const owned of reserved)
        await model.releaseUnused(owned, handles.tenantId);
      handles.trialIdentityIds = [];
      await recordProvisioningState(handles);
      return false;
    }
    reserved.push(id);
  }
  handles.trialIdentityIds = reserved;
  await recordProvisioningState(handles);
  return true;
}
