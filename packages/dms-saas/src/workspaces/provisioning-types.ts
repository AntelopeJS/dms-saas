import type { TenantBillingAddress } from "../db";
import type { TenantBeingProvisionedPayload } from "../hooks/tenant-provisioning";

export type WorkspaceCustomerType = "individual" | "business";

export type WorkspaceAddressInput = Partial<
  Record<keyof TenantBillingAddress, string>
>;

export interface WorkspaceBillingProfile {
  customerType: WorkspaceCustomerType;
  companyName?: string;
  vatNumber?: string;
  address?: WorkspaceAddressInput;
}

export interface WorkspaceProvisioningPayload extends WorkspaceBillingProfile {
  workspaceName: string;
  planId: string;
  /**
   * Absent for a card-less workspace, which only a free plan allows, or a
   * workspace that awaits its first payment.
   */
  paymentMethodId?: string;
  /**
   * The workspace opens on its paid plan waiting for its first payment, made
   * through Checkout, as one an operator creates for its owner to pay. No
   * Stripe object is created here.
   */
  awaitsFirstPayment?: boolean;
  /**
   * The consuming SaaS's own capture, handed to `TENANT_BEING_PROVISIONED`
   * listeners and nowhere else. Opaque here: dms-saas never reads it, never
   * stores it, and never returns it.
   */
  extras?: TenantBeingProvisionedPayload["extras"];
}

export interface StripeCustomerProfile extends WorkspaceBillingProfile {
  email: string;
  fallbackName: string;
}

export interface WorkspaceProvisioningHandles {
  /** A committed workspace or an uncertain payment must not be destructively rolled back. */
  mustPreserveWorkspace?: boolean;
  userId?: string;
  tenantId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  trialConsumptionId?: string;
  trialIdentityIds?: string[];
}

export interface CardDetails {
  fingerprint: string | null;
  billingAddress: WorkspaceAddressInput | undefined;
}

export interface WorkspaceProvisioningInput {
  userId: string;
  /** The owner's language, for what the workspace is set up with in words. */
  ownerLanguage?: string;
  payload: WorkspaceProvisioningPayload;
  stripeCustomerProfile: StripeCustomerProfile;
  card: CardDetails;
  handles: WorkspaceProvisioningHandles;
}

export interface ProvisionedWorkspace {
  tenantId: string;
  isTrialing: boolean;
}
