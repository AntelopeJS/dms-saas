import { createHash, randomUUID } from "node:crypto";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  getWorkspaceLifecycleConsumer,
  getWorkspaceLifecycleConsumers,
} from "./lifecycle-consumers";
import type {
  WorkspaceLifecycleConsumer,
  WorkspaceLifecycleMessage,
  WorkspaceLifecycleReceipt,
  WorkspaceLifecycleTransition,
} from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import { getStripeClient } from "../stripe/client";
import { LifecycleDeliveryModel } from "./db/lifecycle-delivery.model";
import type { LifecycleDelivery } from "./db/lifecycle-delivery.table";

const STATUS_SUCCEEDED = "succeeded";
const RECEIPT_ID_MAX_LENGTH = 200;
const CREATION_INTENT_CONSUMER = "$workspace-created";

export interface LifecycleDispatchInput {
  tenantId: string;
  operationId: string;
  transition: WorkspaceLifecycleTransition;
  requestedAt: Date;
}

export interface LifecycleReconciliationResult {
  delivered: number;
  failed: number;
  waitingForConsumer: number;
}

function deliveryId(operationId: string, consumer: string): string {
  return createHash("sha256")
    .update(`${operationId}\u0000${consumer}`)
    .digest("hex");
}

function buildMessage(delivery: LifecycleDelivery): WorkspaceLifecycleMessage {
  return {
    tenantId: delivery.tenantId,
    operationId: delivery.operationId,
    transition: delivery.transition,
    requestedAt: delivery.requestedAt,
  };
}

function normalizeReceipt(
  receipt: WorkspaceLifecycleReceipt,
): WorkspaceLifecycleReceipt {
  const receiptId = receipt.receiptId?.trim();
  if (!receiptId || receiptId.length > RECEIPT_ID_MAX_LENGTH) {
    throw new Error("Invalid workspace lifecycle receipt");
  }
  if (
    receipt.effectiveAt &&
    (!(receipt.effectiveAt instanceof Date) ||
      !Number.isFinite(receipt.effectiveAt.getTime()))
  ) {
    throw new Error("Invalid workspace lifecycle receipt effective time");
  }
  return { ...receipt, receiptId };
}

function buildDelivery(
  input: LifecycleDispatchInput,
  consumer: string,
): Partial<LifecycleDelivery> {
  return {
    _id: deliveryId(input.operationId, consumer),
    operationId: input.operationId,
    tenantId: input.tenantId,
    consumer,
    transition: input.transition,
    provisioningInvoiceId: null,
    provisioningState:
      consumer === CREATION_INTENT_CONSUMER ? "preparing" : null,
    status: "pending",
    attemptCount: 0,
    revision: randomUUID(),
    receiptId: null,
    acceptedAt: null,
    effectiveAt: null,
    lastErrorCode: null,
    requestedAt: input.requestedAt,
    createdAt: input.requestedAt,
    startedAt: null,
    completedAt: null,
    updatedAt: input.requestedAt,
  };
}

async function insertDelivery(
  model: LifecycleDeliveryModel,
  input: LifecycleDispatchInput,
  consumer: string,
): Promise<LifecycleDelivery> {
  const id = deliveryId(input.operationId, consumer);
  try {
    await model.insert(buildDelivery(input, consumer));
  } catch (error) {
    const existing = await model.get(id);
    if (!existing) throw error;
    if (
      existing.tenantId !== input.tenantId ||
      existing.transition !== input.transition ||
      existing.requestedAt.getTime() !== input.requestedAt.getTime()
    )
      throw new Error("Lifecycle delivery identity has conflicting content");
    return existing;
  }
  const inserted = await model.get(id);
  if (!inserted) throw new Error("Lifecycle delivery was not persisted");
  return inserted;
}

async function persistDeliveries(
  input: LifecycleDispatchInput,
): Promise<LifecycleDelivery[]> {
  const model = GetModel(LifecycleDeliveryModel);
  const consumers = getWorkspaceLifecycleConsumers().filter((consumer) =>
    acceptsTransition(consumer, input.transition),
  );
  for (const consumer of consumers) {
    await insertDelivery(model, input, consumer.name);
  }
  const deliveries = await model.findByOperation(input.operationId);
  return deliveries.filter(
    (delivery) => delivery.consumer !== CREATION_INTENT_CONSUMER,
  );
}

function acceptsTransition(
  consumer: WorkspaceLifecycleConsumer,
  transition: WorkspaceLifecycleTransition,
): boolean {
  return consumer.transitions.includes(transition);
}

function resolveConsumer(
  delivery: LifecycleDelivery,
): WorkspaceLifecycleConsumer | undefined {
  if (delivery.consumer === CREATION_INTENT_CONSUMER) {
    return {
      name: CREATION_INTENT_CONSUMER,
      transitions: ["created"],
      consume: () => consumeCreationIntent(delivery),
    };
  }
  const consumer = getWorkspaceLifecycleConsumer(delivery.consumer);
  return consumer && acceptsTransition(consumer, delivery.transition)
    ? consumer
    : undefined;
}

