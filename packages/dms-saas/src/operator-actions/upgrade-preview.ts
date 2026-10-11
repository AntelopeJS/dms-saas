import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { AvailableUpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import { type Plan, PlanModel } from "../db";
import { normalisedMrr, planUnitAmountMinor } from "../metrics/normalised-mrr";
import { loadAndValidateTargetPlan } from "../routes/tenant/tenant-plan-ops";
import { getStripeClient } from "../stripe/client";
import { previewStripePriceChange } from "../stripe/upcoming-invoice";
import { toAvailablePreview } from "../upcoming-invoice/mapping";
import {
  loadWorkspaceOperatorView,
  type WorkspaceOperatorView,
} from "../workspaces/operator-view";
import { isEligibleManualUpgradeTarget } from "./commands";

const HTTP_BAD_REQUEST = 400;
const MIN_BILLED_SEATS = 1;

/** A plan as an upgrade dialog shows it: unit price, interval, mode. */
export interface UpgradePlanTerms {
  id: string;
  name: string;
  unitAmountMinor: number;
  currency: string;
  interval: string;
  billingMode: string;
}

/** One line of the prorated invoice Stripe previews for the upgrade. */
export interface UpgradePreviewLine {
  description: string | null;
  amountMinor: number;
  isProration: boolean;
}

/** The invoice figures Stripe priced, in minor units of `currency`. */
export interface UpgradeInvoiceFigures {
  currency: string;
  lines: UpgradePreviewLine[];
  subtotalMinor: number;
  taxMinor: number;
  taxRatePercent: number | null;
  taxCountry: string | null;
  isReverseCharge: boolean;
  totalMinor: number;
  amountDueMinor: number;
  /** When the previewed invoice is issued: now, or at the next renewal. */
  billingDate: string;
}

/** What an immediate upgrade bills, as Stripe prices it. */
export interface UpgradePreview extends UpgradeInvoiceFigures {
  current: UpgradePlanTerms;
  target: UpgradePlanTerms;
  seats: number;
  /** An interval change resets the cycle: the invoice is issued and charged now. */
  isChargedNow: boolean;
  /** What the new plan bills per period afterwards, before tax. */
  renewalAmountMinor: number;
  mrrBeforeMinor: number;
  mrrAfterMinor: number;
}

interface UpgradeContext {
  view: WorkspaceOperatorView;
  current: Plan;
  target: Plan;
  customerId: string;
  subscriptionId: string;
  currentPeriodEnd: Date | null;
}

function termsOf(plan: Plan): UpgradePlanTerms {
  return {
    id: plan._id,
    name: plan.name,
    unitAmountMinor: planUnitAmountMinor(plan),
    currency: plan.currency.toUpperCase(),
    interval: plan.interval,
    billingMode: plan.billingMode,
  };
}

/** What the plan bills per period (a month or a year) at these seats. */
function periodAmountMinor(plan: Plan, seats: number): number {
  const billedSeats =
    plan.billingMode === "seat" ? Math.max(MIN_BILLED_SEATS, seats) : 1;
  return planUnitAmountMinor(plan) * billedSeats;
}

async function subscriptionItemId(subscriptionId: string): Promise<string> {
  const subscription =
    await getStripeClient().subscriptions.retrieve(subscriptionId);
  const itemId = subscription.items.data[0]?.id;
  assert(itemId, HTTP_BAD_REQUEST, "saas.errors.stripe.subscription_no_item");
  return itemId;
}

async function loadUpgradeContext(
  tenantId: string,
  targetPlanId: string,
): Promise<UpgradeContext> {
  const view = await loadWorkspaceOperatorView(tenantId);
  const { subscription, plan: current } = view;
  assert(
    subscription?.stripeSubscriptionId &&
      subscription.stripeCustomerId &&
      current,
    HTTP_BAD_REQUEST,
    "saas.errors.operator.stripe_subscription_required",
  );
  const customerType = view.billingInfo?.customerType;
  const target = await loadAndValidateTargetPlan(
    GetModel(PlanModel),
    targetPlanId,
    customerType,
  );
  assert(
    isEligibleManualUpgradeTarget(
      target,
      current,
      customerType,
      view.seats.occupied,
    ),
    HTTP_BAD_REQUEST,
    "saas.errors.operator.upgrade_not_eligible",
  );
  return {
    view,
    current,
    target,
    customerId: subscription.stripeCustomerId,
    subscriptionId: subscription.stripeSubscriptionId,
    currentPeriodEnd: subscription.currentPeriodEnd ?? null,
  };
}

async function priceUpgrade(
  context: UpgradeContext,
  isChargedNow: boolean,
): Promise<AvailableUpcomingInvoicePreview> {
  const now = new Date();
  const priced = await previewStripePriceChange({
    customerId: context.customerId,
    subscriptionId: context.subscriptionId,
    itemId: await subscriptionItemId(context.subscriptionId),
    priceId: context.target.paymentProviderRefs?.stripePriceId ?? "",
    prorationDate: now,
  });
  return toAvailablePreview(priced, {
    billingDate: isChargedNow ? now : (context.currentPeriodEnd ?? now),
    usageThrough: null,
    computedAt: now,
  });
}

function figuresOf(
  preview: AvailableUpcomingInvoicePreview,
): UpgradeInvoiceFigures {
  const [tax] = preview.taxes;
  return {
    currency: preview.currency,
    lines: preview.lines.map((line) => ({
      description: line.description,
      amountMinor: line.amountMinorUnits,
      isProration: line.isProration,
    })),
    subtotalMinor: preview.subtotalMinorUnits,
    taxMinor: preview.taxMinorUnits,
    taxRatePercent: tax?.ratePercentage ?? null,
    taxCountry: preview.taxCountry,
    isReverseCharge: preview.isReverseCharge,
    totalMinor: preview.totalMinorUnits,
    amountDueMinor: preview.amountDueMinorUnits,
    billingDate: preview.billingDate,
  };
}

/**
 * Prices the immediate upgrade of a workspace to a plan without applying it:
 * the same eligibility rules as the upgrade, Stripe's own figures.
 */
export async function previewManualUpgrade(
  tenantId: string,
  targetPlanId: string,
): Promise<UpgradePreview> {
  const context = await loadUpgradeContext(tenantId, targetPlanId);
  const { view, current, target } = context;
  const isChargedNow = current.interval !== target.interval;
  const preview = await priceUpgrade(context, isChargedNow);
  const seats = view.seats.occupied;
  return {
    ...figuresOf(preview),
    current: termsOf(current),
    target: termsOf(target),
    seats,
    isChargedNow,
    renewalAmountMinor: periodAmountMinor(target, seats),
    mrrBeforeMinor: view.directory.mrrMinor,
    mrrAfterMinor: normalisedMrr({
      billingState: view.billingState,
      isComplimentary: false,
      plan: target,
      billedSeats: seats,
    }).amountMinor,
  };
}
