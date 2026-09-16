import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { applyTenantOwnership } from "@antelopejs/interface-dms/tenant-ownership";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import type Stripe from "stripe";
import { recomputeTenantBillingState } from "../billing-state";
import type {
  Plan,
  TenantBillingAddress,
  TenantSubscriptionStatus,
} from "../db";
import {
  PlanModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
  TrialConsumptionModel,
} from "../db";
import { emitTenantBeingProvisioned } from "../hooks/tenant-provisioning";
import {
  beginWorkspaceCreation,
  cancelWorkspaceCreated,
  deliverWorkspaceCreated,
  prepareWorkspaceCreated,
} from "../operator-actions/lifecycle-outbox";
import {
  getStripeClient,
  reconcileStripeTaxId,
  toStripeAddress,
  toTenantBillingAddress,
} from "../stripe";
import { hashEmail, stripeSecondsToDate } from "../utils";
import {
  beginProvisioningAttempt,
  recordProvisioningState,
  reserveTrialIdentities,
} from "./provisioning-state";
export { rollbackWorkspaceProvisioning } from "./provisioning-rollback";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const ACTIVE_STATUS: TenantSubscriptionStatus = "active";
const TRIALING_STATUS: TenantSubscriptionStatus = "trialing";
const SEAT_BILLING_INITIAL_QUANTITY = 1;

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
  paymentMethodId: string;
  /**
   * The consuming SaaS's own capture, handed to `TENANT_BEING_PROVISIONED`
   * listeners and nowhere else. Opaque here: dms-saas never reads it, never
   * stores it, and never returns it.
   */
  extras?: Record<string, unknown>;
}

export interface StripeCustomerProfile extends WorkspaceBillingProfile {
  email: string;
  fallbackName: string;
  paymentMethodId: string;
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
  payload: WorkspaceProvisioningPayload;
  stripeCustomerProfile: StripeCustomerProfile;
  card: CardDetails;
  handles: WorkspaceProvisioningHandles;
}

export interface ProvisionedWorkspace {
  tenantId: string;
  isTrialing: boolean;
}

interface CreatedSubscription {
  stripeSubscriptionId: string;
  isTrialing: boolean;
  currentPeriodEnd: Date | null;
  /**
   * The first invoice, left unpaid at creation and settled last. Null when the
   * subscription owes nothing now (a trial), so there is nothing to charge.
   */
  latestInvoiceId: string | null;
}

interface SubscriptionCreationInput {
  stripeCustomerId: string;
  plan: Plan;
  userId: string;
  email: string;
  cardFingerprint: string | null;
  handles: WorkspaceProvisioningHandles;
}

interface TenantRecordsInput {
  tenantId: string;
  userId: string;
  payload: WorkspaceProvisioningPayload;
  stripeCustomerId: string;
  cardFingerprint: string | null;
  subscription: CreatedSubscription;
  billingEmail: string;
}

export function assertBillingCountry(
  address: WorkspaceAddressInput | undefined,
): void {
  assert(
    address?.country,
    HTTP_BAD_REQUEST,
    "saas.errors.billing.country_required",
  );
}

export async function ensurePlanIsAvailableForCustomer(
  planId: string,
  customerType: WorkspaceCustomerType,
): Promise<Plan> {
  const plan = await GetModel(PlanModel).get(planId);
  assert(
    plan && !plan.isDeleted && plan.isActive,
    HTTP_NOT_FOUND,
    "saas.errors.plan.not_available",
  );
  assert(
    plan.audience === "any" || plan.audience === customerType,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_available_for_customer_type",
  );
  return plan;
}

/**
 * Read once by the caller: both the free-workspace cap and the inherited
 * billing address need it before provisioning starts.
 */
export async function resolveCardDetails(
  paymentMethodId: string,
): Promise<CardDetails> {
  const stripe = getStripeClient();
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  const address = paymentMethod.billing_details?.address;
  return {
    fingerprint: paymentMethod.card?.fingerprint ?? null,
    billingAddress: address
      ? {
          line1: address.line1 ?? undefined,
          line2: address.line2 ?? undefined,
          postalCode: address.postal_code ?? undefined,
          city: address.city ?? undefined,
          state: address.state ?? undefined,
          country: address.country ?? undefined,
        }
      : undefined,
  };
}

