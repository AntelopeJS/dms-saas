import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  type Plan,
  PlanModel,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { isDowngrade } from "../plans";
import {
  countOccupiedSeats,
  fitsWithinSeatLimit,
} from "../plans/seat-capacity";
import {
  applyImmediateChange,
  assertSeatLimit,
  isPaidPlan,
  loadAndValidateTargetPlan,
} from "../routes/tenant/tenant-plan-ops";
import { getStripeClient } from "../stripe/client";
import { retrieveStripeCustomerBalance } from "../stripe/customer-balance";
import { stripeSecondsToDate } from "../utils";
import {
  applyWorkspaceReactivation,
  applyWorkspaceSuspension,
} from "../workspaces/suspension";
import type { OperatorActionSuccess } from "./db/operator-action.model";
import type { OperatorAction } from "./db/operator-action.table";
import {
  checkpointOperatorActionDetails,
  executeOperatorAction,
  type OperatorActor,
  toOperatorCommandResult,
} from "./journal";
import type { OperatorActionDetails, OperatorCommandResult } from "./types";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const CREDIT_REASON_MAX_LENGTH = 500;
const CANCELLED_STATUS = "cancelled";

export interface WorkspaceCommandInput {
  tenantId: string;
  operationId: string;
  actor: OperatorActor;
}

export interface ManualUpgradeCommandInput extends WorkspaceCommandInput {
  targetPlanId: string;
}

export interface BalanceCreditCommandInput extends WorkspaceCommandInput {
  amountCents: number;
  reason: string;
}

export interface EligibleUpgradePlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: string;
  maxMembers: number;
}

export interface WorkspaceOperatorOptions {
  currentPlanId: string | null;
  currentPlanName: string | null;
  currency: string | null;
  customerBalanceCents: number | null;
  hasStripeCustomer: boolean;
  hasStripeSubscription: boolean;
  eligibleUpgradePlans: EligibleUpgradePlan[];
}

interface UpgradeContext {
  subscription: TenantSubscription;
  currentPlan: Plan;
  targetPlan: Plan;
}

interface CreditAccount {
  customerId: string;
  currency: string;
}

interface StripeBackedTenantSubscription extends TenantSubscription {
  stripeSubscriptionId: string;
}

type SuspensionOperatorAction = "workspace.suspend" | "workspace.unsuspend";

function hasEligibleStripeSubscription(
  subscription: TenantSubscription | undefined,
): subscription is StripeBackedTenantSubscription {
  return (
    !!subscription?.stripeSubscriptionId &&
    subscription.status !== CANCELLED_STATUS
  );
}

function actorOf(user: User): OperatorActor {
  return { id: user._id, email: user.email };
}

export function operatorActorOf(user: User): OperatorActor {
  return actorOf(user);
}

function mergeDetails(
  action: OperatorAction,
  patch: OperatorActionDetails,
): OperatorActionDetails {
  return { ...action.details, ...patch };
}

async function executeSuspensionCommand(
  input: WorkspaceCommandInput,
  actionName: SuspensionOperatorAction,
): Promise<OperatorCommandResult> {
  const action = await executeOperatorAction(
    { ...input, action: actionName, details: {} },
    async (running) => {
      const effectInput = {
        tenantId: input.tenantId,
        operationId: input.operationId,
        requestedAt: running.createdAt,
        attemptCount: running.attemptCount,
      };
      const result =
        actionName === "workspace.suspend"
          ? await applyWorkspaceSuspension(effectInput)
          : await applyWorkspaceReactivation(effectInput);
      return {
        details: mergeDetails(running, { status: result.status }),
        effectiveAt: result.effectiveAt,
      };
    },
  );
  return toOperatorCommandResult(action);
}

export async function suspendWorkspaceCommand(
  input: WorkspaceCommandInput,
): Promise<OperatorCommandResult> {
  return executeSuspensionCommand(input, "workspace.suspend");
}

export async function reactivateWorkspaceCommand(
  input: WorkspaceCommandInput,
): Promise<OperatorCommandResult> {
  return executeSuspensionCommand(input, "workspace.unsuspend");
}

