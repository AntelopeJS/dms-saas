import { createHash } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import type {
  Plan,
  PlanProviderRefs,
  PlanStripePriceTerms,
  PlanStripeProductTerms,
  PlanStripeSyncedTerms,
} from "../db";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_STRIPE_TAX_CODE,
} from "../db";
import { getStripeClient } from "./client";

/** Minor units per major unit of a plan price, as its Stripe price is created. */
export const PRICE_MULTIPLIER = 100;
const SEAT_USAGE_TYPE = "licensed" as const;
const PRICE_TAX_BEHAVIOR = "exclusive" as const;
const IDEMPOTENCY_KEY_PREFIX = "dms-saas:plan-sync";
const RESOURCE_MISSING_CODE = "resource_missing";
const I18N_KEY_PREFIX = "$";

/** What a Stripe price or product holds today, when it can be read back. */
interface StripeHeldTerms {
  product?: PlanStripeProductTerms;
  price?: PlanStripePriceTerms;
}

/** The product and price a sync links the plan to. */
interface PlanStripeLink {
  productId: string;
  priceId: string;
}

/** The Stripe tax code products are created with, from the billing settings. */
export async function resolveProductTaxCode(): Promise<string> {
  const billingSettingsModel = GetModel(BillingSettingsModel);
  const settings = await billingSettingsModel.get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  return settings?.stripeTaxCode || DEFAULT_STRIPE_TAX_CODE;
}

/**
 * Stripe shows a product description to customers as written: a `$` i18n key
 * has no text Stripe could show, so the product carries none.
 */
function stripeProductDescription(description: string | undefined): string {
  if (!description || description.startsWith(I18N_KEY_PREFIX)) return "";
  return description;
}

/**
 * The terms a plan's Stripe product and price must carry.
 *
 * @param plan Plan as stored
 * @param taxCode Stripe tax code products are created with
 */
function planStripeTerms(plan: Plan, taxCode: string): PlanStripeSyncedTerms {
  return {
    product: {
      name: plan.name,
      description: stripeProductDescription(plan.description),
      taxCode,
    },
    price: {
      unitAmount: Math.round(plan.price * PRICE_MULTIPLIER),
      currency: plan.currency.toLowerCase(),
      interval: plan.interval,
      billingMode: plan.billingMode,
    },
  };
}

