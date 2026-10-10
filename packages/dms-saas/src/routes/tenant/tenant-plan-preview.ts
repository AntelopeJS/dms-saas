// What a plan change costs, priced by Stripe before the owner confirms it:
// the review step of the plan change dialog reads this, and the confirm button
// names the amount it returns.

import { Logging } from "@antelopejs/interface-core/logging";
import type { AvailableUpcomingInvoicePreview } from "@antelopejs/interface-dms-saas/billing";
import type Stripe from "stripe";
import {
  type Plan,
  type PlanInterval,
  type TenantBillingInfo,
  type TenantSubscription,
} from "../../db";
import { countSeatsToCompare, isDowngrade } from "../../plans";
import { getStripeClient } from "../../stripe/client";
import {
  readStripeId,
  readSubscriptionPeriod,
} from "../../stripe/payload-shapes";
import { PRICE_MULTIPLIER } from "../../stripe/sync-plan";
import { previewStripeInvoice } from "../../stripe/upcoming-invoice";
import { toAvailablePreview } from "../../upcoming-invoice/mapping";
import { MS_PER_DAY, stripeSecondsToDate } from "../../utils/time";
import { liveStripeSubscriptionId } from "../../workspaces/first-payment";
import { isCheckoutTrialAvailable } from "./tenant-plan-checkout";
import { isPaidPlan, planQuantity } from "./tenant-plan-ops";

const LOG_PREFIX = "[dms-saas:plan-preview]";
const MS_PER_SECOND = 1000;
const ALWAYS_INVOICE = "always_invoice" as const;
const TRIALING_STATUS = "trialing";
const COMPLETE_TAX_STATUS = "complete";
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const MONTHS_PER_INTERVAL: Record<PlanInterval, number> = {
  month: 1,
  year: 12,
};

/**
 * `upgrade`: applied today, the difference charged at once; `downgrade`:
 * parked until the renewal; `checkout`: a first paid subscription, paid on
 * Stripe's payment page; `free`: a free plan with no Stripe subscription to
 * leave, applied today with nothing billed.
 */
export type PlanChangeKind = "upgrade" | "downgrade" | "checkout" | "free";

/** The recurring charge once the change is in force. */
export interface PlanChangeRenewal {
  at: Date | null;
  amountExcludingTaxMinorUnits: number;
  interval: PlanInterval;
}

/** What changing to one plan costs, as the review step shows it. */
export interface PlanChangePreview {
  kind: PlanChangeKind;
  planId: string;
  currency: string;
  /** Units billed on the target plan: the occupied seats of a seat plan. */
  quantity: number;
  /** Null when the change applies at once. */
  effectiveAt: Date | null;
  isTrial: boolean;
  trialEndsAt: Date | null;
  /**
   * The invoice Stripe issues for the change — today for an upgrade, the
   * first one for a checkout (after the trial, if any). Null for a downgrade,
   * and when Stripe could not price it.
   */
  charge: AvailableUpcomingInvoicePreview | null;
  /** False when Stripe could not price a change that has a charge. */
  isChargeAvailable: boolean;
  renewal: PlanChangeRenewal;
  /** Stripe seconds the upgrade was priced at, sent back on confirm. */
  prorationDate: number | null;
}

/** Everything a preview is computed from. */
export interface PlanChangePreviewInput {
  tenantId: string;
  subscription: TenantSubscription | undefined;
  currentPlan: Plan | null;
  target: Plan;
  billingInfo: TenantBillingInfo | undefined;
  ownerEmail: string;
  /** Billing country typed in the upgrade dialog, before it is saved. */
  country: string | null;
}

interface PreviewBase {
  input: PlanChangePreviewInput;
  quantity: number;
  now: Date;
}

