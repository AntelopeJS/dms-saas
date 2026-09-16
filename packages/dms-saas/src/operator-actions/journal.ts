import { createHash, randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantSubscriptionModel } from "../db";
import {
  OperatorActionModel,
  type OperatorActionSuccess,
} from "./db/operator-action.model";
import type { OperatorAction } from "./db/operator-action.table";
import type {
  OperatorActionDetails,
  OperatorCommandResult,
  WorkspaceOperatorAction,
} from "./types";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_BAD_GATEWAY = 502;
const HOUR_MS = 60 * 60 * 1000;
const STRIPE_MINIMUM_IDEMPOTENCY_RETENTION_MS = 24 * HOUR_MS;
const STRIPE_IDEMPOTENCY_SAFETY_MARGIN_MS = HOUR_MS;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const GENERIC_FAILURE_CODE = "saas.errors.operator.external_effect_failed";
const RECONCILIATION_REQUIRED_CODE =
  "saas.errors.operator.reconciliation_required";

/** Conservative retry limit within Stripe's minimum 24-hour retention. */
export const CUSTOMER_BALANCE_CREDIT_SAFE_RETRY_WINDOW_MS =
  STRIPE_MINIMUM_IDEMPOTENCY_RETENTION_MS - STRIPE_IDEMPOTENCY_SAFETY_MARGIN_MS;

export interface OperatorActor {
  id: string;
  email: string;
}

export interface OperatorActionRequest {
  operationId: string;
  tenantId: string;
  actor: OperatorActor;
  action: WorkspaceOperatorAction;
  details: OperatorActionDetails;
}

export type OperatorActionEffect = (
  action: OperatorAction,
) => Promise<OperatorActionSuccess>;

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | CanonicalRecord;

interface CanonicalRecord {
  [key: string]: CanonicalValue;
}

function canonicalize(value: unknown): CanonicalValue {
  if (
    value === null ||
    ["boolean", "number", "string"].includes(typeof value)
  ) {
    return value as null | boolean | number | string;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalize(entry)] as const);
  return Object.fromEntries(entries) as CanonicalRecord;
}

