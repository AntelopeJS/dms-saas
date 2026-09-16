import { Logging } from "@antelopejs/interface-core/logging";
import Stripe from "stripe";
import { getStripeClient } from "./client";

const MISSING_RESOURCE_CODE = "resource_missing";

export interface WorkspaceCheckoutSessionInput {
  operationId?: string;
  tenantId: string;
  ownerEmail: string;
  stripePriceId: string;
  trialDays?: number;
  successUrl: string;
  cancelUrl: string;
  planId?: string;
  existingCustomerId?: string;
}

export interface WorkspaceCheckoutSession {
  sessionId: string;
  url: string;
  customerId: string;
}

/**
 * Raised when Stripe accepts a session but returns no redirect URL. It carries
 * the session id so a caller's rollback can reach the session it never got to
 * record; any customer this call created is already cleaned up.
 */
export class UnusableCheckoutSessionError extends Error {
  constructor(readonly sessionId: string) {
    super("Stripe Checkout did not return a redirect URL");
    this.name = "UnusableCheckoutSessionError";
  }
}

export interface TenantCheckoutCustomerInput {
  operationId?: string;
  tenantId: string;
  ownerEmail: string;
  companyName?: string | null;
}

/**
 * Creates the Stripe Customer a tenant's Checkout session will bill, carrying
 * over the company name the caller already collected: Checkout runs with
 * `customer_update: { name: "auto" }`, and the `customer.updated` webhook keeps
 * the local company name only when Stripe has one, so leaving it unset here
 * would let Checkout's own name box overwrite it.
 *
 * Callers that must clean up after a failed session creation should call this
 * first and pass the id back as `existingCustomerId`, so the customer is never
 * created behind their back.
 */
export async function createTenantCheckoutCustomer(
  input: TenantCheckoutCustomerInput,
): Promise<string> {
  const customer = await getStripeClient().customers.create(
    {
      email: input.ownerEmail,
      name: input.companyName ?? undefined,
      metadata: { tenantId: input.tenantId },
    },
    input.operationId
      ? { idempotencyKey: `checkout-customer:${input.operationId}` }
      : undefined,
  );
  return customer.id;
}

function isMissingResourceError(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === MISSING_RESOURCE_CODE
  );
}

/**
 * Removes a Stripe Customer, treating one that is already gone as success:
 * rollbacks retry this, and a retry must not wedge on a customer a previous
 * attempt already deleted.
 */
export async function deleteStripeCustomerIfExists(
  customerId: string,
): Promise<void> {
  const stripe = getStripeClient();
  const customer = await stripe.customers
    .retrieve(customerId)
    .catch((error) => {
      if (isMissingResourceError(error)) return null;
      throw error;
    });
  if (!customer || customer.deleted) return;
  await stripe.customers.del(customerId);
}

async function resolveCheckoutCustomerId(
  input: WorkspaceCheckoutSessionInput,
): Promise<string> {
  if (input.existingCustomerId) return input.existingCustomerId;
  return createTenantCheckoutCustomer({
    operationId: input.operationId,
    tenantId: input.tenantId,
    ownerEmail: input.ownerEmail,
  });
}

function buildCheckoutSubscriptionData(
  metadata: Record<string, string>,
  trialDays: number | undefined,
): Stripe.Checkout.SessionCreateParams.SubscriptionData {
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData =
    {
      metadata,
    };
  if (trialDays && trialDays > 0) {
    subscriptionData.trial_period_days = trialDays;
  }
  return subscriptionData;
}

/**
 * Open a Stripe Checkout Session in `subscription` mode pointing at the
 * requested price. If `existingCustomerId` is provided, that Customer is
 * reused; otherwise a new Customer is created for the tenant. The session
 * metadata carries `tenantId` (and `planId` when supplied) so the completion
 * webhook can apply the upgrade to the right subscription record.
 *
 * The tenant subscription should be persisted in `pending_payment` (or kept
 * on its current plan) until the `checkout.session.completed` webhook fires.
 */
export async function createWorkspaceCheckoutSession(
  input: WorkspaceCheckoutSessionInput,
): Promise<WorkspaceCheckoutSession> {
  const stripe = getStripeClient();
  const customerId = await resolveCheckoutCustomerId(input);

  const sessionMetadata: Record<string, string> = { tenantId: input.tenantId };
  if (input.planId) sessionMetadata.planId = input.planId;
  if (input.operationId) sessionMetadata.operationId = input.operationId;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: input.stripePriceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      subscription_data: buildCheckoutSubscriptionData(
        sessionMetadata,
        input.trialDays,
      ),
      metadata: sessionMetadata,
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
    },
    input.operationId
      ? { idempotencyKey: `checkout-session:${input.operationId}` }
      : undefined,
  );

  if (!session.url) {
    if (input.operationId) throw new UnusableCheckoutSessionError(session.id);
    // Expire it here so a session nobody can redirect to cannot be completed
    // out of band, and drop the customer this call created — callers that
    // brought their own keep it, since it is not ours to delete. The id still
    // travels with the error so a caller's rollback can retry the expiry.
    await stripe.checkout.sessions.expire(session.id).catch(() => {});
    if (!input.existingCustomerId) {
      await deleteStripeCustomerIfExists(customerId).catch((error) =>
        Logging.Warn(
          `[dms-saas] failed to delete Stripe customer ${customerId} after unusable checkout session`,
          error,
        ),
      );
    }
    throw new UnusableCheckoutSessionError(session.id);
  }

  return {
    sessionId: session.id,
    url: session.url,
    customerId,
  };
}
