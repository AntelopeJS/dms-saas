import { assert } from "@antelopejs/interface-api-util";
import type { TenantCustomerType } from "../db";
import type { CustomerBillingAddress } from "../stripe";

const HTTP_BAD_REQUEST = 400;
const BUSINESS_CUSTOMER_TYPE: TenantCustomerType = "business";
const CUSTOMER_TYPES = new Set<string>(["individual", "business"]);
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Billing identity as the owner submits it from the billing page. */
export interface BillingIdentityInput {
  customerType?: string | null;
  companyName?: string | null;
  vatNumber?: string | null;
  billingEmail?: string | null;
  address?: CustomerBillingAddress;
}

/** A billing identity every required field of which has been checked. */
export interface BillingIdentity {
  customerType: TenantCustomerType;
  companyName: string | null;
  vatNumber: string | null;
  billingEmail: string;
  address: CustomerBillingAddress;
}

export type BillingIdentityField =
  | "customerType"
  | "companyName"
  | "country"
  | "line1"
  | "postalCode"
  | "city"
  | "billingEmail";

type FieldCheck = (identity: BillingIdentityInput) => boolean;

function trimmed(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function isBusiness(identity: BillingIdentityInput): boolean {
  return identity.customerType === BUSINESS_CUSTOMER_TYPE;
}

const FIELD_CHECKS: Record<BillingIdentityField, FieldCheck> = {
  customerType: (identity) => CUSTOMER_TYPES.has(identity.customerType ?? ""),
  companyName: (identity) =>
    !isBusiness(identity) || !!trimmed(identity.companyName),
  country: (identity) =>
    COUNTRY_CODE_PATTERN.test(trimmed(identity.address?.country) ?? ""),
  line1: (identity) => !!trimmed(identity.address?.line1),
  postalCode: (identity) => !!trimmed(identity.address?.postalCode),
  city: (identity) => !!trimmed(identity.address?.city),
  billingEmail: (identity) =>
    EMAIL_PATTERN.test(trimmed(identity.billingEmail) ?? ""),
};

/**
 * Fields a Stripe invoice cannot be issued without. The VAT number stays
 * optional even for a business: plenty have none, and Stripe verifies the
 * ones that are given.
 *
 * @param identity Submitted or stored billing identity
 * @returns Missing or malformed fields, in form order; empty when complete
 */
export function findMissingBillingIdentityFields(
  identity: BillingIdentityInput,
): BillingIdentityField[] {
  return (Object.keys(FIELD_CHECKS) as BillingIdentityField[]).filter(
    (field) => !FIELD_CHECKS[field](identity),
  );
}

function normalizeAddress(
  address: CustomerBillingAddress | undefined,
): CustomerBillingAddress {
  return {
    line1: trimmed(address?.line1),
    line2: trimmed(address?.line2),
    postalCode: trimmed(address?.postalCode),
    city: trimmed(address?.city),
    state: trimmed(address?.state),
    country: trimmed(address?.country),
  };
}

/**
 * Validates and normalizes a submitted billing identity. Company fields are
 * dropped for an individual so a type switch leaves no stale company behind.
 *
 * @throws 400 `saas.errors.billing.identity_incomplete` when a required field
 *   is missing or malformed
 */
export function parseBillingIdentity(
  identity: BillingIdentityInput,
): BillingIdentity {
  assert(
    findMissingBillingIdentityFields(identity).length === 0,
    HTTP_BAD_REQUEST,
    "saas.errors.billing.identity_incomplete",
  );
  const business = isBusiness(identity);
  return {
    customerType: identity.customerType as TenantCustomerType,
    companyName: business ? trimmed(identity.companyName) : null,
    vatNumber: business ? trimmed(identity.vatNumber) : null,
    billingEmail: trimmed(identity.billingEmail) ?? "",
    address: normalizeAddress(identity.address),
  };
}
