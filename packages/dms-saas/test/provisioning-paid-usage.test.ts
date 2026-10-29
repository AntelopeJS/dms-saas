import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { RoleModel } from "@antelopejs/interface-dms/db";
import * as permissions from "@antelopejs/interface-dms/permissions";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Plan, PlanModel, TenantSubscriptionModel } from "../src/db";
import { provisionWorkspace } from "../src/workspaces/provisioning";
import { implementWithDms } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

const SUBSCRIPTION_START_SECONDS = 1_780_000_000;
const PERIOD_END_SECONDS = 1_782_592_000;

useMongoDatabase("provisioning-paid-usage");
const stripe = useSuiteStripe();

beforeAll(() => {
  implementWithDms(permissions, "implementations/dms/permissions.js");
});

const PAID_PLAN = {
  price: 29,
  trialDays: 0,
  paymentProviderRefs: { stripePriceId: "price" },
};

async function seedPlan(fields: Partial<Plan> = {}): Promise<string> {
  const [planId] = await GetModel(PlanModel).insert({
    _id: randomUUID(),
    ...PAID_PLAN,
    ...fields,
  });
  return planId;
}

async function provision(paymentMethodId?: string, planId?: string) {
  return provisionWorkspace({
    userId: "owner",
    ownerLanguage: "fr",
    payload: {
      workspaceName: "Acme",
      planId: planId ?? (await seedPlan()),
      customerType: "individual",
      paymentMethodId,
    },
    stripeCustomerProfile: {
      customerType: "individual",
      email: "owner@example.test",
      fallbackName: "Owner",
    },
    card: { fingerprint: null, billingAddress: undefined },
    handles: {},
  });
}

function subscriptionsOf(tenantId: string) {
  return GetModel(TenantSubscriptionModel, tenantId).getAll();
}

/** Stubs every Stripe call a provisioning makes, and hands back the ones tests read. */
function stubProvisioningCalls() {
  vi.spyOn(stripe.write.customers, "update").mockResolvedValue(fromPartial({}));
  vi.spyOn(stripe.write.customers, "listTaxIds").mockResolvedValue(
    fromPartial({ data: [] }),
  );
  vi.spyOn(stripe.write.invoices, "retrieve").mockResolvedValue(
    fromPartial({ status: "paid" }),
  );
  return {
    createCustomer: vi
      .spyOn(stripe.write.customers, "create")
      .mockResolvedValue(fromPartial({ id: "customer" })),
    attach: vi
      .spyOn(stripe.write.paymentMethods, "attach")
      .mockResolvedValue(fromPartial({})),
    createSubscription: vi
      .spyOn(stripe.write.subscriptions, "create")
      .mockResolvedValue(
        fromPartial({
          id: "sub_paid",
          start_date: SUBSCRIPTION_START_SECONDS,
          items: { data: [{ current_period_end: PERIOD_END_SECONDS }] },
          latest_invoice: "invoice",
        }),
      ),
  };
}

let calls: ReturnType<typeof stubProvisioningCalls>;

beforeEach(() => {
  calls = stubProvisioningCalls();
});

describe("initial paid usage coverage of a provisioned workspace", () => {
  it("covers a paid workspace from its Stripe subscription's start", async () => {
    const { tenantId } = await provision("pm_card");
    await expect(subscriptionsOf(tenantId)).resolves.toEqual([
      expect.objectContaining({
        stripeSubscriptionId: "sub_paid",
        isComplimentary: false,
        paidUsagePeriods: [
          {
            stripeSubscriptionId: "sub_paid",
            start: new Date(SUBSCRIPTION_START_SECONDS * 1000),
            end: null,
          },
        ],
      }),
    ]);
  });

  it("gives the workspace its Member role, named in the owner's language", async () => {
    const { tenantId } = await provision("pm_card");
    await expect(GetModel(RoleModel, tenantId).getAll()).resolves.toEqual([
      expect.objectContaining({
        _id: `${tenantId}:member`,
        name: "Membre",
        description: "Tout ce que comprend l'offre de l'espace",
      }),
    ]);
  });

  it("creates the Stripe customer in the owner's language", async () => {
    await provision("pm_card");
    expect(calls.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ preferred_locales: ["fr"] }),
      expect.anything(),
    );
  });

  it("creates the subscription in the classic billing mode", async () => {
    await provision("pm_card");
    expect(calls.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ billing_mode: { type: "classic" } }),
      expect.anything(),
    );
  });

  it("leaves a card-less workspace with an empty coverage ledger", async () => {
    const { tenantId } = await provision(
      undefined,
      await seedPlan({ price: 0 }),
    );
    expect(calls.createSubscription).not.toHaveBeenCalled();
    await expect(subscriptionsOf(tenantId)).resolves.toEqual([
      expect.objectContaining({
        stripeSubscriptionId: null,
        paidUsagePeriods: [],
      }),
    ]);
  });

  it("keeps a carded workspace on an off-Stripe free plan local", async () => {
    const { tenantId } = await provision(
      "pm_card",
      await seedPlan({ price: 0, paymentProviderRefs: {} }),
    );
    expect(calls.createCustomer).toHaveBeenCalled();
    expect(calls.attach).toHaveBeenCalled();
    expect(calls.createSubscription).not.toHaveBeenCalled();
    await expect(subscriptionsOf(tenantId)).resolves.toEqual([
      expect.objectContaining({
        stripeCustomerId: "customer",
        stripeSubscriptionId: null,
        status: "active",
        paidUsagePeriods: [],
      }),
    ]);
  });
});