/** Same routing as the plan change itself (`tenant-plan.ts`). */
export function resolvePlanChangeKind(
  subscription: TenantSubscription | undefined,
  currentPlan: Plan | null,
  target: Plan,
  seats?: number,
): PlanChangeKind {
  if (!liveStripeSubscriptionId(subscription))
    return isPaidPlan(target) ? "checkout" : "free";
  const isDeferred =
    !isPaidPlan(target) || isDowngrade(currentPlan, target, seats);
  return isDeferred ? "downgrade" : "upgrade";
}

/** The plan's recurring amount for `quantity` units, before tax. */
export function recurringAmountMinorUnits(
  plan: Plan,
  quantity: number,
): number {
  return Math.round(plan.price * PRICE_MULTIPLIER) * quantity;
}

function addInterval(date: Date, interval: PlanInterval): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + MONTHS_PER_INTERVAL[interval]);
  return next;
}

function toStripeSeconds(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_SECOND);
}

function normalizeCountry(value: string | null | undefined): string | null {
  const country = value?.trim().toUpperCase() ?? "";
  return COUNTRY_CODE_PATTERN.test(country) ? country : null;
}

/** A preview whose tax Stripe could not settle would read as tax-free. */
function isTaxSettled(invoice: Stripe.Invoice): boolean {
  const status = invoice.automatic_tax?.status;
  return !status || status === COMPLETE_TAX_STATUS;
}

async function priceCharge(
  params: Stripe.InvoiceCreatePreviewParams,
  now: Date,
): Promise<AvailableUpcomingInvoicePreview | null> {
  try {
    const priced = await previewStripeInvoice(params);
    if (!isTaxSettled(priced.invoice)) return null;
    return toAvailablePreview(priced, {
      billingDate: now,
      usageThrough: null,
      computedAt: now,
    });
  } catch (error) {
    Logging.Warn(`${LOG_PREFIX} Stripe could not price the change`, error);
    return null;
  }
}

function basePreview(
  base: PreviewBase,
  kind: PlanChangeKind,
): PlanChangePreview {
  const { target } = base.input;
  return {
    kind,
    planId: target._id,
    currency: target.currency.toUpperCase(),
    quantity: base.quantity,
    effectiveAt: null,
    isTrial: false,
    trialEndsAt: null,
    charge: null,
    isChargeAvailable: true,
    renewal: {
      at: null,
      amountExcludingTaxMinorUnits: recurringAmountMinorUnits(
        target,
        base.quantity,
      ),
      interval: target.interval,
    },
    prorationDate: null,
  };
}

function previewDowngrade(base: PreviewBase): PlanChangePreview {
  const effectiveAt = base.input.subscription?.currentPeriodEnd ?? null;
  const preview = basePreview(base, "downgrade");
  return {
    ...preview,
    effectiveAt,
    renewal: { ...preview.renewal, at: effectiveAt },
  };
}

/**
 * Under classic billing a change of interval restarts the cycle today;
 * otherwise the renewal stays where the running cycle ends.
 */
function upgradeRenewalAt(
  base: PreviewBase,
  stripeSubscription: Stripe.Subscription,
): Date | null {
  const { currentPlan, target } = base.input;
  if (currentPlan && currentPlan.interval !== target.interval) {
    return addInterval(base.now, target.interval);
  }
  return stripeSecondsToDate(readSubscriptionPeriod(stripeSubscription).end);
}

function upgradeChargeParams(
  stripeSubscription: Stripe.Subscription,
  base: PreviewBase,
  prorationDate: number,
): Stripe.InvoiceCreatePreviewParams {
  const itemId = stripeSubscription.items.data[0]?.id;
  return {
    customer: readStripeId(stripeSubscription.customer) ?? undefined,
    subscription: stripeSubscription.id,
    subscription_details: {
      items: [
        {
          id: itemId,
          price: base.input.target.paymentProviderRefs?.stripePriceId,
          quantity: base.quantity,
        },
      ],
      proration_behavior: ALWAYS_INVOICE,
      proration_date: prorationDate,
    },
  };
}

