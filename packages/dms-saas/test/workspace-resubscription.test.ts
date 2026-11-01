import { randomUUID } from "node:crypto";
import type { RequestContext } from "@antelopejs/interface-api";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerSubscriptionAccessGate,
  WORKSPACE_ACCESS_BLOCKED_CODE,
} from "../src/auth/subscription-access-gate";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  FeatureModel,
  PlanModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import "../src/routes/tenant/billing-self-refund";
import { SaasTenantPlanController } from "../src/routes/tenant/tenant-plan";
import { resolvePlanChangeKind } from "../src/routes/tenant/tenant-plan-preview";
import { handleCheckoutSessionCompleted } from "../src/stripe/webhook-checkout";
import {
  canResubscribe,
  liveStripeSubscriptionId,
} from "../src/workspaces/first-payment";
import { useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import {
  allowCheckoutRedirects,
  createOwnedWorkspace,
} from "./helpers/workspaces";
import { callRoute } from "./helpers/routes";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("workspace-resubscription");
useDmsAuth();
const stripe = useSuiteStripe();

const KEPT_CUSTOMER = "cus_kept";
const ENDED_SUBSCRIPTION = "sub_ended";
const NEW_SUBSCRIPTION = "sub_new";
const CARD = "card-fingerprint";
const REFUNDED_AT = new Date("2026-09-01T10:00:00Z");
const COMPLETE_IDENTITY = {
  customerType: "individual",
  companyName: null,
  vatNumber: null,
  billingEmail: "billing@example.test",
  address: {
    line1: "1 rue de la Paix",
    line2: null,
    postalCode: "75002",
    city: "Paris",
    state: null,
    country: "FR",
  },
} satisfies Partial<TenantBillingInfo>;

let paidPlan: Awaited<ReturnType<typeof insertPlan>>;
let freePlan: Awaited<ReturnType<typeof insertPlan>>;

beforeAll(async () => {
  allowCheckoutRedirects();
  registerSubscriptionAccessGate();
  paidPlan = await insertPlan({
    _id: "pro",
    name: "Pro",
    price: 49,
    paymentProviderRefs: { stripePriceId: "price_pro" },
  });
  freePlan = await insertPlan({ _id: "free", name: "Free" });
});

function stubStripe() {
  vi.spyOn(stripe.write.customers, "update").mockResolvedValue(
    fromPartial({ id: KEPT_CUSTOMER }),
  );
  vi.spyOn(stripe.write.subscriptions, "retrieve").mockResolvedValue(
    fromPartial({
      id: NEW_SUBSCRIPTION,
      customer: KEPT_CUSTOMER,
      default_payment_method: "pm_new",
      status: "active",
      start_date: 1_900_000_000,
      items: { data: [{ current_period_end: 1_902_000_000 }] },
    }),
  );
  return {
    createCustomer: vi
      .spyOn(stripe.write.customers, "create")
      .mockResolvedValue(fromPartial({ id: "cus_created" })),
    createSession: vi
      .spyOn(stripe.write.checkout.sessions, "create")
      .mockImplementation(async () =>
        fromPartial({
          id: randomUUID(),
          url: "https://checkout.example.test/session",
        }),
      ),
    listInvoices: vi.spyOn(stripe.write.invoices, "list"),
  };
}

let api: ReturnType<typeof stubStripe>;

beforeEach(async () => {
  api = stubStripe();
  await GetModel(BillingSettingsModel).delete(BILLING_SETTINGS_SINGLETON_ID);
});

interface Workspace {
  tenantId: string;
  owner: User;
  request: RequestContext;
  model: TenantSubscriptionModel;
}

async function seedCancelledWorkspace(
  patch: Partial<TenantSubscription> = {},
): Promise<Workspace> {
  const { tenantId, owner, request } = await createOwnedWorkspace();
  const model = GetModel(TenantSubscriptionModel, tenantId);
  await model.insert({
    _id: tenantId,
    planId: paidPlan._id,
    status: "cancelled",
    isComplimentary: false,
    stripeCustomerId: KEPT_CUSTOMER,
    stripeSubscriptionId: ENDED_SUBSCRIPTION,
    cardFingerprint: CARD,
    refundRequestedAt: REFUNDED_AT,
    deletionRequestedAt: REFUNDED_AT,
    deletionRequestedBy: owner._id,
    createdBy: owner._id,
    paidUsagePeriods: [
      {
        stripeSubscriptionId: ENDED_SUBSCRIPTION,
        start: new Date("2026-08-01T00:00:00Z"),
        end: null,
      },
    ],
    ...patch,
  });
  await GetModel(TenantBillingInfoModel, tenantId).insert({
    _id: tenantId,
    updatedAt: new Date(),
    ...COMPLETE_IDENTITY,
  });
  return { tenantId, owner, request, model };
}

async function seedFreeWorkspaceOnCard(): Promise<void> {
  const tenantId = randomUUID();
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: freePlan._id,
    status: "active",
    isComplimentary: false,
    cardFingerprint: CARD,
    paidUsagePeriods: [],
  });
}

