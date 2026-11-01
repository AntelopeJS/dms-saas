import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { InvoiceLineItemsProvider } from "@antelopejs/interface-dms-saas/invoice-line-items";
import { fromPartial, type PartialDeep } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { afterEach, beforeEach, type MockInstance, vi } from "vitest";
import { setRuntimeConfig } from "../../src/config/runtime";
import {
  PlanModel,
  type TenantSubscription,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../../src/db";
import { internal as lineItemsRegistry } from "../../src/implementations/dms-saas/invoice-line-items";
import type { SuiteStripe } from "./stripe";

export const NOW = new Date("2026-09-15T12:00:00.000Z");
export const CYCLE_START = new Date("2026-09-01T00:00:00.000Z");
export const CYCLE_END = new Date("2026-10-01T00:00:00.000Z");
export const NEXT_CYCLE_END = new Date("2026-11-01T00:00:00.000Z");
export const PAID_PLAN_ID = "plan-pro";
export const FREE_PLAN_ID = "plan-free";
export const SUBSCRIPTION_ID = "sub_current";
export const STRIPE_CONFIG = {
  secretKey: "sk_test_dummy",
  webhookSecret: "whsec_test",
  publishableKey: "pk_test",
};
export const FRENCH_VAT_ID = "txr_fr";
export const GERMAN_REVERSE_CHARGE_ID = "txr_de";

const SUBSCRIBED_AT = new Date("2026-06-01T00:00:00.000Z");

export function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** A workspace whose subscription and billing identity are stored. */
export interface PreviewWorkspace {
  tenantId: string;
  customerId: string;
}

/**
 * Stores a workspace subscribed to the paid plan on an active Stripe
 * subscription, with a billing identity, under a Stripe customer of its own.
 * `patch` overrides the subscription row.
 */
export async function seedPreviewWorkspace(
  patch: Partial<TenantSubscription> = {},
): Promise<PreviewWorkspace> {
  const tenantId = randomUUID();
  const customerId = `cus_${randomUUID()}`;
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: PAID_PLAN_ID,
    status: "active",
    stripeCustomerId: customerId,
    stripeSubscriptionId: SUBSCRIPTION_ID,
    currentPeriodStart: CYCLE_START,
    currentPeriodEnd: CYCLE_END,
    paidUsagePeriods: [
      {
        stripeSubscriptionId: SUBSCRIPTION_ID,
        start: SUBSCRIBED_AT,
        end: null,
      },
    ],
    ...patch,
  });
  await GetModel(TenantBillingInfoModel, tenantId).insert({ _id: tenantId });
  return { tenantId, customerId };
}

export function frenchVat(): Stripe.TaxRate {
  return fromPartial<Stripe.TaxRate>({
    id: FRENCH_VAT_ID,
    country: "fr",
    percentage: 20,
    effective_percentage: 20,
    tax_type: "vat",
    display_name: "VAT",
    jurisdiction: "France",
  });
}

export function germanReverseCharge(): Stripe.TaxRate {
  return fromPartial<Stripe.TaxRate>({
    ...frenchVat(),
    id: GERMAN_REVERSE_CHARGE_ID,
    country: "DE",
    percentage: 0,
    effective_percentage: 0,
  });
}

export function exclusiveTax(
  amount: number,
  taxRateId = FRENCH_VAT_ID,
  taxabilityReason: Stripe.InvoiceLineItem.Tax.TaxabilityReason = "standard_rated",
): Stripe.InvoiceLineItem.Tax {
  return fromPartial<Stripe.InvoiceLineItem.Tax>({
    amount,
    tax_behavior: "exclusive",
    taxable_amount: amount === 0 ? 0 : 2900,
    taxability_reason: taxabilityReason,
    tax_rate_details: { tax_rate: taxRateId },
    type: "tax_rate_details",
  });
}