async function createStripeCustomer(
  profile: StripeCustomerProfile,
  handles: WorkspaceProvisioningHandles,
): Promise<string> {
  const stripe = getStripeClient();
  // Set rather than spread: a customer without a VAT number carries no
  // `vatNumber` key at all, which is what Stripe's metadata expects.
  const metadata: Record<string, string> = {
    customerType: profile.customerType,
  };
  if (profile.vatNumber) metadata.vatNumber = profile.vatNumber;
  handles.mustPreserveWorkspace = true;
  const customer = await stripe.customers.create(
    {
      email: profile.email,
      name:
        profile.customerType === "business"
          ? profile.companyName
          : profile.fallbackName,
      address: toStripeAddress(profile.address),
      metadata: { ...metadata, provisioningAttempt: handles.tenantId ?? "" },
    },
    { idempotencyKey: `provisioning-customer:${handles.tenantId}` },
  );
  // Recorded before the follow-up calls: a failed attach (declined or already
  // attached card) must still leave the rollback able to delete the customer
  // and the PII it carries.
  handles.stripeCustomerId = customer.id;
  await recordProvisioningState(handles);
  await stripe.paymentMethods.attach(profile.paymentMethodId, {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: profile.paymentMethodId },
  });
  await reconcileStripeTaxId(customer.id, {
    customerType: profile.customerType,
    vatNumber: profile.vatNumber,
    address: profile.address,
  });
  handles.mustPreserveWorkspace = false;
  return customer.id;
}

function buildSubscriptionCreateParams(
  stripeCustomerId: string,
  stripePriceId: string,
  plan: Plan,
  grantTrial: boolean,
): Stripe.SubscriptionCreateParams {
  const quantity =
    plan.billingMode === "seat" ? SEAT_BILLING_INITIAL_QUANTITY : undefined;
  return {
    customer: stripeCustomerId,
    items: [{ price: stripePriceId, quantity }],
    trial_period_days: grantTrial ? plan.trialDays : undefined,
    automatic_tax: { enabled: true },
    // Create the subscription without settling its first invoice. The charge is
    // deferred to settleSubscriptionPayment, run only once the workspace, its
    // records and every TENANT_BEING_PROVISIONED listener have succeeded — so a
    // failure before then cancels an unpaid (incomplete) subscription, with
    // nothing to refund, instead of leaving a rolled-back workspace billed.
    payment_behavior: "default_incomplete",
  };
}

async function resolveTrialGrant(
  trialDays: number,
  emailHash: string,
  cardFingerprint: string | null,
  handles: WorkspaceProvisioningHandles,
): Promise<boolean> {
  if (trialDays <= 0) return false;
  const alreadyConsumed = await GetModel(
    TrialConsumptionModel,
  ).existsForIdentity(emailHash, cardFingerprint);
  return (
    !alreadyConsumed &&
    reserveTrialIdentities(handles, emailHash, cardFingerprint)
  );
}

async function recordTrialConsumption(
  userId: string,
  emailHash: string,
  cardFingerprint: string | null,
  planId: string,
): Promise<string> {
  const inserted = await GetModel(TrialConsumptionModel).insert([
    {
      userId,
      emailHash,
      paymentFingerprint: cardFingerprint,
      planId,
      consumedAt: new Date(),
    },
  ]);
  return inserted[0];
}

async function createSubscription(
  input: SubscriptionCreationInput,
): Promise<CreatedSubscription> {
  const { plan, handles } = input;
  assert(
    plan.paymentProviderRefs?.stripePriceId,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_synced_with_stripe",
  );
  const emailHash = hashEmail(input.email);
  const grantTrial = await resolveTrialGrant(
    plan.trialDays,
    emailHash,
    input.cardFingerprint,
    handles,
  );
  handles.mustPreserveWorkspace = true;
  const subscription = await getStripeClient().subscriptions.create(
    buildSubscriptionCreateParams(
      input.stripeCustomerId,
      plan.paymentProviderRefs.stripePriceId,
      plan,
      grantTrial,
    ),
    { idempotencyKey: `provisioning-subscription:${handles.tenantId}` },
  );
  handles.stripeSubscriptionId = subscription.id;
  await recordProvisioningState(handles);
  if (grantTrial) {
    // Track the consumption row so rollbackWorkspaceProvisioning can release
    // it: a provisioning that fails mid-way must not permanently burn a
    // legitimate user's trial eligibility.
    handles.trialConsumptionId = await recordTrialConsumption(
      input.userId,
      emailHash,
      input.cardFingerprint,
      plan._id,
    );
    await recordProvisioningState(handles);
  }
  handles.mustPreserveWorkspace = false;
  return {
    stripeSubscriptionId: subscription.id,
    isTrialing: grantTrial,
    currentPeriodEnd: stripeSecondsToDate(subscription.current_period_end),
    latestInvoiceId:
      typeof subscription.latest_invoice === "string"
        ? subscription.latest_invoice
        : (subscription.latest_invoice?.id ?? null),
  };
}

/**
 * Charge the first invoice — last. It runs only once the workspace, its records
 * and every listener have succeeded. The durable creation intent recovers
 * delivery if the process dies after payment. A trial
 * owes nothing now, so there is nothing to settle; the card was set up
 * off-session (a SetupIntent confirmed on the client), so the charge needs no
 * further interaction.
 */
