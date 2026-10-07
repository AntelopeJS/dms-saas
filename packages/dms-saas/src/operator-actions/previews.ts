import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { UpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import { type Plan, PlanModel } from "../db";
import {
  monthlyPlanAmountMinor,
  planUnitAmountMinor,
} from "../metrics/normalised-mrr";
import { fitsWithinSeatLimit } from "../plans/seat-capacity";
import { getUpcomingInvoicePreview } from "../upcoming-invoice/preview";
import {
  loadWorkspaceOperatorView,
  type WorkspaceOperatorView,
} from "../workspaces/operator-view";
import { OperatorActionModel } from "./db/operator-action.model";
import type { OperatorAction } from "./db/operator-action.table";

const HTTP_BAD_REQUEST = 400;
const MONTHS_PER_YEAR = 12;
const SUCCEEDED_STATUS = "succeeded";
const SUSPEND_ACTION = "workspace.suspend";

/** The next invoice of a workspace, as Stripe previews it. */
export interface NextInvoiceRef {
  amountMinor: number;
  currency: string;
  date: string;
}

/** The workspace owner as an operator dialog names them. */
export interface OwnerRef {
  name: string | null;
  email: string | null;
}

/** What suspending (or reactivating) a workspace changes, before it runs. */
export interface SuspensionImpact {
  workspaceName: string;
  status: string;
  members: number;
  stripeSubscriptionId: string | null;
  nextInvoice: NextInvoiceRef | null;
  owner: OwnerRef | null;
  suspendedSince: string | null;
  suspendedBy: string | null;
}

/** A plan an operator can grant complimentary access on. */
export interface ComplimentaryPlanOption {
  id: string;
  name: string;
  unitAmountMinor: number;
  currency: string;
  interval: string;
  billingMode: string;
  maxMembers: number;
  fits: boolean;
}

/** What granting complimentary access changes, before it runs. */
export interface ComplimentaryImpact {
  workspaceName: string;
  currentPlanId: string | null;
  isComplimentary: boolean;
  freeUntil: string | null;
  stripeSubscriptionId: string | null;
  mrrMinor: number;
  currency: string | null;
  nextInvoice: NextInvoiceRef | null;
  seats: number;
  owner: OwnerRef | null;
  plans: ComplimentaryPlanOption[];
}

/**
 * The most an operator may credit in one grant: a year of what the
 * workspace's plan bills at its current seats. A workspace billed nothing
 * cannot be credited.
 */
export function balanceCreditCeilingMinor(view: WorkspaceOperatorView): number {
  if (!view.plan || view.subscription?.isComplimentary) return 0;
  return (
    monthlyPlanAmountMinor(view.plan, view.seats.occupied) * MONTHS_PER_YEAR
  );
}

/** Refuses a credit above the ceiling, or on a workspace billed nothing. */
export function assertBalanceCreditWithinCeiling(
  view: WorkspaceOperatorView,
  amountMinor: number,
): void {
  const ceiling = balanceCreditCeilingMinor(view);
  assert(
    ceiling > 0,
    HTTP_BAD_REQUEST,
    "saas.errors.operator.credit_not_billed",
  );
  assert(
    amountMinor <= ceiling,
    HTTP_BAD_REQUEST,
    "saas.errors.operator.credit_over_ceiling",
  );
}

/** The next invoice of a preview, when Stripe could price one. */
export function nextInvoiceOf(
  preview: UpcomingInvoicePreview | null,
): NextInvoiceRef | null {
  if (preview?.status !== "available") return null;
  return {
    amountMinor: preview.totalMinorUnits,
    currency: preview.currency,
    date: preview.billingDate,
  };
}

/** The upcoming invoice, or none when Stripe cannot be reached. */
export async function safeUpcomingInvoice(
  tenantId: string,
): Promise<UpcomingInvoicePreview | null> {
  return getUpcomingInvoicePreview(tenantId).catch(() => null);
}

function ownerOf(view: WorkspaceOperatorView): OwnerRef | null {
  const { ownerName, ownerEmail } = view.directory;
  return ownerName || ownerEmail
    ? { name: ownerName, email: ownerEmail }
    : null;
}

async function lastSuspension(
  tenantId: string,
): Promise<OperatorAction | undefined> {
  const actions: OperatorAction[] = await GetModel(OperatorActionModel)
    .table.getAll(tenantId, "tenantId")
    .run();
  return actions
    .filter(
      (action) =>
        action.action === SUSPEND_ACTION && action.status === SUCCEEDED_STATUS,
    )
    .sort(
      (left, right) => +new Date(right.createdAt) - +new Date(left.createdAt),
    )[0];
}

/** Who loses access, what Stripe stops and who is told, for one workspace. */
export async function loadSuspensionImpact(
  tenantId: string,
): Promise<SuspensionImpact> {
  const view = await loadWorkspaceOperatorView(tenantId);
  const isSuspended = view.billingState === "suspended";
  const [preview, suspension] = await Promise.all([
    safeUpcomingInvoice(tenantId),
    isSuspended ? lastSuspension(tenantId) : undefined,
  ]);
  return {
    workspaceName: view.tenant.name,
    status: view.billingState,
    members: view.seats.members,
    stripeSubscriptionId: view.subscription?.stripeSubscriptionId ?? null,
    nextInvoice: nextInvoiceOf(preview),
    owner: ownerOf(view),
    suspendedSince: isSuspended
      ? (view.directory.stateSince?.toISOString() ?? null)
      : null,
    suspendedBy: suspension?.actorEmail ?? null,
  };
}

function toComplimentaryOption(
  plan: Plan,
  seats: number,
): ComplimentaryPlanOption {
  return {
    id: plan._id,
    name: plan.name,
    unitAmountMinor: planUnitAmountMinor(plan),
    currency: plan.currency.toUpperCase(),
    interval: plan.interval,
    billingMode: plan.billingMode,
    maxMembers: plan.maxMembers,
    fits: fitsWithinSeatLimit(plan.maxMembers, seats),
  };
}

function isOfferedTo(
  plan: Plan,
  customerType: string | null | undefined,
): boolean {
  return plan.audience === "any" || plan.audience === customerType;
}

/** The Stripe subscription it ends and the MRR it stops, with the plans on offer. */
export async function loadComplimentaryImpact(
  tenantId: string,
): Promise<ComplimentaryImpact> {
  const view = await loadWorkspaceOperatorView(tenantId);
  const [plans, preview] = await Promise.all([
    GetModel(PlanModel).findActiveNotDeleted(),
    safeUpcomingInvoice(tenantId),
  ]);
  const customerType = view.billingInfo?.customerType;
  return {
    workspaceName: view.tenant.name,
    currentPlanId: view.plan?._id ?? null,
    isComplimentary: view.subscription?.isComplimentary === true,
    freeUntil: view.subscription?.freeUntil?.toISOString() ?? null,
    stripeSubscriptionId: view.subscription?.stripeSubscriptionId ?? null,
    mrrMinor: view.directory.mrrMinor,
    currency: view.directory.currency,
    nextInvoice: nextInvoiceOf(preview),
    seats: view.seats.occupied,
    owner: ownerOf(view),
    plans: plans
      .filter((plan) => isOfferedTo(plan, customerType))
      .map((plan) => toComplimentaryOption(plan, view.seats.occupied)),
  };
}
