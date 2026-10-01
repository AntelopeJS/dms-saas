import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { Plan } from "../db";
import { ProvisioningAttemptModel } from "./db/provisioning-attempt.model";
import type { ProvisioningAttemptState } from "./db/provisioning-attempt.table";
import { TrialIdentityModel, trialIdentityId } from "./db/trial-identity.model";
import type {
  WorkspaceProvisioningHandles,
  WorkspaceProvisioningInput,
} from "./provisioning";

/** Persist recovery identity before any payment-provider mutation. */
export async function beginProvisioningAttempt(
  input: WorkspaceProvisioningInput,
  plan: Plan,
): Promise<void> {
  const tenantId = randomUUID();
  input.handles.tenantId = tenantId;
  input.handles.mustPreserveWorkspace = true;
  await GetModel(ProvisioningAttemptModel).insert({
    _id: tenantId,
    revision: randomUUID(),
    planId: plan._id,
    userId: input.userId,
    state: "preparing",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    trialConsumptionId: null,
    trialIdentityIds: [],
    lastError: null,
  });
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
  if (state === "cancelled") {
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