async function settleSubscriptionPayment(
  subscription: CreatedSubscription,
  tenantId: string,
  handles: WorkspaceProvisioningHandles,
): Promise<void> {
  const invoiceId = subscription.isTrialing
    ? null
    : subscription.latestInvoiceId;
  handles.mustPreserveWorkspace = true;
  await recordProvisioningState(handles, "awaiting_payment");
  await prepareWorkspaceCreated(tenantId, invoiceId);
  if (!invoiceId) return;
  try {
    const invoice = await getStripeClient().invoices.retrieve(invoiceId);
    if (invoice.status === "paid") return;
    await getStripeClient().invoices.pay(
      invoiceId,
      { off_session: true },
      {
        idempotencyKey: `workspace-created:${tenantId}`,
      },
    );
  } catch (error) {
    // A timeout may hide a successful charge. Only a definitive decline permits rollback.
    if (
      error instanceof Error &&
      "type" in error &&
      error.type === "StripeCardError"
    ) {
      await cancelWorkspaceCreated(tenantId);
      handles.mustPreserveWorkspace = false;
    }
    throw error;
  }
}

async function insertTenantRecords(input: TenantRecordsInput): Promise<void> {
  const { tenantId, payload, subscription } = input;
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const tenantBillingInfoModel = GetModel(TenantBillingInfoModel, tenantId);
  await tenantSubscriptionModel.insert([
    {
      planId: payload.planId,
      status: subscription.isTrialing ? TRIALING_STATUS : ACTIVE_STATUS,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cardFingerprint: input.cardFingerprint,
      createdBy: input.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  await tenantBillingInfoModel.insert([
    {
      customerType: payload.customerType,
      companyName: payload.companyName ?? null,
      vatNumber: payload.vatNumber ?? null,
      billingEmail: input.billingEmail,
      address: toTenantBillingAddress(payload.address),
      updatedAt: new Date(),
    },
  ]);
  await recomputeTenantBillingState(tenantId);
}

async function createOwnedTenant(
  workspaceName: string,
  userId: string,
  handles: WorkspaceProvisioningHandles,
): Promise<string> {
  const tenantId = handles.tenantId;
  if (!tenantId)
    throw new Error("Provisioning intent must precede tenant creation");
  return runTenantLifecycleOperation(tenantId, async () => {
    await beginWorkspaceCreation(tenantId);
    await GetModel(TenantModel).insert([
      {
        _id: tenantId,
        name: workspaceName,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await applyTenantOwnership(GetModel(UserModel), userId, tenantId, {
      roleIds: [],
      isTenantOwner: true,
    });
    return tenantId;
  });
}

/** Reserve durable capacity before provider effects; ambiguous attempts retain their allocations. */
export async function provisionWorkspace(
  input: WorkspaceProvisioningInput,
): Promise<ProvisionedWorkspace> {
  const plan = await GetModel(PlanModel).get(input.payload.planId);
  assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_available");
  await beginProvisioningAttempt(input, plan);
  try {
    const provisioned = await runProvisioning(input);
    await recordProvisioningState(input.handles, "committed");
    return provisioned;
  } catch (error) {
    await recordProvisioningState(
      input.handles,
      "reconciliation_required",
    ).catch(() => {});
    throw error;
  }
}

async function runProvisioning(
  input: WorkspaceProvisioningInput,
): Promise<ProvisionedWorkspace> {
  const { userId, payload, stripeCustomerProfile, card, handles } = input;
  const plan = await GetModel(PlanModel).get(payload.planId);
  assert(plan, HTTP_NOT_FOUND, "saas.errors.plan.not_available");
  const stripeCustomerId = await createStripeCustomer(
    stripeCustomerProfile,
    handles,
  );
  const subscription = await createSubscription({
    stripeCustomerId,
    plan,
    userId,
    email: stripeCustomerProfile.email,
    cardFingerprint: card.fingerprint,
    handles,
  });
  handles.stripeSubscriptionId = subscription.stripeSubscriptionId;

  const tenantId = await createOwnedTenant(
    payload.workspaceName,
    userId,
    handles,
  );
  await runTenantLifecycleOperation(tenantId, () =>
    insertTenantRecords({
      tenantId,
      userId,
      payload,
      stripeCustomerId,
      cardFingerprint: card.fingerprint,
      subscription,
      billingEmail: stripeCustomerProfile.email,
    }),
  );

  // Hand the finished-but-unbilled workspace to whoever else has data to write
  // for it. Still inside everything the caller's rollback undoes: a listener
  // that fails takes the tenant, the (incomplete) subscription and the Stripe
  // customer with it — and because the card has not been charged yet, that
  // rollback owes no refund. It runs with the workspace already complete, so a
  // listener may read it.
  await emitTenantBeingProvisioned({
    tenantId,
    userId,
    extras: payload.extras,
  });

  await settleSubscriptionPayment(subscription, tenantId, handles);
  await deliverWorkspaceCreated(tenantId);

  return { tenantId, isTrialing: subscription.isTrialing };
}
