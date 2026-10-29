import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Plan,
  TenantBillingStateModel,
  TenantSubscriptionModel,
} from "../src/db";
import { handleSubscriptionPendingUpdateApplied } from "../src/plan-changes/applied-upgrade";
import { confirmOwnerUpgrade } from "../src/routes/tenant/tenant-plan-authentication";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("plan-upgrade-authentication");
const stripe = useSuiteStripe();

let enterprise: Plan;

beforeAll(async () => {
  await insertPlan({
    _id: "business",
    price: 30,
    paymentProviderRefs: { stripePriceId: "price_business" },
  });
  enterprise = await insertPlan({
    _id: "enterprise",
    price: 90,
    paymentProviderRefs: { stripePriceId: "price_enterprise" },
  });
});

let tenantId: string;
let customerId: string;
let model: TenantSubscriptionModel;

async function seedSubscription(planId = "business") {
  tenantId = randomUUID();
  customerId = `cus_${randomUUID()}`;
  model = GetModel(TenantSubscriptionModel, tenantId);
  await model.insert({
    _id: tenantId,
    planId,
    status: "active",
    isComplimentary: false,
    paidUsagePeriods: [],
    stripeCustomerId: customerId,
    stripeSubscriptionId: "sub_a",
  });
  return model.findOne();
}

function stubStripe() {
  return {
    retrieveSubscription: vi.spyOn(stripe.write.subscriptions, "retrieve"),
    retrieveInvoice: vi.spyOn(stripe.write.invoices, "retrieve"),
    voidInvoice: vi
      .spyOn(stripe.write.invoices, "voidInvoice")
      .mockResolvedValue(fromPartial({})),
  };
}

let api: ReturnType<typeof stubStripe>;

function stripeSubscription(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Response<Stripe.Subscription> {
  return fromPartial({
    id: "sub_a",
    customer: customerId,
    pending_update: null,
    latest_invoice: "in_upgrade",
    items: { data: [{ price: { id: "price_enterprise" } }] },
    ...overrides,
  });
}

const PENDING = fromPartial<Partial<Stripe.Subscription>>({
  pending_update: { expires_at: 1 },
});

function upgradePayment(status: string) {
  api.retrieveInvoice.mockResolvedValue(
    fromPartial({
      payments: { data: [{ payment: { payment_intent: { status } } }] },
    }),
  );
}

async function confirm() {
  return confirmOwnerUpgrade(
    tenantId,
    await model.findOne(),
    enterprise,
    model,
  );
}

beforeEach(() => {
  api = stubStripe();
});

describe("confirming an authenticated upgrade", () => {
  it("records the plan Stripe applied once the challenge was passed", async () => {
    await seedSubscription();
    api.retrieveSubscription.mockResolvedValue(stripeSubscription());

    await expect(confirm()).resolves.toMatchObject({
      changed: true,
      planId: "enterprise",
      authentication: null,
    });
    expect(await model.findOne()).toMatchObject({
      planId: "enterprise",
      domainTransition: null,
    });
    expect(
      await GetModel(TenantBillingStateModel).findByTenant(tenantId),
    ).toMatchObject({ planId: "enterprise" });
  });

  it("waits for Stripe to apply a payment it just took", async () => {
    await seedSubscription();
    api.retrieveSubscription
      .mockResolvedValueOnce(stripeSubscription(PENDING))
      .mockResolvedValueOnce(stripeSubscription());
    upgradePayment("succeeded");

    await expect(confirm()).resolves.toMatchObject({ changed: true });

    expect(api.voidInvoice).not.toHaveBeenCalled();
    expect(api.retrieveSubscription).toHaveBeenCalledTimes(2);
    expect(await model.findOne()).toMatchObject({ planId: "enterprise" });
  });

  it("drops the upgrade when the challenge was failed or abandoned", async () => {
    const stored = await seedSubscription();
    api.retrieveSubscription.mockResolvedValue(stripeSubscription(PENDING));
    upgradePayment("requires_action");

    await expect(confirm()).rejects.toMatchObject({
      status: 402,
      body: "saas.errors.plan.upgrade_authentication_failed",
    });
    expect(api.voidInvoice).toHaveBeenCalledWith("in_upgrade");
    expect(await model.findOne()).toEqual(stored);
  });

  it("refuses a plan Stripe does not bill", async () => {
    const stored = await seedSubscription();
    api.retrieveSubscription.mockResolvedValue(
      stripeSubscription({
        items: fromPartial({ data: [{ price: { id: "price_business" } }] }),
      }),
    );

    await expect(confirm()).rejects.toMatchObject({ status: 409 });
    expect(await model.findOne()).toEqual(stored);
  });

  it("answers at once when the webhook already recorded the plan", async () => {
    const stored = await seedSubscription("enterprise");

    await expect(
      confirmOwnerUpgrade(tenantId, stored, enterprise, model),
    ).resolves.toMatchObject({ changed: true });
    expect(api.retrieveSubscription).not.toHaveBeenCalled();
    expect(await model.findOne()).toEqual(stored);
  });
});

describe("customer.subscription.pending_update_applied", () => {
  const applied = (subscription: Stripe.Subscription) =>
    fromPartial<Stripe.CustomerSubscriptionPendingUpdateAppliedEvent>({
      type: "customer.subscription.pending_update_applied",
      data: { object: subscription },
    });

  it("records the upgrade an owner paid without coming back", async () => {
    await seedSubscription();

    await handleSubscriptionPendingUpdateApplied(applied(stripeSubscription()));

    expect(await model.findOne()).toMatchObject({
      planId: "enterprise",
      domainTransition: null,
    });
  });

  it("leaves a workspace already on the plan as it is", async () => {
    const stored = await seedSubscription("enterprise");

    await handleSubscriptionPendingUpdateApplied(applied(stripeSubscription()));

    expect(await model.findOne()).toEqual(stored);
  });

  it("ignores a subscription the workspace no longer bills on", async () => {
    const stored = await seedSubscription();

    await handleSubscriptionPendingUpdateApplied(
      applied(stripeSubscription({ id: "sub_old" })),
    );

    expect(await model.findOne()).toEqual(stored);
  });
});
