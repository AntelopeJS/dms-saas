import { randomUUID } from "node:crypto";
import { ImplementInterface } from "@antelopejs/interface-core";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import * as billingInterface from "@antelopejs/interface-dms-saas/billing";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type TenantSubscription, TenantSubscriptionModel } from "../src/db";
import * as billingImplementation from "../src/implementations/dms-saas/billing";
import { addTenantMember, useTenantAccessGate } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("tenant-customer-balance-interface");
const stripe = useSuiteStripe();
const gate = useTenantAccessGate();

const CUSTOMER_ID = "cus_current";

/** The scope of the current test: a member of a workspace of its own. */
let SCOPE = { tenantId: "", userId: "" };

/** Stores the scope's workspace subscription. */
async function subscribe(subscription: Partial<TenantSubscription>) {
  await GetModel(TenantSubscriptionModel, SCOPE.tenantId).insert({
    _id: SCOPE.tenantId,
    ...subscription,
  });
}

/** Answers the read of the workspace's Stripe customer with `customer`. */
function stripeCustomer(
  customer: Partial<Stripe.Customer> | Stripe.DeletedCustomer,
) {
  return vi
    .spyOn(stripe.write.customers, "retrieve")
    .mockResolvedValue(fromPartial(customer));
}

beforeAll(() => {
  ImplementInterface(billingInterface, billingImplementation);
});

beforeEach(async () => {
  SCOPE = { tenantId: randomUUID(), userId: randomUUID() };
  await addTenantMember(
    SCOPE.tenantId,
    fromPartial<User>({ _id: SCOPE.userId }),
  );
  gate.mockClear();
});

describe("tenant customer balance interface", () => {
  it("does not query Stripe for a complimentary grant retaining a customer", async () => {
    await subscribe({ stripeCustomerId: CUSTOMER_ID, isComplimentary: true });
    const retrieve = stripeCustomer({ balance: 0, currency: "eur" });
    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toMatchObject({ status: "absent", reason: "complimentary" });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it.each([1_250, 0, -1_250])(
    "returns Stripe balance %i in minor units with an explicit currency",
    async (balanceMinorUnits) => {
      await subscribe({ stripeCustomerId: CUSTOMER_ID });
      stripeCustomer({ balance: balanceMinorUnits, currency: "eur" });

      await expect(
        billingInterface.GetTenantCustomerBalance(SCOPE),
      ).resolves.toEqual({
        status: "available",
        balanceMinorUnits,
        currency: "EUR",
      });
    },
  );

  it("returns explicit absence when no Stripe customer is configured", async () => {
    await subscribe({});
    const retrieve = stripeCustomer({ balance: 0, currency: "eur" });

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toEqual({
      status: "absent",
      reason: "customer_not_configured",
      balanceMinorUnits: null,
      currency: null,
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("returns explicit absence for a deleted Stripe customer", async () => {
    await subscribe({ stripeCustomerId: CUSTOMER_ID });
    stripeCustomer({ id: CUSTOMER_ID, object: "customer", deleted: true });

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toMatchObject({ status: "absent", reason: "customer_deleted" });
  });

  it("does not expose a balance without its Stripe currency", async () => {
    await subscribe({ stripeCustomerId: CUSTOMER_ID });
    stripeCustomer({ balance: -500, currency: null });

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toEqual({
      status: "absent",
      reason: "currency_unavailable",
      balanceMinorUnits: null,
      currency: null,
    });
  });

  it("fails with a sanitized provider error", async () => {
    await subscribe({ stripeCustomerId: CUSTOMER_ID });
    stripeCustomer({}).mockRejectedValue(new Error("provider details"));

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).rejects.toMatchObject({
      status: 502,
      body: "saas.errors.billing.customer_balance_provider_unavailable",
    });
  });

  it("scopes models and access checks to the supplied authenticated scope", async () => {
    await subscribe({ stripeCustomerId: CUSTOMER_ID });
    const retrieve = stripeCustomer({ balance: 0, currency: "eur" });

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).resolves.toMatchObject({ status: "available" });

    expect(retrieve).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(gate).toHaveBeenCalledWith(SCOPE.userId, SCOPE.tenantId);
  });

  it("rejects authenticated non-members before reading Stripe", async () => {
    await subscribe({ stripeCustomerId: CUSTOMER_ID });
    const retrieve = stripeCustomer({ balance: 0, currency: "eur" });

    await expect(
      billingInterface.GetTenantCustomerBalance({
        ...SCOPE,
        userId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      status: 403,
      body: "error.tenant_member_required",
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("honors the current tenant access gate before reading Stripe", async () => {
    await subscribe({ stripeCustomerId: CUSTOMER_ID });
    const retrieve = stripeCustomer({ balance: 0, currency: "eur" });
    gate.mockReturnValueOnce({ allowed: false, code: "suspended" });

    await expect(
      billingInterface.GetTenantCustomerBalance(SCOPE),
    ).rejects.toMatchObject({ status: 403 });
    expect(retrieve).not.toHaveBeenCalled();
  });
});
