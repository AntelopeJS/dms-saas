import type Stripe from "stripe";
import type { TenantBillingAddress, VatVerificationStatus } from "../db";
import { getStripeClient } from "./client";

/** Stripe reports `unavailable` for countries it cannot check; treated as
 * unverified so the badge never claims a verification that never ran. */
const VAT_VERIFICATION_BY_STRIPE_STATUS: Record<string, VatVerificationStatus> =
  {
    pending: "pending",
    verified: "verified",
    unverified: "unverified",
    unavailable: "unverified",
  };

export interface CustomerBillingAddress {
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface CustomerBillingProfile {
  customerType: "individual" | "business";
  companyName?: string | null;
  fallbackName?: string | null;
  billingEmail?: string | null;
  vatNumber?: string | null;
  address?: CustomerBillingAddress;
}

const CARD_PAYMENT_METHOD_TYPE = "card";
const OFF_SESSION_USAGE = "off_session" as const;

const EU_VAT_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

const NON_EU_VAT_TAX_ID_TYPES: Record<string, string> = {
  GB: "gb_vat",
  CH: "ch_vat",
  NO: "no_vat",
  AU: "au_abn",
  NZ: "nz_gst",
  CA: "ca_gst_hst",
};

export function resolveTaxIdType(
  country: string | null | undefined,
): string | undefined {
  if (!country) return undefined;
  const code = country.trim().toUpperCase();
  if (EU_VAT_COUNTRIES.has(code)) return "eu_vat";
  return NON_EU_VAT_TAX_ID_TYPES[code];
}

export function toStripeAddress(
  source: CustomerBillingAddress | undefined,
): Stripe.AddressParam | undefined {
  if (!source?.country) return undefined;
  return {
    line1: source.line1 ?? undefined,
    line2: source.line2 ?? undefined,
    postal_code: source.postalCode ?? undefined,
    city: source.city ?? undefined,
    state: source.state ?? undefined,
    country: source.country,
  };
}

export function toTenantBillingAddress(
  source: CustomerBillingAddress | undefined,
): TenantBillingAddress | null {
  if (!source) return null;
  return {
    line1: source.line1 ?? null,
    line2: source.line2 ?? null,
    postalCode: source.postalCode ?? null,
    city: source.city ?? null,
    state: source.state ?? null,
    country: source.country ?? null,
  };
}

function resolveCustomerName(
  profile: CustomerBillingProfile,
): string | undefined {
  if (profile.customerType === "business") {
    return profile.companyName ?? profile.fallbackName ?? undefined;
  }
  return profile.fallbackName ?? undefined;
}

export interface CardSetupIntent {
  clientSecret: string | null;
}

export async function createCardSetupIntent(): Promise<CardSetupIntent> {
  const intent = await getStripeClient().setupIntents.create({
    payment_method_types: [CARD_PAYMENT_METHOD_TYPE],
    usage: OFF_SESSION_USAGE,
  });
  return { clientSecret: intent.client_secret };
}

export async function syncStripeCustomerBilling(
  customerId: string,
  profile: CustomerBillingProfile,
): Promise<void> {
  const stripe = getStripeClient();
  await stripe.customers.update(customerId, {
    name: resolveCustomerName(profile),
    email: profile.billingEmail ?? undefined,
    address: toStripeAddress(profile.address),
  });
}

export function toVatVerificationStatus(
  taxId: Stripe.TaxId,
): VatVerificationStatus {
  const status = taxId.verification?.status;
  return (status && VAT_VERIFICATION_BY_STRIPE_STATUS[status]) ?? "pending";
}

/**
 * `reachable` separates "Stripe says this customer has no tax ID" from "the
 * call failed", so a transient outage never erases a stored verification.
 */
export interface TaxIdSnapshot {
  reachable: boolean;
  taxId: Stripe.TaxId | null;
}

export async function fetchPrimaryTaxId(
  customerId: string,
): Promise<TaxIdSnapshot> {
  const stripe = getStripeClient();
  const taxIds = await stripe.customers
    .listTaxIds(customerId)
    .catch(() => null);
  if (!taxIds) return { reachable: false, taxId: null };
  return { reachable: true, taxId: taxIds.data[0] ?? null };
}

/**
 * Replays the customer's VAT number as a Stripe tax ID and returns the
 * verification Stripe ran against VIES, or null when no number applies.
 * Failures propagate to the caller on purpose: swallowing a rejected number
 * after the existing tax IDs were purged would leave the customer with no
 * tax ID at all — VAT charged to a B2B customer entitled to reverse charge —
 * behind a "saved" toast. The form surfaces the error instead.
 */
export async function reconcileStripeTaxId(
  customerId: string,
  profile: Pick<
    CustomerBillingProfile,
    "customerType" | "vatNumber" | "address"
  >,
): Promise<VatVerificationStatus | null> {
  const stripe = getStripeClient();
  const existing = await stripe.customers.listTaxIds(customerId);
  for (const taxId of existing.data) {
    await stripe.customers.deleteTaxId(customerId, taxId.id);
  }
  if (profile.customerType !== "business" || !profile.vatNumber) return null;
  const type = resolveTaxIdType(profile.address?.country);
  if (!type) return null;
  const created = await stripe.customers.createTaxId(customerId, {
    type: type as Stripe.TaxIdCreateParams.Type,
    value: profile.vatNumber,
  });
  return toVatVerificationStatus(created);
}
