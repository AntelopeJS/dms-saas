import { Controller, Get, JSONBody, Put } from "@antelopejs/interface-api";
import {
  AuthTenantMember,
  AuthTenantOwner,
} from "@antelopejs/interface-dms/guards";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  TenantBillingAddress,
  TenantBillingInfo,
  TenantCustomerType,
  VatVerificationStatus,
} from "../../db";
import { TenantBillingInfoModel, TenantSubscriptionModel } from "../../db";
import { isComplimentarySubscription } from "../../workspaces/complimentary";
import {
  type CustomerBillingAddress,
  fetchPrimaryTaxId,
  reconcileStripeTaxId,
  syncStripeCustomerBilling,
  toTenantBillingAddress,
  toVatVerificationStatus,
} from "../../stripe";

const DEFAULT_CUSTOMER_TYPE: TenantCustomerType = "individual";
const BUSINESS_CUSTOMER_TYPE: TenantCustomerType = "business";
const SETTLED_VAT_STATUSES = new Set<VatVerificationStatus>([
  "verified",
  "unverified",
]);

interface UpdateBillingInfoBody {
  companyName?: string | null;
  vatNumber?: string | null;
  billingEmail?: string | null;
  address?: CustomerBillingAddress;
}

interface BillingInfoResponse {
  customerType: TenantCustomerType | null;
  companyName: string | null;
  vatNumber: string | null;
  vatVerificationStatus: VatVerificationStatus | null;
  billingEmail: string | null;
  address: TenantBillingAddress | null;
}

interface BillingInfoValues extends BillingInfoResponse {
  updatedAt: Date;
}

const EMPTY_BILLING_INFO: BillingInfoResponse = {
  customerType: null,
  companyName: null,
  vatNumber: null,
  vatVerificationStatus: null,
  billingEmail: null,
  address: null,
};

function toResponse(info: BillingInfoResponse): BillingInfoResponse {
  return {
    customerType: info.customerType,
    companyName: info.companyName,
    vatNumber: info.vatNumber,
    vatVerificationStatus: info.vatVerificationStatus ?? null,
    billingEmail: info.billingEmail,
    address: info.address,
  };
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildBillingInfoValues(
  current: TenantBillingInfo | undefined,
  body: UpdateBillingInfoBody,
  vatVerificationStatus: VatVerificationStatus | null,
): BillingInfoValues {
  const customerType = current?.customerType ?? DEFAULT_CUSTOMER_TYPE;
  const isBusiness = customerType === BUSINESS_CUSTOMER_TYPE;
  return {
    customerType,
    companyName: isBusiness ? (body.companyName ?? null) : null,
    vatNumber: isBusiness ? (body.vatNumber ?? null) : null,
    vatVerificationStatus,
    // Stripe keeps an emptied e-mail, so preserving it locally avoids a silent
    // divergence that the next customer.updated webhook would undo anyway.
    billingEmail:
      normalizeEmail(body.billingEmail) ?? current?.billingEmail ?? null,
    address: toTenantBillingAddress(body.address),
    updatedAt: new Date(),
  };
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
    if (!info) return EMPTY_BILLING_INFO;
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
    customerType: TenantCustomerType,
    fallbackName: string,
    body: UpdateBillingInfoBody,
  ): Promise<VatVerificationStatus | null> {
    await syncStripeCustomerBilling(customerId, {
      customerType,
      companyName: body.companyName,
      fallbackName,
      billingEmail: normalizeEmail(body.billingEmail),
      address: body.address,
    });
    return reconcileStripeTaxId(customerId, {
      customerType,
      vatNumber: body.vatNumber,
      address: body.address,
    });
  }

  @Put("/billing-info")
  async updateBillingInfo(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) user: User,
    @JSONBody() body: UpdateBillingInfoBody,
    @TenantScopedModel(TenantBillingInfoModel)
    billingModel: TenantBillingInfoModel,
    @TenantScopedModel(TenantSubscriptionModel)
    subscriptionModel: TenantSubscriptionModel,
  ): Promise<BillingInfoResponse> {
    const info = await billingModel.findOne();
    const customerType = info?.customerType ?? DEFAULT_CUSTOMER_TYPE;
    const subscription = await subscriptionModel.findOne();
    const vatVerificationStatus =
      subscription?.stripeCustomerId &&
      !isComplimentarySubscription(subscription)
        ? await this.syncStripe(
            subscription.stripeCustomerId,
            customerType,
            user.name,
            body,
          )
        : null;
    const values = buildBillingInfoValues(info, body, vatVerificationStatus);
    await persistBillingInfo(billingModel, info, values);
    const updated = await billingModel.findOne();
    return toResponse(updated ?? values);
  }
}