function planController() {
  const controller = new SaasTenantPlanController();
  controller.tenantModel = GetModel(TenantModel);
  controller.planModel = GetModel(PlanModel);
  controller.featureModel = GetModel(FeatureModel);
  return controller;
}

function choosePlan(planId: string, workspace: Workspace) {
  return planController().changePlan(
    workspace.owner,
    {
      planId,
      successUrl: "https://example.test/billing",
      cancelUrl: "https://example.test/billing",
    },
    workspace.request,
    workspace.model,
    GetModel(TenantBillingInfoModel, workspace.tenantId),
  );
}

async function completionEvent(
  workspace: Workspace,
): Promise<Stripe.CheckoutSessionCompletedEvent> {
  const current = await workspace.model.findOne();
  return fromPartial<Stripe.CheckoutSessionCompletedEvent>({
    id: randomUUID(),
    type: "checkout.session.completed",
    data: {
      object: {
        id: current?.stripeCheckoutSessionId ?? undefined,
        mode: "subscription",
        status: "complete",
        subscription: NEW_SUBSCRIPTION,
        metadata: {
          tenantId: workspace.tenantId,
          planId: paidPlan._id,
          operationId: current?.domainTransition?.operationId,
        },
      },
    },
  });
}

async function readRefundEligibility(workspace: Workspace) {
  await GetModel(BillingSettingsModel).insert({
    _id: BILLING_SETTINGS_SINGLETON_ID,
    moneyBackGuaranteeEnabled: true,
    moneyBackGuaranteeWindowDays: 30,
    moneyBackGuaranteeMode: "full",
  });
  return callRoute(
    "GET",
    "/api/saas/billing/refund-eligibility",
    workspace.request,
  );
}

describe("resubscription eligibility", () => {
  it("is open to a cancelled workspace until its deletion is admitted", () => {
    const cancelled = fromPartial<TenantSubscription>({ status: "cancelled" });
    expect(canResubscribe(cancelled)).toBe(true);
    expect(
      canResubscribe({ ...cancelled, deletionStartedAt: new Date() }),
    ).toBe(false);
    expect(
      canResubscribe(fromPartial<TenantSubscription>({ status: "suspended" })),
    ).toBe(false);
  });

  it("treats the subscription Stripe ended as no subscription", () => {
    const ended = fromPartial<TenantSubscription>({
      status: "cancelled",
      stripeSubscriptionId: ENDED_SUBSCRIPTION,
    });
    expect(liveStripeSubscriptionId(ended)).toBeNull();
    expect(resolvePlanChangeKind(ended, paidPlan, paidPlan)).toBe("checkout");
    expect(resolvePlanChangeKind(ended, paidPlan, freePlan)).toBe("free");
    expect(liveStripeSubscriptionId({ ...ended, status: "past_due" })).toBe(
      ENDED_SUBSCRIPTION,
    );
  });
});