export function planLine(taxMinorUnits: number): Stripe.InvoiceLineItem {
  return fromPartial<Stripe.InvoiceLineItem>({
    description: "1 × Pro (at €29.00 / month)",
    amount: 2900,
    pricing: {
      type: "price_details",
      price_details: { price: "price_pro", product: "prod_pro" },
      unit_amount_decimal: "2900",
    },
    taxes: [exclusiveTax(taxMinorUnits)],
    quantity: 1,
    period: { start: seconds(CYCLE_END), end: seconds(NEXT_CYCLE_END) },
    parent: {
      type: "subscription_item_details",
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        proration: false,
        subscription: SUBSCRIPTION_ID,
        subscription_item: "si_current",
      },
    },
    metadata: {},
  });
}

/** The preview invoice Stripe prices for the paid plan, with `overrides` applied. */
export function previewInvoice(
  overrides: PartialDeep<Stripe.Invoice> = {},
): Stripe.Invoice {
  return fromPartial<Stripe.Invoice>({
    currency: "eur",
    lines: { data: [planLine(580)], has_more: false },
    subtotal: 2900,
    subtotal_excluding_tax: 2900,
    total_excluding_tax: 2900,
    total: 3480,
    amount_due: 3480,
    total_taxes: [exclusiveTax(580)],
    customer_address: { country: "FR" },
    automatic_tax: { enabled: true, status: "complete" },
    period_start: seconds(CYCLE_START),
    period_end: seconds(CYCLE_END),
    ...overrides,
  });
}

/** An error carrying the `code` Stripe's errors do. */
export function stripeError(code: string): Error {
  return Object.assign(new Error(`Stripe ${code}`), { code });
}

export function registerProvider(
  id: string,
  resolve: InvoiceLineItemsProvider["resolve"],
): void {
  lineItemsRegistry.RegisterInvoiceLineItemsProvider.register(id, {
    id,
    resolve,
  });
}

/** What Stripe is asked while an upcoming invoice is previewed. */
export interface PreviewStripe {
  readonly retrieveSubscription: MockInstance<
    Stripe["subscriptions"]["retrieve"]
  >;
  readonly createPreview: MockInstance<Stripe["invoices"]["createPreview"]>;
  readonly retrieveTaxRate: MockInstance<Stripe["taxRates"]["retrieve"]>;
}

/**
 * Sets up each test of the file calling it at the top level: the clock stands
 * at {@link NOW}, the runtime holds the default configuration, the plans exist,
 * and Stripe answers a preview of the paid plan. Usage providers registered by
 * a test are unregistered after it.
 *
 * @param stripe The suite's Stripe clients, from `useSuiteStripe`
 */
export function usePreviewEnvironment(stripe: SuiteStripe): PreviewStripe {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    setRuntimeConfig({ stripe: STRIPE_CONFIG });
    const plans = GetModel(PlanModel);
    await plans.delete(PAID_PLAN_ID);
    await plans.delete(FREE_PLAN_ID);
    await plans.insert([
      { _id: PAID_PLAN_ID, price: 29 },
      { _id: FREE_PLAN_ID, price: 0 },
    ]);
    vi.spyOn(stripe.read.subscriptions, "retrieve").mockResolvedValue(
      fromPartial({
        currency: "eur",
        items: {
          data: [
            {
              current_period_start: seconds(CYCLE_START),
              current_period_end: seconds(CYCLE_END),
            },
          ],
        },
      }),
    );
    vi.spyOn(stripe.read.invoices, "createPreview").mockResolvedValue(
      fromPartial(previewInvoice()),
    );
    vi.spyOn(stripe.read.taxRates, "retrieve").mockImplementation(async (id) =>
      fromPartial(
        id === GERMAN_REVERSE_CHARGE_ID ? germanReverseCharge() : frenchVat(),
      ),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    lineItemsRegistry.RegisterInvoiceLineItemsProvider.unregister("cloud");
    lineItemsRegistry.RegisterInvoiceLineItemsProvider.unregister("broken");
  });
  return {
    get retrieveSubscription() {
      return vi.spyOn(stripe.read.subscriptions, "retrieve");
    },
    get createPreview() {
      return vi.spyOn(stripe.read.invoices, "createPreview");
    },
    get retrieveTaxRate() {
      return vi.spyOn(stripe.read.taxRates, "retrieve");
    },
  };
}