export function isEligibleManualUpgradeTarget(
  target: Plan,
  current: Plan,
  customerType: string | null | undefined,
  occupiedSeats: number,
): boolean {
  const hasAudience =
    !!customerType &&
    (target.audience === "any" || target.audience === customerType);
  return (
    target._id !== current._id &&
    target.isActive &&
    !target.isDeleted &&
    target.price > 0 &&
    isPaidPlan(target) &&
    hasAudience &&
    !isDowngrade(current, target) &&
    fitsWithinSeatLimit(target.maxMembers, occupiedSeats)
  );
}

async function loadUpgradeContext(
  input: ManualUpgradeCommandInput,
): Promise<UpgradeContext> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    input.tenantId,
  ).findOne();
  assert(
    hasEligibleStripeSubscription(subscription),
    HTTP_BAD_REQUEST,
    "saas.errors.operator.stripe_subscription_required",
  );
  const currentPlan = subscription.planId
    ? await GetModel(PlanModel).get(subscription.planId)
    : undefined;
  assert(currentPlan, HTTP_NOT_FOUND, "saas.errors.plan.invalid");
  const billingInfo = await GetModel(
    TenantBillingInfoModel,
    input.tenantId,
  ).findOne();
  const targetPlan = await loadAndValidateTargetPlan(
    GetModel(PlanModel),
    input.targetPlanId,
    billingInfo?.customerType,
  );
  return { subscription, currentPlan, targetPlan };
}

async function executeManualUpgradeEffect(
  input: ManualUpgradeCommandInput,
  action: OperatorAction,
): Promise<OperatorActionSuccess> {
  const context = await loadUpgradeContext(input);
  await applyManualUpgrade(input, action, context);
  return {
    details: mergeDetails(action, {
      previousPlanId: action.details.previousPlanId ?? context.currentPlan._id,
      previousPlanName:
        action.details.previousPlanName ?? context.currentPlan.name,
      targetPlanId: context.targetPlan._id,
      targetPlanName: context.targetPlan.name,
    }),
    effectiveAt: new Date(),
  };
}

function assertManualUpgrade(context: UpgradeContext): void {
  assert(
    context.subscription.planId !== context.targetPlan._id,
    HTTP_CONFLICT,
    "saas.errors.operator.plan_already_applied",
  );
  assert(
    context.targetPlan.price > 0 && isPaidPlan(context.targetPlan),
    HTTP_BAD_REQUEST,
    "saas.errors.operator.paid_plan_required",
  );
  assert(
    !isDowngrade(context.currentPlan, context.targetPlan),
    HTTP_BAD_REQUEST,
    "saas.errors.operator.upgrade_only",
  );
}

async function applyManualUpgrade(
  input: ManualUpgradeCommandInput,
  action: OperatorAction,
  context: UpgradeContext,
): Promise<void> {
  assertManualUpgrade(context);
  await assertSeatLimit(input.tenantId, context.targetPlan);
  await checkpointOperatorActionDetails(action, {
    previousPlanId: context.currentPlan._id,
    previousPlanName: context.currentPlan.name,
    targetPlanId: context.targetPlan._id,
    targetPlanName: context.targetPlan.name,
  });
  await applyImmediateChange(
    input.tenantId,
    context.subscription,
    context.targetPlan,
    GetModel(TenantSubscriptionModel, input.tenantId),
    {
      operationId: input.operationId,
      kind: "change_plan",
      targetPlanId: input.targetPlanId,
      requestedAt: action.createdAt,
    },
  );
}

export async function manuallyUpgradeWorkspaceCommand(
  input: ManualUpgradeCommandInput,
): Promise<OperatorCommandResult> {
  const action = await executeOperatorAction(
    {
      ...input,
      action: "subscription.upgrade",
      details: { targetPlanId: input.targetPlanId },
    },
    (running) => executeManualUpgradeEffect(input, running),
  );
  return toOperatorCommandResult(action);
}

export function validateBalanceCreditInput(
  amountCents: number,
  reason: string,
): void {
  assert(
    Number.isSafeInteger(amountCents) && amountCents > 0,
    HTTP_BAD_REQUEST,
    "saas.errors.operator.invalid_credit_amount",
  );
  const normalizedReason = reason.trim();
  assert(
    normalizedReason.length > 0 &&
      normalizedReason.length <= CREDIT_REASON_MAX_LENGTH,
    HTTP_BAD_REQUEST,
    "saas.errors.operator.invalid_credit_reason",
  );
}