async function consumeCreationIntent(
  delivery: LifecycleDelivery,
): Promise<WorkspaceLifecycleReceipt> {
  const model = GetModel(LifecycleDeliveryModel);
  const current = await model.get(delivery._id);
  if (!current || current.provisioningState === "preparing") {
    throw new Error("Workspace provisioning is not ready");
  }
  if (current.provisioningState === "cancelled")
    return { receiptId: `cancelled:${delivery.operationId}` };
  if (!(await GetModel(TenantModel).get(delivery.tenantId)))
    return { receiptId: `deleted:${delivery.operationId}` };
  if (
    current.provisioningState === "awaiting_payment" &&
    current.provisioningInvoiceId
  ) {
    const invoice = await getStripeClient().invoices.retrieve(
      current.provisioningInvoiceId,
    );
    if (invoice.status !== "paid")
      throw new Error("Workspace provisioning payment is not confirmed");
  }
  await model.transitionProvisioning(
    delivery._id,
    "awaiting_payment",
    "committed",
  );
  await dispatchWorkspaceLifecycle(buildMessage(delivery));
  return { receiptId: delivery.operationId };
}

function creationDeliveryId(tenantId: string): string {
  return deliveryId(`workspace-created:${tenantId}`, CREATION_INTENT_CONSUMER);
}

/** Persist the creation gate before inserting the tenant into the inventory. */
export async function beginWorkspaceCreation(tenantId: string): Promise<void> {
  if (await GetModel(LifecycleDeliveryModel).get(creationDeliveryId(tenantId)))
    return;
  await insertDelivery(
    GetModel(LifecycleDeliveryModel),
    {
      tenantId,
      operationId: `workspace-created:${tenantId}`,
      transition: "created",
      requestedAt: new Date(),
    },
    CREATION_INTENT_CONSUMER,
  );
}

/** Record that membership, billing records and every provisioning hook have succeeded. */
export async function prepareWorkspaceCreated(
  tenantId: string,
  invoiceId: string | null,
): Promise<void> {
  await GetModel(LifecycleDeliveryModel).transitionProvisioning(
    creationDeliveryId(tenantId),
    "preparing",
    "awaiting_payment",
    invoiceId,
  );
}

/** Check only the provisioning gate; legacy/bootstrap tenants without a marker remain eligible. */
export async function isWorkspaceProvisioningCommitted(
  tenantId: string,
): Promise<boolean> {
  const delivery = await GetModel(LifecycleDeliveryModel).get(
    creationDeliveryId(tenantId),
  );
  return !delivery || delivery.provisioningState === "committed";
}

/** Keep a cancellation tombstone so partial rollback never reopens inventory eligibility. */
export async function cancelWorkspaceCreated(tenantId: string): Promise<void> {
  const model = GetModel(LifecycleDeliveryModel);
  const delivery = await model.get(creationDeliveryId(tenantId));
  if (!delivery || delivery.provisioningState === "cancelled") return;
  if (
    delivery.provisioningState !== "preparing" &&
    delivery.provisioningState !== "awaiting_payment"
  ) {
    throw new Error("Committed workspace cannot be rolled back");
  }
  await model.transitionProvisioning(
    delivery._id,
    delivery.provisioningState,
    "cancelled",
  );
}

/** Attempt delivery without making committed provisioning depend on consumer availability. */
export async function deliverWorkspaceCreated(tenantId: string): Promise<void> {
  try {
    const id = creationDeliveryId(tenantId);
    const delivery = await GetModel(LifecycleDeliveryModel).get(id);
    if (delivery) await deliverOne(delivery);
  } catch (error) {
    Logging.Error(
      `[dms-saas:lifecycle] creation delivery for ${tenantId} deferred`,
      error,
    );
  }
}

async function invokeConsumer(
  model: LifecycleDeliveryModel,
  delivery: LifecycleDelivery,
  consumer: WorkspaceLifecycleConsumer,
): Promise<void> {
  try {
    const isDeleted =
      delivery.transition === "created" &&
      delivery.consumer !== CREATION_INTENT_CONSUMER &&
      !(await GetModel(TenantModel).get(delivery.tenantId));
    const receipt = normalizeReceipt(
      isDeleted
        ? { receiptId: `deleted:${delivery.operationId}` }
        : await consumer.consume(buildMessage(delivery)),
    );
    await model.markSucceeded(delivery, receipt);
  } catch (error) {
    await model.markFailed(delivery).catch(() => {});
    throw error;
  }
}

async function deliverOne(delivery: LifecycleDelivery): Promise<boolean> {
  if (delivery.status === STATUS_SUCCEEDED) return false;
  const consumer = resolveConsumer(delivery);
  if (!consumer) throw new Error("Workspace lifecycle consumer is unavailable");
  const model = GetModel(LifecycleDeliveryModel);
  await invokeConsumer(model, delivery, consumer);
  return true;
}

export async function dispatchWorkspaceLifecycle(
  input: LifecycleDispatchInput,
): Promise<void> {
  const deliveries = await persistDeliveries(input);
  for (const delivery of deliveries) {
    await deliverOne(delivery);
  }
}

export async function reconcileWorkspaceLifecycleDeliveries(): Promise<LifecycleReconciliationResult> {
  const deliveries = await GetModel(LifecycleDeliveryModel).findReplayable();
  const result: LifecycleReconciliationResult = {
    delivered: 0,
    failed: 0,
    waitingForConsumer: 0,
  };
  for (const delivery of deliveries) {
    if (!resolveConsumer(delivery)) {
      result.waitingForConsumer += 1;
      continue;
    }
    try {
      if (await deliverOne(delivery)) result.delivered += 1;
    } catch (error) {
      result.failed += 1;
      Logging.Error(
        `[dms-saas:lifecycle] delivery ${delivery._id} failed`,
        error,
      );
    }
  }
  return result;
}
