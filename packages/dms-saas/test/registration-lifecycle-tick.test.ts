import { randomUUID } from "node:crypto";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import * as permissions from "@antelopejs/interface-dms/permissions";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanModel } from "../src/db";
import { LifecycleDeliveryModel } from "../src/operator-actions/db/lifecycle-delivery.model";
import {
  isWorkspaceProvisioningCommitted,
  reconcileWorkspaceLifecycleDeliveries,
} from "../src/operator-actions/lifecycle-outbox";
import { provisionWorkspace } from "../src/workspaces/provisioning";
import { implementWithDms } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase();
const stripe = useSuiteStripe();

beforeAll(() => {
  implementWithDms(permissions, "implementations/dms/permissions.js");
});

beforeEach(() => {
  vi.spyOn(stripe.write.customers, "create").mockResolvedValue(
    fromPartial({ id: "customer" }),
  );
  vi.spyOn(stripe.write.customers, "update").mockResolvedValue(fromPartial({}));
  vi.spyOn(stripe.write.customers, "listTaxIds").mockResolvedValue(
    fromPartial({ data: [] }),
  );
  vi.spyOn(stripe.write.paymentMethods, "attach").mockResolvedValue(
    fromPartial({}),
  );
  vi.spyOn(stripe.write.subscriptions, "create").mockResolvedValue(
    fromPartial({
      id: "sub_paid",
      start_date: 1_780_000_000,
      items: { data: [{ current_period_end: 1_782_592_000 }] },
      latest_invoice: "invoice",
    }),
  );
  vi.spyOn(stripe.write.invoices, "retrieve").mockResolvedValue(
    fromPartial({ status: "paid" }),
  );
});

async function register() {
  const [planId] = await GetModel(PlanModel).insert({
    _id: randomUUID(),
    price: 29,
    trialDays: 0,
    paymentProviderRefs: { stripePriceId: "price" },
  });
  return provisionWorkspace({
    userId: "owner",
    ownerLanguage: "en",
    payload: {
      workspaceName: "Acme",
      planId,
      customerType: "individual",
      paymentMethodId: "pm_card",
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

type ProvisioningState = Parameters<
  LifecycleDeliveryModel["transitionProvisioning"]
>[1];

/**
 * Runs one lifecycle tick between the registration's read of its creation
 * gate in the `from` state and its write of the next provisioning state,
 * where the production cron took the gate.
 */
function tickBetweenTransitionReadAndWrite(from: ProvisioningState): void {
  const model = GetModel(LifecycleDeliveryModel);
  const read = model.get.bind(model);
  const transition = model.transitionProvisioning.bind(model);
  let transitioning = false;
  let ticked = false;
  vi.spyOn(model, "transitionProvisioning").mockImplementation(
    async (...args) => {
      transitioning = args[1] === from;
      try {
        await transition(...args);
      } finally {
        transitioning = false;
      }
    },
  );
  vi.spyOn(model, "get").mockImplementation(async (id) => {
    const row = await read(id);
    if (transitioning && !ticked) {
      ticked = true;
      await reconcileWorkspaceLifecycleDeliveries();
    }
    return row;
  });
}

describe("a registration that a lifecycle tick overlaps", () => {
  it("provisions the workspace when the tick runs while its creation gate is prepared", async () => {
    tickBetweenTransitionReadAndWrite("preparing");

    const { tenantId } = await register();

    expect(await isWorkspaceProvisioningCommitted(tenantId)).toBe(true);
  });

  it("logs no delivery failure on the overlapping tick or the next one", async () => {
    const error = vi.spyOn(Logging, "Error");
    tickBetweenTransitionReadAndWrite("preparing");

    await register().catch(() => undefined);
    await reconcileWorkspaceLifecycleDeliveries();

    expect(error).not.toHaveBeenCalled();
  });

  it("cancels the workspace of a declined card when the tick runs while its creation gate awaits payment", async () => {
    vi.spyOn(stripe.write.invoices, "retrieve").mockResolvedValue(
      fromPartial({ status: "open" }),
    );
    const decline = Object.assign(new Error("Your card was declined."), {
      type: "StripeCardError",
    });
    vi.spyOn(stripe.write.invoices, "pay").mockRejectedValue(decline);
    tickBetweenTransitionReadAndWrite("awaiting_payment");

    await expect(register()).rejects.toBe(decline);
    vi.restoreAllMocks();
    const error = vi.spyOn(Logging, "Error");
    await reconcileWorkspaceLifecycleDeliveries();

    expect(error).not.toHaveBeenCalled();
  });
});