function isSameTerms(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Whether the plan's Stripe product and price already carry its terms, read
 * from what the last sync recorded: no Stripe call.
 *
 * @param plan Plan as stored
 * @param taxCode Stripe tax code products are created with
 */
export function isPlanStripeSyncCurrent(plan: Plan, taxCode: string): boolean {
  const refs = plan.paymentProviderRefs;
  if (!refs?.stripeProductId || !refs.stripePriceId) return false;
  return isSameTerms(refs.stripeSyncedTerms, planStripeTerms(plan, taxCode));
}

/**
 * A key that makes every replica, and every retry within Stripe's idempotency
 * window, land on the same Stripe object for the same write. The plan's
 * creation time keeps two environments sharing one Stripe account apart when
 * their plans share an id.
 */
function idempotencyKey(plan: Plan, operation: string, params: unknown) {
  const digest = createHash("sha256")
    .update(JSON.stringify([plan._id, plan.createdAt, params]))
    .digest("hex");
  return `${IDEMPOTENCY_KEY_PREFIX}:${operation}:${digest}`;
}

function toHeldProductTerms(
  product: Stripe.Product | Stripe.DeletedProduct | string,
): PlanStripeProductTerms | undefined {
  if (typeof product === "string" || product.deleted) return undefined;
  const taxCode = product.tax_code;
  return {
    name: product.name,
    description: product.description ?? "",
    taxCode: typeof taxCode === "string" ? taxCode : (taxCode?.id ?? ""),
  };
}

function toHeldPriceTerms(
  price: Stripe.Price,
): PlanStripePriceTerms | undefined {
  if (!price.active || !price.recurring || price.unit_amount === null) {
    return undefined;
  }
  return {
    unitAmount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring.interval as PlanStripePriceTerms["interval"],
    billingMode: price.metadata
      .billingMode as PlanStripePriceTerms["billingMode"],
  };
}

function isResourceMissing(error: unknown): boolean {
  return (error as Stripe.errors.StripeError)?.code === RESOURCE_MISSING_CODE;
}

/**
 * The terms the linked objects hold. A plan synced before the terms were
 * recorded is read back from Stripe once, so an unchanged price is kept rather
 * than replaced: subscriptions are matched to plans by price id.
 */
async function heldTerms(refs: PlanProviderRefs): Promise<StripeHeldTerms> {
  if (refs.stripeSyncedTerms) return refs.stripeSyncedTerms;
  if (!refs.stripePriceId) return {};
  try {
    const price = await getStripeClient().prices.retrieve(refs.stripePriceId, {
      expand: ["product"],
    });
    return {
      product: toHeldProductTerms(price.product),
      price: toHeldPriceTerms(price),
    };
  } catch (error) {
    if (isResourceMissing(error)) return {};
    throw error;
  }
}

async function createProduct(
  plan: Plan,
  terms: PlanStripeProductTerms,
): Promise<string> {
  const params: Stripe.ProductCreateParams = {
    name: terms.name,
    description: terms.description || undefined,
    tax_code: terms.taxCode,
    metadata: { planId: plan._id },
  };
  const product = await getStripeClient().products.create(params, {
    idempotencyKey: idempotencyKey(plan, "product", params),
  });
  return product.id;
}

async function syncProduct(
  plan: Plan,
  terms: PlanStripeProductTerms,
  held: PlanStripeProductTerms | undefined,
): Promise<string> {
  const productId = plan.paymentProviderRefs?.stripeProductId;
  if (!productId) return createProduct(plan, terms);
  if (isSameTerms(held, terms)) return productId;
  await getStripeClient().products.update(productId, {
    name: terms.name,
    description: terms.description,
    tax_code: terms.taxCode,
  });
  return productId;
}

function buildRecurring(
  terms: PlanStripePriceTerms,
): Stripe.PriceCreateParams.Recurring {
  const recurring: Stripe.PriceCreateParams.Recurring = {
    interval: terms.interval,
  };
  if (terms.billingMode === "seat") {
    recurring.usage_type = SEAT_USAGE_TYPE;
  }
  return recurring;
}

/**
 * Creates the price for the new terms and archives the one it replaces. The
 * replaced price is part of the idempotency key: returning to earlier terms
 * creates a fresh price instead of reviving an archived one.
 */
async function replacePrice(
  plan: Plan,
  productId: string,
  terms: PlanStripePriceTerms,
): Promise<string> {
  const stripe = getStripeClient();
  const previousPriceId = plan.paymentProviderRefs?.stripePriceId;
  const params: Stripe.PriceCreateParams = {
    product: productId,
    unit_amount: terms.unitAmount,
    currency: terms.currency,
    recurring: buildRecurring(terms),
    tax_behavior: PRICE_TAX_BEHAVIOR,
    metadata: { planId: plan._id, billingMode: terms.billingMode },
  };
  const price = await stripe.prices.create(params, {
    idempotencyKey: idempotencyKey(plan, "price", [params, previousPriceId]),
  });
  if (previousPriceId && previousPriceId !== price.id) {
    await stripe.prices.update(previousPriceId, { active: false });
  }
  return price.id;
}

async function syncLink(
  plan: Plan,
  terms: PlanStripeSyncedTerms,
): Promise<PlanStripeLink> {
  const refs = plan.paymentProviderRefs ?? {};
  const held = await heldTerms(refs);
  const productId = await syncProduct(plan, terms.product, held.product);
  const isPriceCurrent =
    !!refs.stripePriceId &&
    productId === refs.stripeProductId &&
    isSameTerms(held.price, terms.price);
  const priceId = isPriceCurrent
    ? (refs.stripePriceId as string)
    : await replacePrice(plan, productId, terms.price);
  return { productId, priceId };
}

/**
 * Brings the plan's Stripe product and price in line with the plan and returns
 * the refs to store. Idempotent: a plan already in line costs no Stripe write,
 * and concurrent syncs of the same plan land on the same Stripe objects.
 * Product fields are updated in place; a changed amount, currency, interval or
 * billing mode creates a new price, since Stripe prices are immutable, and
 * archives the old one.
 *
 * @param plan Plan as stored, with a supported interval
 * @param taxCode Stripe tax code products are created with
 */
export async function syncPlanWithStripe(
  plan: Plan,
  taxCode: string,
): Promise<PlanProviderRefs> {
  const terms = planStripeTerms(plan, taxCode);
  const link = await syncLink(plan, terms);
  return {
    stripeProductId: link.productId,
    stripePriceId: link.priceId,
    stripeSyncedTerms: terms,
  };
}