export function operatorActionFingerprint(
  request: OperatorActionRequest,
): string {
  const payload = canonicalize({
    tenantId: request.tenantId,
    action: request.action,
    details: request.details,
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function assertOperationId(operationId: string): void {
  assert(
    OPERATION_ID_PATTERN.test(operationId),
    HTTP_BAD_REQUEST,
    "saas.errors.operator.invalid_operation_id",
  );
}

async function insertIntent(
  model: OperatorActionModel,
  request: OperatorActionRequest,
  fingerprint: string,
): Promise<OperatorAction> {
  const now = new Date();
  await model.insert({
    _id: request.operationId,
    tenantId: request.tenantId,
    actorId: request.actor.id,
    actorEmail: request.actor.email,
    action: request.action,
    status: "pending",
    requestFingerprint: fingerprint,
    details: request.details,
    attemptCount: 0,
    revision: randomUUID(),
    lastErrorCode: null,
    effectiveAt: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  });
  const inserted = await model.get(request.operationId);
  if (!inserted) throw new Error("Operator action intent was not persisted");
  return inserted;
}

export async function ensureOperatorActionIntent(
  model: OperatorActionModel,
  request: OperatorActionRequest,
): Promise<OperatorAction> {
  assertOperationId(request.operationId);
  const fingerprint = operatorActionFingerprint(request);
  try {
    return await insertIntent(model, request, fingerprint);
  } catch (error) {
    const existing = await model.get(request.operationId);
    if (!existing) throw error;
    assert(
      existing.requestFingerprint === fingerprint,
      HTTP_CONFLICT,
      "saas.errors.operator.idempotency_mismatch",
    );
    return existing;
  }
}

function errorCodeOf(error: unknown): string {
  if (!(error instanceof HTTPResult)) return GENERIC_FAILURE_CODE;
  const body = error.getBody();
  return typeof body === "string" && body.startsWith("saas.errors.")
    ? body
    : GENERIC_FAILURE_CODE;
}

function throwSafeActionError(error: unknown, operationId: string): never {
  if (
    error instanceof HTTPResult &&
    errorCodeOf(error) !== GENERIC_FAILURE_CODE
  ) {
    throw error;
  }
  Logging.Error(`[dms-saas:operator] operation ${operationId} failed`, error);
  throw new HTTPResult(HTTP_BAD_GATEWAY, GENERIC_FAILURE_CODE);
}

async function isRetryableValidationFailure(
  action: OperatorAction,
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof HTTPResult)) return false;
  try {
    const subscription = await GetModel(
      TenantSubscriptionModel,
      action.tenantId,
    ).findOne();
    return subscription?.domainTransition?.operationId !== action._id;
  } catch {
    return false;
  }
}

async function failAction(
  model: OperatorActionModel,
  action: OperatorAction,
  error: unknown,
): Promise<never> {
  const failure = (await isRetryableValidationFailure(action, error))
    ? model.markFailed(action, errorCodeOf(error))
    : model.markReconciliationRequired(action, RECONCILIATION_REQUIRED_CODE);
  await failure.catch(() => {});
  throwSafeActionError(error, action._id);
}

async function runEffect(
  model: OperatorActionModel,
  action: OperatorAction,
  effect: OperatorActionEffect,
): Promise<OperatorAction> {
  try {
    const outcome = await effect(action);
    await model.markSucceeded(action, outcome);
  } catch (error) {
    return failAction(model, action, error);
  }
  const completed = await model.get(action._id);
  if (!completed) throw new Error("Completed operator action is missing");
  await completeSubscriptionIntent(completed);
  return completed;
}

async function completeSubscriptionIntent(
  action: OperatorAction,
): Promise<void> {
  if (action.status !== "succeeded") return;
  if (action.action === "customer_balance.credit") return;
  const subscriptions = GetModel(TenantSubscriptionModel, action.tenantId);
  const subscription = await subscriptions.findOne();
  if (subscription?.domainTransition?.operationId !== action._id) return;
  await subscriptions.completeTransition(subscription._id, action._id, {});
}

async function blockUnsafeRetry(
  model: OperatorActionModel,
  action: OperatorAction,
): Promise<void> {
  const expired =
    action.attemptCount > 0 &&
    Date.now() - action.createdAt.getTime() >=
      CUSTOMER_BALANCE_CREDIT_SAFE_RETRY_WINDOW_MS;
  if (action.status !== "running" && !expired) return;
  await model.markReconciliationRequired(action, RECONCILIATION_REQUIRED_CODE);
  throw new HTTPResult(HTTP_CONFLICT, RECONCILIATION_REQUIRED_CODE);
}

export async function executeOperatorAction(
  request: OperatorActionRequest,
  effect: OperatorActionEffect,
): Promise<OperatorAction> {
  const model = GetModel(OperatorActionModel);
  const action = await ensureOperatorActionIntent(model, request);
  if (action.status === "succeeded") {
    await completeSubscriptionIntent(action);
    return action;
  }
  if (action.status === "reconciliation_required") {
    throw new HTTPResult(HTTP_CONFLICT, RECONCILIATION_REQUIRED_CODE);
  }
  await blockUnsafeRetry(model, action);
  const running = await model.beginAttempt(action);
  return runEffect(model, running, effect);
}

export function toOperatorCommandResult(
  action: OperatorAction,
): OperatorCommandResult {
  return {
    operationId: action._id,
    status: action.status,
    effectiveAt: action.effectiveAt,
  };
}

export async function checkpointOperatorActionDetails(
  action: OperatorAction,
  patch: OperatorActionDetails,
): Promise<void> {
  assert(
    action.status === "running",
    HTTP_CONFLICT,
    "saas.errors.operator.operation_in_progress",
  );
  const details = { ...action.details, ...patch };
  await GetModel(OperatorActionModel).updateDetails(action, details);
}