async function loadCreditAccount(tenantId: string): Promise<CreditAccount> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  assert(
    subscription?.stripeCustomerId,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.no_stripe_customer",
  );
  const plan = subscription.planId
    ? await GetModel(PlanModel).get(subscription.planId)
    : undefined;
  assert(plan?.currency, HTTP_BAD_REQUEST, "saas.errors.plan.invalid");
  return { customerId: subscription.stripeCustomerId, currency: plan.currency };
}

async function createBalanceCredit(
  input: BalanceCreditCommandInput,
  action: OperatorAction,
): Promise<OperatorActionSuccess> {
  const account = await creditAccountForAction(input.tenantId, action);
  const transaction =
    await getStripeClient().customers.createBalanceTransaction(
      account.customerId,
      {
        amount: -input.amountCents,
        currency: account.currency.toLowerCase(),
        description: input.reason,
      },
      { idempotencyKey: `saas-operator-credit:${input.operationId}` },
    );
  return {
    details: mergeDetails(action, {
      amountCents: input.amountCents,
      reason: input.reason,
      currency: account.currency,
      stripeTransactionId: transaction.id,
      endingBalanceCents: transaction.ending_balance,
    }),
    effectiveAt: stripeSecondsToDate(transaction.created) ?? new Date(),
  };
}

async function creditAccountForAction(
  tenantId: string,
  action: OperatorAction,
): Promise<CreditAccount> {
  const { stripeCustomerId, currency } = action.details;
  if (typeof stripeCustomerId === "string" && typeof currency === "string")
    return { customerId: stripeCustomerId, currency };
  const account = await loadCreditAccount(tenantId);
  await checkpointOperatorActionDetails(action, {
    stripeCustomerId: account.customerId,
    currency: account.currency,
  });
  return account;
}

export async function grantBalanceCreditCommand(
  input: BalanceCreditCommandInput,
): Promise<OperatorCommandResult> {
  const normalized = { ...input, reason: input.reason.trim() };
  validateBalanceCreditInput(normalized.amountCents, normalized.reason);
  const action = await executeOperatorAction(
    {
      ...normalized,
      action: "customer_balance.credit",
      details: {
        amountCents: normalized.amountCents,
        reason: normalized.reason,
      },
    },
    (running) => createBalanceCredit(normalized, running),
  );
  return toOperatorCommandResult(action);
}

function toEligiblePlan(plan: Plan): EligibleUpgradePlan {
  return {
    id: plan._id,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    maxMembers: plan.maxMembers,
  };
}

async function retrieveCustomerBalance(
  subscription: TenantSubscription | undefined,
): Promise<number | null> {
  if (!subscription?.stripeCustomerId) return null;
  const balance = await retrieveStripeCustomerBalance(
    subscription.stripeCustomerId,
  ).catch(() => null);
  if (!balance || balance.status === "deleted") return null;
  return balance.balanceMinorUnits;
}

async function findEligibleUpgradePlans(
  tenantId: string,
  current: Plan | undefined,
  customerType: string | null | undefined,
): Promise<EligibleUpgradePlan[]> {
  if (!current) return [];
  const occupiedSeats = await countOccupiedSeats(tenantId);
  const plans = await GetModel(PlanModel).findActiveNotDeleted();
  return plans
    .filter((plan) =>
      isEligibleManualUpgradeTarget(plan, current, customerType, occupiedSeats),
    )
    .map(toEligiblePlan);
}

export async function getWorkspaceOperatorOptions(
  tenantId: string,
): Promise<WorkspaceOperatorOptions> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  const current = subscription?.planId
    ? await GetModel(PlanModel).get(subscription.planId)
    : undefined;
  const billingInfo = await GetModel(
    TenantBillingInfoModel,
    tenantId,
  ).findOne();
  const hasStripeSubscription = hasEligibleStripeSubscription(subscription);
  const eligible = hasStripeSubscription
    ? await findEligibleUpgradePlans(
        tenantId,
        current,
        billingInfo?.customerType,
      )
    : [];
  return {
    currentPlanId: current?._id ?? null,
    currentPlanName: current?.name ?? null,
    currency: current?.currency ?? null,
    customerBalanceCents: await retrieveCustomerBalance(subscription),
    hasStripeCustomer: !!subscription?.stripeCustomerId,
    hasStripeSubscription,
    eligibleUpgradePlans: eligible,
  };
}
