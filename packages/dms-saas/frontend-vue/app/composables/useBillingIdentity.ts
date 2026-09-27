const BILLING_INFO_ENDPOINT = "/api/saas/tenant/billing-info";
const BUSINESS_CUSTOMER_TYPE = "business";
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CustomerType = "individual" | "business";
export type VatVerificationStatus = "pending" | "verified" | "unverified";

export type BillingIdentityField =
  | "customerType"
  | "companyName"
  | "country"
  | "line1"
  | "postalCode"
  | "city"
  | "billingEmail";

/** The editable billing identity, as the form holds it. */
export interface BillingIdentityDraft {
  customerType: CustomerType | null;
  companyName: string;
  vatNumber: string;
  billingEmail: string;
  country: string;
  line1: string;
  postalCode: string;
  city: string;
}

interface BillingAddress {
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface BillingInfoResponse {
  customerType: CustomerType | null;
  companyName: string | null;
  vatNumber: string | null;
  vatVerificationStatus: VatVerificationStatus | null;
  billingEmail: string | null;
  address: BillingAddress | null;
  missingFields: BillingIdentityField[];
}

type FieldCheck = (draft: BillingIdentityDraft) => boolean;

function isFilled(value: string): boolean {
  return value.trim().length > 0;
}

// Mirrors the server-side rules (src/workspaces/billing-identity.ts): the
// form flags a field before the request, the server refuses it regardless.
const FIELD_CHECKS: Record<BillingIdentityField, FieldCheck> = {
  customerType: (draft) => draft.customerType !== null,
  companyName: (draft) =>
    draft.customerType !== BUSINESS_CUSTOMER_TYPE ||
    isFilled(draft.companyName),
  country: (draft) => COUNTRY_CODE_PATTERN.test(draft.country.trim()),
  line1: (draft) => isFilled(draft.line1),
  postalCode: (draft) => isFilled(draft.postalCode),
  city: (draft) => isFilled(draft.city),
  billingEmail: (draft) => EMAIL_PATTERN.test(draft.billingEmail.trim()),
};

/**
 * Required fields still missing or malformed, in form order; empty when the
 * identity can be saved. The VAT number is optional, even for a business.
 */
export function findMissingBillingFields(
  draft: BillingIdentityDraft,
): BillingIdentityField[] {
  return (Object.keys(FIELD_CHECKS) as BillingIdentityField[]).filter(
    (field) => !FIELD_CHECKS[field](draft),
  );
}

export function emptyBillingIdentityDraft(): BillingIdentityDraft {
  return {
    customerType: null,
    companyName: "",
    vatNumber: "",
    billingEmail: "",
    country: "",
    line1: "",
    postalCode: "",
    city: "",
  };
}

export function toBillingIdentityDraft(
  info: BillingInfoResponse,
): BillingIdentityDraft {
  return {
    customerType: info.customerType,
    companyName: info.companyName ?? "",
    vatNumber: info.vatNumber ?? "",
    billingEmail: info.billingEmail ?? "",
    country: info.address?.country ?? "",
    line1: info.address?.line1 ?? "",
    postalCode: info.address?.postalCode ?? "",
    city: info.address?.city ?? "",
  };
}

function toRequestBody(draft: BillingIdentityDraft) {
  const isBusiness = draft.customerType === BUSINESS_CUSTOMER_TYPE;
  return {
    customerType: draft.customerType,
    companyName: isBusiness ? draft.companyName : null,
    vatNumber: isBusiness ? draft.vatNumber : null,
    billingEmail: draft.billingEmail,
    address: {
      country: draft.country,
      line1: draft.line1,
      postalCode: draft.postalCode,
      city: draft.city,
    },
  };
}

/** Reads and saves the workspace billing identity. */
export function useBillingIdentity() {
  const { $authFetch } = useAuthFetch();

  function load(): Promise<BillingInfoResponse> {
    return $authFetch<BillingInfoResponse>(BILLING_INFO_ENDPOINT);
  }

  function save(draft: BillingIdentityDraft): Promise<BillingInfoResponse> {
    return $authFetch<BillingInfoResponse>(BILLING_INFO_ENDPOINT, {
      method: "PUT",
      body: toRequestBody(draft),
    });
  }

  return { load, save };
}
