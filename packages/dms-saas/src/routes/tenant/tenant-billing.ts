import { Controller, Get, JSONBody, Put } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  AuthTenantMember,
  AuthTenantOwner,
} from "@antelopejs/interface-dms/guards";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  PlanModel,
  type TenantBillingAddress,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  type TenantCustomerType,
  type TenantSubscription,
  TenantSubscriptionModel,
  type VatVerificationStatus,
} from "../../db";
import {
  type BillingIdentity,
  type BillingIdentityField,
  type BillingIdentityInput,
  findMissingBillingIdentityFields,
  parseBillingIdentity,
} from "../../workspaces/billing-identity";
import { isComplimentarySubscription } from "../../workspaces/complimentary";
import {
  fetchPrimaryTaxId,
  reconcileStripeTaxId,
  syncStripeCustomerBilling,
  toTenantBillingAddress,
  toVatVerificationStatus,
} from "../../stripe";

const HTTP_BAD_REQUEST = 400;
const ANY_AUDIENCE = "any";
const SETTLED_VAT_STATUSES = new Set<VatVerificationStatus>([
  "verified",
  "unverified",
]);

interface StoredBillingInfo {
  customerType: TenantCustomerType | null;
  companyName: string | null;
  vatNumber: string | null;
  vatVerificationStatus: VatVerificationStatus | null;
  billingEmail: string | null;
  address: TenantBillingAddress | null;
}

interface BillingInfoResponse extends StoredBillingInfo {
  /** Required fields still missing; drives the "to complete" badge. */
  missingFields: BillingIdentityField[];
}

interface BillingInfoValues extends StoredBillingInfo {
  updatedAt: Date;
}

const EMPTY_BILLING_INFO: StoredBillingInfo = {
  customerType: null,
  companyName: null,
  vatNumber: null,
  vatVerificationStatus: null,
  billingEmail: null,
  address: null,
};

function toResponse(info: StoredBillingInfo): BillingInfoResponse {
  return {
    customerType: info.customerType,
    companyName: info.companyName,
    vatNumber: info.vatNumber,
    vatVerificationStatus: info.vatVerificationStatus ?? null,
    billingEmail: info.billingEmail,
    address: info.address,
    missingFields: findMissingBillingIdentityFields({
      ...info,
      address: info.address ?? undefined,
    }),
  };
}

function buildBillingInfoValues(
  identity: BillingIdentity,
  vatVerificationStatus: VatVerificationStatus | null,
): BillingInfoValues {
  return {
    customerType: identity.customerType,
    companyName: identity.companyName,
    vatNumber: identity.vatNumber,
    vatVerificationStatus,
    billingEmail: identity.billingEmail,
    address: toTenantBillingAddress(identity.address),
    updatedAt: new Date(),
  };
}

/**
 * A plan reserved to one customer type must not end up billed to the other:
 * switching type is refused while such a plan is in force.
 */
async function assertCustomerTypeFitsPlan(
  customerType: TenantCustomerType,
  subscription: TenantSubscription | undefined,
): Promise<void> {
  if (!subscription?.planId) return;
  const plan = await GetModel(PlanModel).get(subscription.planId);
  assert(
    !plan || plan.audience === ANY_AUDIENCE || plan.audience === customerType,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_available_for_customer_type",
  );
}

async function persistBillingInfo(
  model: TenantBillingInfoModel,
  current: TenantBillingInfo | undefined,
  values: BillingInfoValues,
): Promise<void> {
  if (!current) {
    await model.insert([values]);
    return;
  }
  await model.update(current._id, values);
}

// Both routes back blocks of the billing page, which stays reachable under the
// tenant access gate: a suspended owner must be able to correct the invoicing
// identity Stripe bills against before settling.
export class SaasTenantBillingController extends Controller(
  "/api/saas/tenant",
) {
  /**
   * VIES verification is asynchronous on Stripe's side, so a `pending` badge
   * reads the live tax ID rather than waiting for a webhook to catch up.
   * `verified` and `unverified` are terminal — Stripe never re-evaluates an
   * existing tax ID — so a settled status costs no Stripe call per page view.
   */
  private async refreshVatVerification(
    info: TenantBillingInfo,
    customerId: string | null | undefined,
    billingModel: TenantBillingInfoModel,
  ): Promise<TenantBillingInfo> {
    if (!customerId || !info.vatNumber) return info;
    const stored = info.vatVerificationStatus ?? null;
    if (stored && SETTLED_VAT_STATUSES.has(stored)) return info;
    const snapshot = await fetchPrimaryTaxId(customerId);
    if (!snapshot.reachable) return info;
    const status = snapshot.taxId
      ? toVatVerificationStatus(snapshot.taxId)
      : null;
    if (status === stored) return info;
    await billingModel.update(info._id, { vatVerificationStatus: status });
    // The spread row is an AntelopeJS table class: `Table` declares one
    // field and a static, no instance methods, and the value is
    // serialised to JSON on the way out. No prototype to lose.
    // oxlint-disable-next-line typescript/no-misused-spread
    return { ...info, vatVerificationStatus: status };
  }

  @Get("/billing-info")
  async getBillingInfo(
    @AuthTenantMember({ bypassTenantAccessGate: true }) _user: User,
    @TenantScopedModel(TenantBillingInfoModel)
    billingModel: TenantBillingInfoModel,
    @TenantScopedModel(TenantSubscriptionModel)
    subscriptionModel: TenantSubscriptionModel,
  ): Promise<BillingInfoResponse> {
    const info = await billingModel.findOne();
    if (!info) return toResponse(EMPTY_BILLING_INFO);
    const subscription = await subscriptionModel.findOne();
    const refreshed = await this.refreshVatVerification(
      info,
      isComplimentarySubscription(subscription)
        ? null
        : subscription?.stripeCustomerId,
      billingModel,
    );
    return toResponse(refreshed);
  }

  private async syncStripe(
    customerId: string,
    fallbackName: string,
    identity: BillingIdentity,
  ): Promise<VatVerificationStatus | null> {
    await syncStripeCustomerBilling(customerId, {
      customerType: identity.customerType,
      companyName: identity.companyName,
      fallbackName,
      billingEmail: identity.billingEmail,
      address: identity.address,
    });
    return reconcileStripeTaxId(customerId, {
      customerType: identity.customerType,
      vatNumber: identity.vatNumber,
      address: identity.address,
    });
  }

  @Put("/billing-info")
  async updateBillingInfo(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) user: User,
    @JSONBody() body: BillingIdentityInput,
    @TenantScopedModel(TenantBillingInfoModel)
    billingModel: TenantBillingInfoModel,
    @TenantScopedModel(TenantSubscriptionModel)
    subscriptionModel: TenantSubscriptionModel,
  ): Promise<BillingInfoResponse> {
    const identity = parseBillingIdentity(body);
    const info = await billingModel.findOne();
    const subscription = await subscriptionModel.findOne();
    await assertCustomerTypeFitsPlan(identity.customerType, subscription);
    const vatVerificationStatus =
      subscription?.stripeCustomerId &&
      !isComplimentarySubscription(subscription)
        ? await this.syncStripe(
            subscription.stripeCustomerId,
            user.name,
            identity,
          )
        : null;
    const values = buildBillingInfoValues(identity, vatVerificationStatus);
    await persistBillingInfo(billingModel, info, values);
    const updated = await billingModel.findOne();
    return toResponse(updated ?? values);
  }
}