async function previewUpgrade(base: PreviewBase): Promise<PlanChangePreview> {
  const preview = basePreview(base, "upgrade");
  const stripeSubscriptionId = base.input.subscription?.stripeSubscriptionId;
  if (!stripeSubscriptionId || !isPaidPlan(base.input.target)) return preview;
  const stripeSubscription =
    await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
  const prorationDate = toStripeSeconds(base.now);
  const charge = await priceCharge(
    upgradeChargeParams(stripeSubscription, base, prorationDate),
    base.now,
  );
  const isTrial = stripeSubscription.status === TRIALING_STATUS;
  return {
    ...preview,
    isTrial,
    trialEndsAt: isTrial
      ? stripeSecondsToDate(stripeSubscription.trial_end)
      : null,
    charge,
    isChargeAvailable: !!charge,
    renewal: {
      ...preview.renewal,
      at: upgradeRenewalAt(base, stripeSubscription),
    },
    prorationDate,
  };
}

function checkoutAddress(
  input: PlanChangePreviewInput,
): Stripe.AddressParam | null {
  const stored = input.billingInfo?.address;
  const country = normalizeCountry(input.country ?? stored?.country);
  if (!country) return null;
  const isStoredCountry = normalizeCountry(stored?.country) === country;
  return {
    country,
    postal_code: isStoredCountry
      ? (stored?.postalCode ?? undefined)
      : undefined,
    city: isStoredCountry ? (stored?.city ?? undefined) : undefined,
    line1: isStoredCountry ? (stored?.line1 ?? undefined) : undefined,
  };
}

/** The first invoice of the subscription, priced without the trial. */
function checkoutChargeParams(
  base: PreviewBase,
): Stripe.InvoiceCreatePreviewParams | null {
  const address = checkoutAddress(base.input);
  const customer = base.input.subscription?.stripeCustomerId ?? undefined;
  if (!address && !customer) return null;
  return {
    customer,
    customer_details: address ? { address } : undefined,
    automatic_tax: { enabled: true },
    subscription_details: {
      items: [
        {
          price: base.input.target.paymentProviderRefs?.stripePriceId,
          quantity: base.quantity,
        },
      ],
    },
  };
}

async function previewCheckout(base: PreviewBase): Promise<PlanChangePreview> {
  const { target, ownerEmail } = base.input;
  const preview = basePreview(base, "checkout");
  const isTrial = await isCheckoutTrialAvailable(target, ownerEmail);
  const trialEndsAt = isTrial
    ? new Date(base.now.getTime() + target.trialDays * MS_PER_DAY)
    : null;
  const params = checkoutChargeParams(base);
  const charge = params ? await priceCharge(params, base.now) : null;
  return {
    ...preview,
    isTrial,
    trialEndsAt,
    charge,
    isChargeAvailable: !!charge,
    renewal: {
      ...preview.renewal,
      at: addInterval(trialEndsAt ?? base.now, target.interval),
    },
  };
}

const PREVIEWS_BY_KIND: Record<
  PlanChangeKind,
  (base: PreviewBase) => PlanChangePreview | Promise<PlanChangePreview>
> = {
  upgrade: previewUpgrade,
  downgrade: previewDowngrade,
  checkout: previewCheckout,
  free: (base) => basePreview(base, "free"),
};

/**
 * Price a plan change the way it would be billed, without changing anything.
 * The caller has already checked the target is sellable to this workspace.
 */
export async function previewPlanChange(
  input: PlanChangePreviewInput,
): Promise<PlanChangePreview> {
  const seats = await countSeatsToCompare(input.tenantId, [
    input.currentPlan,
    input.target,
  ]);
  const kind = resolvePlanChangeKind(
    input.subscription,
    input.currentPlan,
    input.target,
    seats,
  );
  const quantity = await planQuantity(input.tenantId, input.target);
  return PREVIEWS_BY_KIND[kind]({ input, quantity, now: new Date() });
}