describe("a cancelled workspace choosing a plan again", () => {
  it("pays the plan it was cancelled on through Checkout on its own Stripe customer", async () => {
    const workspace = await seedCancelledWorkspace();

    const result = await choosePlan(paidPlan._id, workspace);

    expect(result.checkoutUrl).toBe("https://checkout.example.test/session");
    expect(api.createCustomer).not.toHaveBeenCalled();
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: KEPT_CUSTOMER }),
      expect.anything(),
    );
    expect(await workspace.model.findOne()).toMatchObject({
      status: "cancelled",
      domainTransition: expect.objectContaining({ kind: "checkout" }),
    });
  });

  it("becomes active on the new plan once Stripe reports the checkout complete", async () => {
    const workspace = await seedCancelledWorkspace();
    await choosePlan(paidPlan._id, workspace);

    await handleCheckoutSessionCompleted(await completionEvent(workspace));

    const reopened = await workspace.model.findOne();
    expect(reopened).toMatchObject({
      status: "active",
      planId: paidPlan._id,
      stripeCustomerId: KEPT_CUSTOMER,
      stripeSubscriptionId: NEW_SUBSCRIPTION,
      cardFingerprint: CARD,
      domainTransition: null,
      deletionRequestedAt: null,
      deletionRequestedBy: null,
    });
    expect(reopened?.paidUsagePeriods).toEqual([
      expect.objectContaining({
        stripeSubscriptionId: ENDED_SUBSCRIPTION,
        end: expect.any(Date),
      }),
      expect.objectContaining({
        stripeSubscriptionId: NEW_SUBSCRIPTION,
        end: null,
      }),
    ]);
  });

  it("does not grant the money-back guarantee a second time", async () => {
    const workspace = await seedCancelledWorkspace();
    await choosePlan(paidPlan._id, workspace);
    await handleCheckoutSessionCompleted(await completionEvent(workspace));

    const eligibility = await readRefundEligibility(workspace);

    expect(eligibility).toMatchObject({
      eligible: false,
      reason: "already_processed",
      refundedAt: REFUNDED_AT,
    });
    expect(api.listInvoices).not.toHaveBeenCalled();
  });

  it("resumes on a free plan as a local free subscription, keeping its customer", async () => {
    const workspace = await seedCancelledWorkspace();

    await expect(choosePlan(freePlan._id, workspace)).resolves.toMatchObject({
      changed: true,
      planId: freePlan._id,
      checkoutUrl: null,
    });

    const resumed = await workspace.model.findOne();
    expect(resumed).toMatchObject({
      status: "active",
      planId: freePlan._id,
      stripeCustomerId: KEPT_CUSTOMER,
      stripeSubscriptionId: null,
      refundRequestedAt: REFUNDED_AT,
      deletionRequestedAt: null,
      deletionRequestedBy: null,
    });
    expect(resumed?.paidUsagePeriods[0]?.end).toBeInstanceOf(Date);
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it("refuses a free plan once its card backs as many free workspaces as allowed", async () => {
    await GetModel(BillingSettingsModel).insert({
      _id: BILLING_SETTINGS_SINGLETON_ID,
      maxFreeWorkspacesPerCard: 1,
    });
    await seedFreeWorkspaceOnCard();
    const workspace = await seedCancelledWorkspace();

    await expect(choosePlan(freePlan._id, workspace)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.workspace.free_card_limit_reached",
    });
    expect((await workspace.model.findOne())?.status).toBe("cancelled");
  });

  it("counts the reopened workspace against its card afterwards", async () => {
    await GetModel(BillingSettingsModel).insert({
      _id: BILLING_SETTINGS_SINGLETON_ID,
      maxFreeWorkspacesPerCard: 2,
    });
    const card = randomUUID();
    const first = await seedCancelledWorkspace({ cardFingerprint: card });
    await choosePlan(freePlan._id, first);
    const second = await seedCancelledWorkspace({ cardFingerprint: card });
    await choosePlan(freePlan._id, second);
    const third = await seedCancelledWorkspace({ cardFingerprint: card });

    await expect(choosePlan(freePlan._id, third)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.workspace.free_card_limit_reached",
    });
    const onCard = await GetModel(
      TenantSubscriptionModel,
      CROSS_INSTANCE,
    ).findByCardFingerprint(card);
    expect(onCard.filter((row) => row.status === "active")).toHaveLength(2);
  });

  it("leaves a workspace whose deletion was admitted to the retention cron", async () => {
    const workspace = await seedCancelledWorkspace({
      deletionStartedAt: new Date(),
    });

    await expect(choosePlan(paidPlan._id, workspace)).rejects.toMatchObject({
      status: 403,
      body: WORKSPACE_ACCESS_BLOCKED_CODE,
    });
    expect(api.createSession).not.toHaveBeenCalled();
  });
});

describe("plans offered to a cancelled workspace", () => {
  it("tells the billing page its owner may choose a plan again", async () => {
    const workspace = await seedCancelledWorkspace();

    const current = await planController().getCurrentPlan(
      workspace.owner,
      workspace.request,
      workspace.model,
      GetModel(TenantBillingInfoModel, workspace.tenantId),
      "en",
    );

    expect(current).toMatchObject({
      status: "cancelled",
      canResubscribe: true,
      canRecoverComplimentary: false,
    });
  });
});
